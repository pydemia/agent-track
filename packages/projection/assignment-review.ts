import type { ProjectTaskReview } from "../adapters/projects/index.ts";

/** Shared by the explicit review preview and the server's exact native input. */
export function assignmentPrompt(review: ProjectTaskReview, instructions: string): string {
  return [
    `Projects 업무 ID: ${review.task.id}`,
    `프로젝트 ID: ${review.task.projectId}`,
    `검토한 업무 revision: ${review.task.revision}`,
    `제목: ${review.task.title}`,
    "", "업무 본문:", review.body || "(본문 없음)",
    "", "수용 조건:", review.acceptanceCriteria.length ? review.acceptanceCriteria.map((value, index) => `${index + 1}. ${value}`).join("\n") : "(명시된 조건 없음)",
    "", `시험 필요: ${review.task.requiresTest ? "예" : "아니오"}`,
    "", "추가 실행 지시:", instructions || "(추가 지시 없음)",
    "", "실행 결과와 검증 근거를 보고하세요. Projects 업무의 상태·수용은 이 실행의 종료와 별도입니다.",
  ].join("\n");
}
