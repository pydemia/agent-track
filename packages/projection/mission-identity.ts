export const missionEntityKey = (sourceId: string, kind: string, id: string, runId?: string): string =>
  JSON.stringify([sourceId, JSON.stringify(runId && ["invocation", "tool", "permission", "group", "member"].includes(kind) ? [kind, runId, id] : [kind, id])]);
export const coworkMemberKey = (groupId: string, memberId: string): string => JSON.stringify([groupId, memberId]);
