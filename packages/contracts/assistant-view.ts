import type { ProjectMetadata, ProjectTaskMetadata, RunStatus } from "./index.ts";
import type { AssistantObservedExecution, AssistantObservedEventsPage } from "./assistant.ts";

export interface AssistantDemianLink {
  roleId: string;
  sourceId: string;
  runKey: string;
  runId: string;
  sessionId: string;
  workspaceId: string;
  operationId: string;
  status: RunStatus;
  observedAt: string;
}
export interface AssistantDemianLinksView {
  state: "connected" | "unconfigured" | "not_observed" | "forbidden" | "disconnected";
  links: AssistantDemianLink[];
  omitted: number;
  complete: false;
  detail: string;
}

/** An observed Assistant WorkExecution, separate from a Demian Run. */
export interface AssistantExecutionView {
  sourceId: string;
  sourceLabel: string;
  device: string;
  // Wire variants are validated before this rendering view. A common role list
  // lets view consumers work with both protocols without array-union mutation.
  native: Omit<AssistantObservedExecution, "roles"> & { roles: Array<AssistantObservedExecution["roles"][number]> };
  /** Only freshly authorized native links. Producer tuples never enter the browser. */
  demianLinks?: AssistantDemianLinksView;
  currentTask: {
    projectsSourceId: string;
    projectKey: string;
    project: ProjectMetadata;
    task: ProjectTaskMetadata;
    observedAt: string;
  } | null;
}
export interface AssistantExecutionListView {
  version: 1;
  sourceId: string;
  observedAt: string;
  executions: AssistantExecutionView[];
  cursor: string | null;
  hasMore: boolean;
  omitted: number;
  complete: false;
}
export interface AssistantExecutionEventsView {
  execution: AssistantExecutionView;
  page: AssistantObservedEventsPage;
}
