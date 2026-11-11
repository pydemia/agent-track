import type { ProjectTaskMetadata } from "./index.ts";

export interface ProjectDependency {
  id: string;
  projectId: string;
  relation: "depends_on";
  fromTask: ProjectTaskMetadata;
  toTask: ProjectTaskMetadata;
  fromRevision: string;
  toRevision: string;
}

export interface ProjectDependencyPage {
  sourceId: string;
  projectId: string;
  /** Null when the native source does not support dependency reads. */
  observedAt: string | null;
  supported: boolean;
  dependencies: ProjectDependency[];
  hasMore: boolean;
}
