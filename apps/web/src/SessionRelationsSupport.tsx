import type { useSessionRelations } from "./useSessionRelations.ts";

export function SessionRelationsSupport({ value }: { value: ReturnType<typeof useSessionRelations> }) {
  if (!value.native) return null;
  return <details className="orchestration-support"><summary>관리형 child·peer 처리 관계 <small>현재 세션의 원본 영수증</small></summary>
    <p>호출·협업 이벤트, 별도 child Run, peer 처리 영수증을 구분합니다. 부모 Run과 원격 peer Session은 원본 계약에 없으면 미확인 참조로 남깁니다.</p>
    <button className="text-button" onClick={value.refresh}>관계 다시 조회</button>
    {(["managed-children", "peer-processing"] as const).map(kind => {
      const window = value.windows.find(item => item.kind === kind), page = window?.pages.at(-1);
      return <section key={kind}><h4>{kind === "managed-children" ? "관리형 child 실행" : "peer 처리"}</h4>
        <p>{window?.failed ? "관계 조회 실패 · 이전 관계를 숨겼습니다." : page?.detail ?? "원본 연결과 조회 범위 확인 전입니다."}</p>
        {page && <p>{page.coverage} · 현재 조회 창 {window!.pages.reduce((n, item) => n + item.relations.length, 0)}건
          {window!.loading ? " · 재확인 중 (마지막 관측)" : ""} · {new Date(page.observedAt).toLocaleString("ko-KR")}</p>}
        {page?.hasMore && <button className="text-button" disabled={window!.loading || window!.pages.length >= value.maxPages} onClick={() => value.more(kind)}>
          {window!.pages.length >= value.maxPages ? "현재 화면 1,000건 한도" : "관계 다음 조회 창"}</button>}
      </section>;
    })}
    <p>UUID 페이지 순서는 작업의 선후 관계가 아닙니다. 현재 API의 처리 영수증 범위이며 전체 실행·대화 기록을 보장하지 않습니다.</p>
  </details>;
}
