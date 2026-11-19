# 실행 시도별 대화와 도구 기록

Track 상세 패널의 **중간 대화 · 도구 호출 · 응답**에서 선택한 실행의
요청·중간 Agent 메시지·도구 입력·도구 응답을 읽는다. 원문은 Track 원장이나
브라우저 저장소에 복사하지 않고 현재 권한으로 원본에서 조회한다.

Demian의 `GET /api/v1/runs/:id/conversation?after=0&limit=20`은 정확한
Run·조직·Session·요청자·journal에 귀속된 메시지만 읽는다. Persona는 고정한
Execution·역할·시도의 Native 참조를 사용한다. Session 전체 메시지나 현재
역할의 최신 Run을 과거 시도의 대체 본문으로 사용하지 않는다. 조회 전후
현재 source·Projects·owner·서명·정책 검증과 Track의 안정된 수집 창을 유지한다.

페이지는 처음 조회한 메시지 ID 상한을 고정한다. 불투명 커서는 Run·상한·
메시지 ID·파트·문자 오프셋에 귀속된다. 페이지당 최대 50항목/96,000자,
항목당 16,000자로 나누며 Unicode 문자를 중간에서 자르지 않는다.
이전/다음 기록으로 긴 응답을 계속 읽고 처음부터 다시 확인해 최신 상한을
가져올 수 있다. 화면에는 한 페이지의 본문만 유지한다.

Codex app-server의 완료된 공개 Agent 메시지를 개별 수집하고 실제 명령·
MCP·동적 도구 출력을 전달한다. analysis/reasoning·system 메시지는 제외한다.
일반 Native 도구 결과와 하위 Agent 원문도 호스트의 직렬 journal writer로
전달한다. 도구 허용 범위나 모델 실행 권한은 확대하지 않는다.

호출 식별자와 원문/미리보기 구분은 기존 메시지 JSON에 추가하지 않는다.
같은 트랜잭션의 `runtime.message_provenance` 이벤트에 메시지 ID·순서·
payload SHA와 함께 저장한다. 기존 메시지·Session/child 재개 형식과 구버전
파서의 호환성을 유지하며 DB schema 변경은 없다. 새 기록 수집 여부는
Run의 `runtime.message_capture` version 2 이벤트로 구분한다.

도구 노드는 call ID와 invocation ID가 모두 일치하는 기록만 표시한다.
호출 소속을 알 수 없는 예전 기록은 다른 하위 Agent의 동일 call ID와
합치지 않는다. 사용자는 같은 Run 전체 대화로 범위를 넓힐 수 있다.
저장 순서는 병렬 작업의 인과·의존 관계를 뜻하지 않는다.

과거 미수집 대화나 원본이 제공하지 않은 출력은 복원하지 않는다.
legacy·부분 기록·미리보기·원문 여부 미확인·빈 응답을 구별해서 표시한다.
기존 요청/결과/실패 요약 API와 v1 capabilities는 보존한다.
