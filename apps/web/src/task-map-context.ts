export type TaskMapContext = { sourceId: string; projectId: string; taskId?: string };

export function removeDeniedTaskContext(current: TaskMapContext | null, sourceId: string, projectId: string): TaskMapContext | null {
  return current?.sourceId === sourceId && current.projectId === projectId ? null : current;
}

/** A late denial cannot erase the URL of a different, newly selected Project. */
export function removeDeniedTaskQuery(search: string, sourceId: string, projectId: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("taskSource") !== sourceId || params.get("taskProject") !== projectId) return null;
  for (const key of ["taskSource", "taskProject", "task"]) params.delete(key);
  return params.toString();
}
