import { ProjectsClient, ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import { externalKey, type ProjectMetadata, type SourceView } from "../../packages/contracts/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import { projectsReady, sourceIdentity } from "./source-identity.ts";

interface Grant { identity: string; state: SourceView["state"]; projects: ProjectMetadata[]; observedAt: string; detail: string }

// One native principal is explicitly bound to one Track user and native account.
// Every metadata request refreshes native policy; stale/failed grants disclose no Project metadata.
export class ProjectsAuthority {
  private grants = new Map<string, Grant>();
  private pending = new Map<string, Promise<void>>();
  constructor(private store: Store, private config: () => Config) {}

  private allowed(source: SourceConfig, user: string): boolean {
    const current = this.config();
    const root = current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user;
    return root && projectsReady(source) && source.users.includes(user) && source.projectsUser === user;
  }

  view(source: SourceConfig, user: string): SourceView {
    const identity = sourceIdentity(source);
    const pinned = this.store.pinSourceIdentity(source.id, identity);
    const grant = pinned && this.allowed(source, user) ? this.grants.get(externalKey(source.id, user)) : undefined;
    const valid = grant?.identity === identity ? grant : undefined;
    return { id: source.id, kind: "projects", label: source.label, device: source.device,
      state: valid?.state ?? "forbidden", lastObservedAt: valid?.observedAt ?? null,
      detail: valid?.detail ?? "Track 사용자와 원본 프로젝트 권한 확인 전입니다. 연결된 업무 정보는 숨깁니다.",
      authorizedProjectIds: valid?.state === "connected" ? valid.projects.map((project) => project.id) : [],
      capabilities: valid?.state === "connected" ? ["projects.read", "tasks.read"] : [] };
  }

  catalog(sourceId: string, user: string): ProjectMetadata[] {
    const source = this.config().sources.find((item) => item.id === sourceId);
    if (!source || this.view(source, user).state !== "connected") return [];
    return this.grants.get(externalKey(source.id, user))?.projects ?? [];
  }

  client(sourceId: string, user: string): ProjectsClient {
    const source = this.config().sources.find((item) => item.id === sourceId);
    if (!source || !this.allowed(source, user) || this.view(source, user).state !== "connected") throw new ProjectsSourceError(403);
    return this.createClient(source, user);
  }

  private createClient(source: SourceConfig, user: string): ProjectsClient {
    return new ProjectsClient({ sourceId: source.id, baseUrl: source.baseUrl!, credentialFile: source.projectsCredentialFile!,
      user, accountId: source.projectsAccountId!, principalId: source.projectsPrincipalId! });
  }

  async refresh(user: string): Promise<void> {
    for (const source of this.config().sources.filter((item) => projectsReady(item) && item.users.includes(user))) {
      const key = externalKey(source.id, user);
      const identity = sourceIdentity(source);
      const record = (state: Grant["state"], projects: ProjectMetadata[], detail: string) => {
        this.grants.set(key, { identity, state, projects, observedAt: new Date().toISOString(), detail });
      };
      const read = async () => {
        try {
          const before = this.config().sources.find((item) => item.id === source.id);
          if (!before || !this.allowed(before, user) || sourceIdentity(before) !== identity || !this.store.pinSourceIdentity(source.id, identity)) throw new ProjectsSourceError(403);
          const client = this.createClient(source, user);
          const capabilities = await client.capabilities();
          if (!capabilities.projectsRead || !capabilities.tasksRead) throw new ProjectsSourceError(403);
          const projects = await client.projects();
          const current = this.config().sources.find((item) => item.id === source.id);
          if (!current || !this.allowed(current, user) || sourceIdentity(current) !== identity) throw new ProjectsSourceError(403);
          record("connected", projects, `원본 계정·현재 ACL로 ${projects.length}개 프로젝트 읽기를 확인했습니다. Track 전용 읽기 principal이며 업무 원문은 저장하지 않습니다.`);
        } catch (error) {
          const forbidden = error instanceof ProjectsSourceError && [401, 403, 404].includes(error.status);
          record(forbidden ? "forbidden" : "disconnected", [], forbidden
            ? "원본 프로젝트 접근이 거부되거나 철회됐습니다. 연결된 업무 metadata를 숨깁니다."
            : "원본 프로젝트 권한을 확인하지 못했습니다. 마지막 업무 metadata도 표시하지 않습니다.");
        }
      };
      // Every request starts a fresh native policy check after it enters this queue.
      // Serializing checks prevents an older allowed response from reopening a denial.
      const previous = this.pending.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(read);
      this.pending.set(key, operation);
      await operation;
    }
  }
}
