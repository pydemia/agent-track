import { createContext } from "react";
import type { MissionNode, MissionEdge } from "../../../packages/projection/mission-flow.ts";
import type { FlowGroupSummary } from "../../../packages/projection/flow-groups.ts";

/** Current-screen selection only; it carries no command or source authority. */
export const GroupWorkspaceContext = createContext<{
  actor?: string | null;
  onUnauthorized?: (reason: string) => void;
  open: (group: FlowGroupSummary, nodes: MissionNode[], edges: MissionEdge[]) => void;
} | null>(null);
