import type { ProjectMetadata, ProjectTaskMetadata } from "./index.ts";
import type { AssistantExecutionMetadata, AssistantExecutionEventsPage } from "./assistant.ts";

/** An observed Assistant WorkExecution, separate from a Demian Run. */
export interface AssistantExecutionView {
  sourceId: string;
  sourceLabel: string;
  device: string;
  native: AssistantExecutionMetadata;
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
  page: AssistantExecutionEventsPage;
}
