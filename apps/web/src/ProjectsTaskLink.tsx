import type { SourceView } from "../../../packages/contracts/index.ts";
import { projectTaskOrigin, type ProjectTaskRef } from "./project-task-origin.ts";

/** Reuse the existing original-app link pattern without a new login flow. */
export function ProjectsTaskLink({ sources, task }: { sources: readonly SourceView[]; task: ProjectTaskRef }) {
  const link = projectTaskOrigin(sources, task);
  return link.state === "ready"
    ? <a className="source-link" href={link.href} target="_blank" rel="noreferrer noopener">원본 업무 열기 ↗</a>
    : <span className="unsupported-link">{link.state === "unavailable" ? "현재 원본 업무 접근 미확인" : "원본 업무 링크 미지원"}</span>;
}
