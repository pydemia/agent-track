import { createHash } from "node:crypto";
import { z } from "zod";
import { ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import { ProjectsTaskWriter, ProjectsTaskAccessChanged, ProjectsTaskDeadlinePassed, prepareProjectsTaskCreate } from "../../packages/adapters/projects/writer.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { TaskCreationService, TaskCreationRejected, TaskCreationExpired, createTaskInputSchema, type CreateTaskInput, type CreateTaskPorts } from "../../packages/commands/create-task.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";
import { sourceIdentity } from "./source-identity.ts";

const nativeInput = (input: CreateTaskInput) => ({ operation_id: input.id, title: input.title, body: input.body,
  acceptance_criteria: input.acceptanceCriteria, requires_test: input.requiresTest });
const identity = (source: SourceConfig) => createHash("sha256").update(JSON.stringify([sourceIdentity(source), source.id,
  source.projectsTaskCreatorCredentialFile, source.projectsTaskCreatorPrincipalId])).digest("hex");

export class ProjectTaskCreation {
  private service: TaskCreationService;
  constructor(store: Store, private config: () => Config, private sources: Sources) { this.service = new TaskCreationService(store); }

  private reader(user: string, sourceId: string, projectId: string): SourceConfig {
    const config = this.config();
    const root = config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user;
    const source = config.sources.find((item) => item.id === sourceId && item.kind === "projects" && item.users.includes(user) && item.projectsUser === user);
    if (!root || !source || !z.uuid().safeParse(projectId).success ||
        !this.sources.projects.catalog(sourceId, user).some((project) => project.id === projectId)) {
      throw new CommandError(404, "project_not_found", "현재 접근 가능한 원본 프로젝트가 아닙니다.");
    }
    return source;
  }
  private scope(user: string, sourceId: string, projectId: string): SourceConfig {
    const config = this.config(); const source = this.reader(user, sourceId, projectId);
    if (config.auth.mode !== "proxy" || config.auth.users.length !== 1 || config.auth.users[0] !== user ||
        !source.taskCreateUsers?.includes(user) || !source.projectsTaskCreatorCredentialFile || !source.projectsTaskCreatorPrincipalId ||
        source.projectsTaskCreatorCredentialFile === source.projectsCredentialFile || source.projectsTaskCreatorPrincipalId === source.projectsPrincipalId) {
      throw new CommandError(403, "task_creation_not_enabled", "이 계정의 별도 원본 업무 생성 연결이 열려 있지 않습니다.");
    }
    return source;
  }
  private writer(source: SourceConfig, user: string) {
    return new ProjectsTaskWriter({ sourceId: source.id, baseUrl: source.baseUrl!, user, accountId: source.projectsAccountId!,
      principalId: source.projectsTaskCreatorPrincipalId!, credentialFile: source.projectsTaskCreatorCredentialFile! });
  }
  private async authorize(user: string, sourceId: string, projectId: string) {
    await this.sources.refreshProjectGrants(user);
    const source = this.scope(user, sourceId, projectId); const stamp = identity(source);
    const projects = await this.writer(source, user).projects();
    await this.sources.refreshProjectGrants(user);
    const current = this.scope(user, sourceId, projectId);
    if (identity(current) !== stamp || !projects.some((project) => project.id === projectId && !project.archived)) {
      throw new CommandError(403, "task_creation_not_enabled", "원본 생성 범위에 포함된 프로젝트가 아닙니다.");
    }
    return { identity: stamp, sourceId, projectId };
  }
  private ports(user: string, sourceId: string, projectId: string): CreateTaskPorts {
    let authorizedIdentity: string | undefined;
    return {
      authorize: async () => { const grant = await this.authorize(user, sourceId, projectId); authorizedIdentity = grant.identity; return grant; },
      prepare: (input) => prepareProjectsTaskCreate(projectId, nativeInput(input)),
      create: async (input) => {
        const source = this.scope(user, sourceId, projectId);
        try {
          return await this.writer(source, user).create(projectId, nativeInput(input), { expiresAt: input.expiresAt,
            refreshAuthorization: async () => {
              await this.sources.refreshProjectGrants(user);
              try { if (identity(this.scope(user, sourceId, projectId)) !== authorizedIdentity) throw new Error(); }
              catch { throw new ProjectsTaskAccessChanged(); }
            },
            isAuthorized: () => {
              try { return identity(this.scope(user, sourceId, projectId)) === authorizedIdentity; } catch { return false; }
            } });
        } catch (error) {
          if (error instanceof ProjectsTaskDeadlinePassed) throw new TaskCreationExpired();
          if (error instanceof ProjectsTaskAccessChanged || error instanceof ProjectsSourceError && [400, 401, 403, 404, 409, 422].includes(error.status)) throw new TaskCreationRejected();
          throw error;
        }
      },
      lookup: async (id, expectedProject, bodyHash) => {
        if (expectedProject !== projectId) throw new CommandError(403, "source_forbidden", "원본 프로젝트가 일치하지 않습니다.");
        try { return await this.writer(this.scope(user, sourceId, projectId), user).reconcile(projectId, id, bodyHash); }
        catch (error) {
          // A missing operation is not proof that the original POST never happened.
          if (error instanceof ProjectsSourceError && error.status === 404) return null;
          throw error;
        }
      },
    };
  }
  async execute(user: string, raw: unknown) {
    const parsed = createTaskInputSchema.safeParse(raw);
    if (!parsed.success) throw new CommandError(400, "invalid_task_draft", "업무 초안·요청 ID·기한을 확인해 주세요.");
    const input = parsed.data;
    return this.service.execute(user, input, this.ports(user, input.sourceId, input.projectId));
  }
  async confirmAccess(user: string, sourceId: string, projectId: string) { await this.authorize(user, sourceId, projectId); }
  async status(user: string, sourceId: string, projectId: string) {
    await this.sources.refreshProjectGrants(user); this.reader(user, sourceId, projectId);
    const ports = this.ports(user, sourceId, projectId);
    try { await ports.authorize(); }
    catch {
      await this.sources.refreshProjectGrants(user); this.reader(user, sourceId, projectId);
      return { enabled: false, detail: "현재 별도 쓰기 연결과 원본 생성 권한을 확인할 수 없습니다. 초안은 전송하지 않습니다.", receipts: [], incomplete: false };
    }
    const records = this.service.list(user, sourceId, projectId, 101);
    let incomplete = false; const receipts = records.slice(-100);
    for (let index = 0; index < receipts.length; index++) {
      if (["requested", "dispatching", "unknown"].includes(receipts[index]!.state)) {
        try { receipts[index] = await this.service.reconcile(user, receipts[index]!.id, ports); }
        catch { incomplete = true; }
      }
    }
    await this.authorize(user, sourceId, projectId);
    return { enabled: true, detail: "Projects 원본에 업무를 생성합니다. 실행 배정·완료·수용은 별도이며, 원본이 최종 생성 권한을 검사합니다. 처리 기록은 이 프로젝트의 최근100건 범위입니다.", receipts, incomplete };
  }
}
