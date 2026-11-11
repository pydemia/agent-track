import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { authenticate, validMutationOrigin } from "./auth.ts";
import { CommandError, CommandService } from "../../packages/commands/index.ts";
import { commandPorts } from "./commands.ts";
import { artifactEvidence } from "./evidence.ts";
import { ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import { RunBindings } from "./bindings.ts";
import { ApprovalService } from "../../packages/approvals/index.ts";
import { RunPermissions } from "./permissions.ts";
import { fileEvidence } from "./files.ts";
import { ProjectTaskCreation } from "./task-creation.ts";
import { TaskAssignments } from "./task-assignment.ts";
import { lineageEvidence } from "./lineage.ts";
import { orchestrationEvidence } from "./orchestration.ts";
import { authenticateContextReader, contextReaderStamp } from "./context-auth.ts";
import { contextSummary, parseContextPath } from "./context-summary.ts";
import { toolEvidence } from "./tools.ts";
import { projectDependencies } from "./project-dependencies.ts";
import { sequenceSchema } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { Sources } from "./runner.ts";
import type { Store } from "../../packages/storage/store.ts";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new CommandError(415, "json_required", "JSON body required.");
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 16_384) throw new CommandError(413, "body_too_large", "Command body is too large.");
    parts.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new CommandError(400, "invalid_json", "Invalid JSON body."); }
}
export function createTrackServer(store: Store, config: () => Config, webRoot: string, sources = new Sources(store, config)) {
  const root = resolve(webRoot);
  const taskAssignments = new TaskAssignments(store, config, sources);
  const snapshot = (user: string) => taskAssignments.filterSnapshot(store.snapshot(user, sources.views(user)));
  const commands = new CommandService(store);
  const bindings = new RunBindings(store, config, sources, snapshot);
  const permissions = new RunPermissions(store, config, sources, snapshot);
  const approvals = new ApprovalService(store);
  const taskCreation = new ProjectTaskCreation(store, config, sources);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const current = config();
      const privateUrl = new URL(request.url ?? "/", "http://localhost");
      if (privateUrl.pathname.startsWith("/api/integrations/context/")) {
        const reader = authenticateContextReader(request, current);
        if (!reader) { json(response, 401, { error: "authentication_required" }); return; }
        if (request.method !== "GET") { json(response, 405, { error: "read_only_context" }); return; }
        const target = parseContextPath(privateUrl.pathname);
        if (!target || privateUrl.search || request.headers["transfer-encoding"] || Number(request.headers["content-length"] ?? 0) !== 0) {
          json(response, 400, { error: "invalid_context" }); return;
        }
        const readerSnapshot = (user: string) => taskAssignments.filterSnapshot(snapshot(user),
          (sourceId, projectId) => reader.projectScopes.some((scope) => scope.sourceId === sourceId && scope.projectIds.includes(projectId)));
        const value = await contextSummary(config, readerSnapshot, reader, target, sources);
        const confirmed = authenticateContextReader(request, config());
        if (!confirmed || contextReaderStamp(confirmed) !== contextReaderStamp(reader)) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, value); return;
      }
      const user = authenticate(request, current);
      if (!user) { json(response, 401, { error: "authentication_required" }); return; }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/") && url.pathname !== "/api/health") {
        await sources.refreshProjectGrants?.(user);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
      }
      if (request.method === "POST" && url.pathname === "/api/commands/approval") {
        if (!validMutationOrigin(request, config())) { json(response, 403, { error: "invalid_origin" }); return; }
        const input = await jsonBody(request);
        const key = input && typeof input === "object" && "runKey" in input && typeof input.runKey === "string" ? input.runKey : "";
        const receipt = await approvals.execute(user, input, permissions.ports(user, key, true));
        await sources.refreshProjectGrants?.(user);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        json(response, 200, { receipt }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/projects/task-creation") {
        if (!validMutationOrigin(request, config())) { json(response, 403, { error: "invalid_origin" }); return; }
        const receipt = await taskCreation.execute(user, await jsonBody(request));
        await taskCreation.confirmAccess(user, receipt.sourceId, receipt.projectId);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/projects/task-assignments") {
        if (!validMutationOrigin(request, config())) { json(response, 403, { error: "invalid_origin" }); return; }
        const receipt = await taskAssignments.execute(user, await jsonBody(request));
        await taskAssignments.confirm(user, receipt);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      const assignmentReconcile = /^\/api\/projects\/task-assignments\/([0-9a-f-]{36})\/reconcile$/.exec(url.pathname);
      if (request.method === "POST" && assignmentReconcile) {
        if (!validMutationOrigin(request, config())) { json(response, 403, { error: "invalid_origin" }); return; }
        const receipt = await taskAssignments.reconcile(user, assignmentReconcile[1]!);
        await taskAssignments.confirm(user, receipt);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      const taskCreationStatus = /^\/api\/projects\/([a-z0-9_-]+)\/([0-9a-f-]{36})\/task-creation$/.exec(url.pathname);
      if (request.method === "GET" && taskCreationStatus) {
        const status = await taskCreation.status(user, taskCreationStatus[1]!, taskCreationStatus[2]!);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, status); return;
      }
      if (request.method === "POST" && url.pathname === "/api/bindings") {
        if (!validMutationOrigin(request, config())) { json(response, 403, { error: "invalid_origin" }); return; }
        const receipt = await bindings.apply(user, await jsonBody(request));
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      if (request.method === "POST" && url.pathname === "/api/commands/cancel") {
        if (!validMutationOrigin(request, current)) { json(response, 403, { error: "invalid_origin" }); return; }
        const input = await jsonBody(request);
        const runKey = input && typeof input === "object" && "runKey" in input && typeof input.runKey === "string" ? input.runKey : "";
        const receipt = await commands.execute(user, input, commandPorts(store, config, snapshot, user, runKey, true, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve()));
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      if (request.method !== "GET") { json(response, 405, { error: "unsupported_method" }); return; }
      if (url.pathname === "/api/commands") {
        const key = url.searchParams.get("run") ?? "";
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        const receipts = commands.list(user, key);
        const ports = commandPorts(store, config, snapshot, user, key, false, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve());
        for (let i = 0; i < receipts.length; i++) {
          const receipt = receipts[i]!;
          if (["requested", "dispatching", "accepted", "unknown"].includes(receipt.state)) receipts[i] = await commands.reconcile(user, receipt.id, ports);
        }
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipts }); return;
      }
      if (url.pathname === "/api/approvals") {
        const key = url.searchParams.get("run") ?? "";
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        const receipts = approvals.list(user, key);
        const ports = permissions.ports(user, key, false);
        for (let i = 0; i < receipts.length; i++) if (["requested", "dispatching", "unknown"].includes(receipts[i]!.state)) {
          receipts[i] = await approvals.reconcile(user, receipts[i]!.id, ports);
        }
        await sources.refreshProjectGrants?.(user);
        if (authenticate(request, config()) !== user || !snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        json(response, 200, { receipts }); return;
      }
      if (url.pathname === "/api/health") {
        json(response, 200, { status: "ok", schema: 2, version: "0.1.0", integrity: store.integrity() }); return;
      }
      if (url.pathname === "/api/snapshot") { json(response, 200, snapshot(user)); return; }
      if (url.pathname === "/api/projects/catalog") {
        const views = sources.views(user).filter((source) => source.kind === "projects");
        json(response, 200, { generatedAt: new Date().toISOString(), sources: views.map((source) => ({
          id: source.id, label: source.label, state: source.state, detail: source.detail,
          projects: sources.projects?.catalog(source.id, user) ?? [],
        })) }); return;
      }
      const assignmentRead = /^\/api\/projects\/([a-z0-9_-]+)\/([0-9a-f-]{36})\/tasks\/([0-9a-f-]{36})\/(review|assignment-sessions|assignments)$/.exec(url.pathname);
      if (assignmentRead) {
        const [, sourceId, projectId, taskId, kind] = assignmentRead as unknown as [string, string, string, string, string];
        const result = kind === "review" ? await taskAssignments.review(user, sourceId, projectId, taskId)
          : kind === "assignment-sessions" ? await taskAssignments.sessions(user, sourceId, projectId, taskId)
          : await taskAssignments.status(user, sourceId, projectId, taskId);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, result); return;
      }
      const dependencyRoute = /^\/api\/projects\/([a-z0-9_-]+)\/([0-9a-f-]{36})\/task-dependencies$/.exec(url.pathname);
      if (dependencyRoute) {
        if (request.method !== "GET") { json(response, 405, { error: "read_only_dependencies" }); return; }
        if (url.search) { json(response, 400, { error: "invalid_dependency_query" }); return; }
        const page = await projectDependencies(config, sources, user, dependencyRoute[1]!, dependencyRoute[2]!);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, page); return;
      }
      const projectTasks = /^\/api\/projects\/([a-z0-9_-]+)\/([0-9a-f-]{36})\/tasks$/.exec(url.pathname);
      if (projectTasks) {
        const [, sourceId, projectId] = projectTasks as unknown as [string, string, string];
        const permitted = () => sources.views(user).some((source) => source.id === sourceId && source.kind === "projects" &&
          source.state === "connected" && source.authorizedProjectIds?.includes(projectId));
        if (!permitted()) { json(response, 404, { error: "project_not_found" }); return; }
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const page = await sources.projects.client(sourceId, user).tasks(projectId, cursor);
        await sources.refreshProjectGrants(user);
        if (authenticate(request, config()) !== user || !permitted()) { json(response, 403, { error: "source_forbidden" }); return; }
        json(response, 200, page); return;
      }
      if (url.pathname === "/api/stream") {
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
        let sending = false;
        const send = async () => {
          if (sending || response.destroyed || response.writableEnded) return;
          sending = true;
          try {
            await sources.refreshProjectGrants?.(user);
            if (response.destroyed || response.writableEnded) return;
            if (authenticate(request, config()) !== user) {
              response.write("event: authorization_revoked\ndata: {}\n\n");
              response.end(); return;
            }
            response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(user))}\n\n`);
          } catch { response.end(); }
          finally { sending = false; }
        };
        void send();
        const interval = setInterval(() => void send(), 3000);
        response.on("close", () => clearInterval(interval));
        return;
      }
      const runEvents = /^\/api\/runs\/([A-Za-z0-9_-]+)\/events$/.exec(url.pathname);
      if (runEvents) {
        const key = runEvents[1]!;
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        try { json(response, 200, store.events(key, url.searchParams.get("after") ?? "0")); }
        catch { json(response, 400, { error: "invalid_page_cursor" }); }
        return;
      }
      const runBinding = /^\/api\/runs\/([A-Za-z0-9_-]+)\/binding$/.exec(url.pathname);
      if (runBinding) { json(response, 200, bindings.view(user, runBinding[1]!)); return; }
      const permissionRoute = /^\/api\/runs\/([A-Za-z0-9_-]+)\/permissions(?:\/([0-9a-f-]{36})\/review)?$/.exec(url.pathname);
      if (permissionRoute) {
        const key = permissionRoute[1]!;
        if (permissionRoute[2]) {
          const review = await permissions.review(user, key, permissionRoute[2]);
          if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
          json(response, 200, review); return;
        }
        const page = await permissions.list(user, key);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { requests: page.requests.map((item) => ({ ...item.request, reviewAvailable: item.reviewComplete })),
          observedAt: new Date().toISOString(), scope: "현재 원본에서 조회한 승인 요청. 도구 인자는 내용을 열었을 때만 표시합니다." }); return;
      }
      const artifacts = /^\/api\/runs\/([A-Za-z0-9_-]+)\/artifacts$/.exec(url.pathname);
      if (artifacts) {
        const evidence = await artifactEvidence(config, snapshot, user, artifacts[1]!, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve());
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      const files = /^\/api\/runs\/([A-Za-z0-9_-]+)\/files$/.exec(url.pathname);
      if (files) {
        const evidence = await fileEvidence(config, snapshot, user, files[1]!, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve());
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      const orchestration = /^\/api\/runs\/([A-Za-z0-9_-]+)\/orchestration$/.exec(url.pathname);
      if (request.method === "GET" && orchestration) {
        const evidence = await orchestrationEvidence(config, snapshot, user, orchestration[1]!, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve());
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      const lineage = /^\/api\/runs\/([A-Za-z0-9_-]+)\/lineage$/.exec(url.pathname);
      const tools = /^\/api\/runs\/([A-Za-z0-9_-]+)\/tools$/.exec(url.pathname);
      if (request.method === "GET" && tools) {
        const evidence = await toolEvidence(config, snapshot, user, tools[1]!, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve());
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      if (request.method === "GET" && lineage) {
        const after = sequenceSchema.safeParse(url.searchParams.get("after") ?? "0");
        if (!after.success) throw new CommandError(400, "invalid_cursor", "lineage 조회 위치를 확인해 주세요.");
        const evidence = await lineageEvidence(config, snapshot, user, lineage[1]!, () => sources.refreshProjectGrants?.(user) ?? Promise.resolve(), after.data);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      if (url.pathname.startsWith("/api/")) { json(response, 404, { error: "not_found" }); return; }
      if (url.pathname === "/oauth2/sign_out" && current.auth.mode === "local") {
        json(response, 200, { detail: "로컬 개발 모드입니다. 공개 배포는 Entra proxy만 허용합니다." }); return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!target.startsWith(root + sep)) { json(response, 404, { error: "not_found" }); return; }
      const type = contentTypes[extname(target)];
      if (!type) { json(response, 404, { error: "not_found" }); return; }
      try {
        const contents = await readFile(target);
        response.writeHead(200, { "Content-Type": type }); response.end(contents);
      } catch { json(response, 404, { error: "asset_not_found" }); }
    } catch (error) {
      if (response.headersSent) response.end();
      else if (error instanceof CommandError) json(response, error.status, { error: error.code, detail: error.message });
      else if (error instanceof ProjectsSourceError) {
        const status = [401, 403, 404].includes(error.status) ? 404 : [400, 409].includes(error.status) ? error.status : 503;
        json(response, status, { error: status === 404 ? "project_not_found" : status === 409 ? "project_snapshot_changed" : "project_source_unavailable" });
      }
      else json(response, 503, { error: "configuration_or_storage_unavailable" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, sources };
}
