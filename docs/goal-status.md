# Agent Track 구현 goal 기준표

기준: 2026-11-12 KST. 기존 AT-01~17을 유지하고 Demian 대화
`01a1c901-2cea-7a21-9b38-8d12445f0a49`에서 AT-18~21을 추가했다.
전체 수용 충족률은 동일 가중치 21개 중 검증 완료 개수다. 이는 작업량
추정치가 아니다. 구현·fixture·서비스 준비만으로 실기 조건을 완료 처리하지 않는다.

| 요구 | 수용 조건 | 상태·증거 |
| --- | --- | --- |
| AT-01 | 원본 ID·재수신·충돌 방지 | 검증 완료. `tests/core.test.ts` ID/충돌·dedupe·재시작·binding 검사, 실제 Codex 211 Run의 source/run UNIQUE 원장 |
| AT-02 | snapshot과 실시간 실행 상태 일치 | 검증 완료. `recovery-http.test.ts` 초기 snapshot/SSE 일치·할당/실행/권한 대기/취소 중/실패 구분. 실제 native 성공·취소 종료와 공개 Trace 대조 |
| AT-03 | durable cursor·중복·역순·gap·재시작 복구 | 검증 완료. 실제 HTTP 단절 후 DB 재시작·cursor1 재수신·gap2 보충·3 dedupe. stale/forbidden/재인가 fixture와 실제 native cursor17 재시작 확인 |
| AT-04 | Trail·파일·산출물 근거와 수집 범위 | 검증 완료. 실제 answer.txt metadata·원본/공개 Trail 대조와 native 파일 편집4Run 조회. 성공3파일의30byte/hash·요청/완료seq, 거절/만료는 실패·파일 없음 구분. 공개 Trail·390px/Tab·Project 철회404/경로 제거→복구, 원문 비노출·이벤트 digest 불변·조회 한도 검사 |
| AT-05 | 실제 Run·step·tool Trace, unknown 보존 | 검증 완료. 실제 Codex Run13event/5개 paired tool·관측 구간 공개 대조. 실제 native17event와 없는 step/호출 ID unknown 표시. invocation/call tuple·int64·모호함·시각 역행 fixture 통과 |
| AT-06 | 동일 원본 선택 deep link와 미지원 안내 | 부분. Demian Session href·Run link 미지원 안내. 실제 원본 웹이 Basic401로 브라우저 이동 차단. Track Entra/API 관측과 별개이며 원본 웹 인증 연결 필요 |
| AT-07 | 계정/프로젝트 권한 교집합·metadata allowlist | 검증 완료(현재 소유자 배포). 별도 owner-bound Projects reader·현재 native ACL/Project ID 교집합. 실제 scope7→6에서 API404·공개 업무 비노출→7 복원. 다른 Track actor의 owner key 차용 거부·bound Run 비노출·원문 제외 fixture. 추가 사용자 native principal은 별도 구성 필요 |
| AT-08 | 네 화면·빈/오류·접근성·favicon 실기 | 검증 완료. 공개 네 보기·favicon bytes/hash·SNB/Map keyboard/mobile. 분리 QA의 네 빈 보기·503/재시도·stale·철회·401 만료 후 private cache/URL 제거 실기. 실제 Entra membership 철회와 구별 |
| AT-09 | capability 기반 명령·idempotency·receipt·단절 | 부분. native cancel 실기 accepted→cancelled·동일 receipt, unknown/철회/만료/재시작·서로 다른 UUID 중복 방지 fixture. 재개/재시도는 원본 계약 미지원·UI 취소 클릭 실기 남음 |
| AT-10 | 범위·만료·철회·runtime 재검증 승인 | 검증 완료(현재 소유자 배포). 실제 native fileChange allow_once·동일 receipt·30byte 파일, 공개 UI deny·파일 비생성, 원본 자동만료/결정0·late 요청 차단. bound Project reader 철회 시 원문/세 API404→복구, 모바일/Tab·만료 후 인자 제거. 실제 allow_session 후 도구2회/승인 요청1건·새 QA 파일2개, 다른 실행/업무 상태와 구별 |
| AT-11 | 원본 업무 생성/배정·수락 확인·실패 보존 | 미착수 |
| AT-12 | typed Map·근거·목록·순환/고립 | 부분. 실제 native 소속 지도·관계 목록·키보드·390px 실기, SCC 순환/고립·10,000노드 fixture. 원본 dependency/artifact·관리형 child/peer 근거 실기 남음 |
| AT-13 | 보존·backup/restore·cursor/receipt 정합 | 검증 완료. 실제 online backup→별도 복원 DB→API232Run·17,456event 대조. binding/pending receipt·archive tombstone fixture. 자동 삭제 비활성·명시 archive 정책. 운영 DB 전환/재난 훈련과 구별 |
| AT-14 | Assistant→Demian→desktop→Track 실제 업무 | 미착수 |
| AT-15 | 전체 프로젝트 기본·필터·장치/수집 누락 | 부분. 전체5저장소+native 여러 workspace·필터/해제·선택 유지 실기, source별 범위/미지원 표시. 두 번째 실제 장치 연결 남음 |
| AT-16 | SNB 접힘/크기/키보드/보존/모바일 실기 | 검증 완료. CUA 로컬 QA 960px: sidebar244/main700→접힘main944; pointer272·keyboard+4·reload272; 390px drawer340·Tab 순환·Escape focus 복귀 |
| AT-17 | Track Entra 로그인/API/SSE/logout·공개 Basic 차단 | 검증 완료. 본인 consent(조직 동의 제외), 공개 로그인·snapshot/SSE·logout 후 비노출·재로그인. `track-server-verification.json` 공개401/위조·Basic 거부 |
| AT-18 | invocation/cowork/managed-child/peer를 구별·고유 Run 집계 | source 조사, 제품 미검증 |
| AT-19 | Projects 원본·Run 단위 binding 이력·서로 다른 완료 | 검증 완료. 실제 native QA Task A→B로 명시 Run 연결·재연결, A 원본 revision2와 당시 revision1 보존, stale revision409·동일 receipt·재시작 이력2건. Run 성공/Task todo·agent report/검증/수용 unknown 구별. bound Project 철회 시 공개 비노출·네 API404→복구 |
| AT-20 | Demian/Projects 문맥 요약·인증 조회·Track 장애 격리 | 기획, 제품 미검증 |
| AT-21 | 실제 Demian 실행을 Track에서 관측하고 재접속 대조 | 검증 완료. 실제 native Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c` 성공, canonical SSE17개·cursor17/highWater17. 제품 재시작 후 동일 원장·공개 Trace seq17 대조 |

현재 전체: **13/21 (61.9%)**. 동일 가중치 수용 조건 기준이며 작업량 추정치가 아니다.
AT-01/02/03/04/05/07/08/10/13/16/17/19/21을 검증했다. 취소·승인 지원을 재개·배정
완료로 계산하지 않는다. 전체 완료 예상 범위는 아직 산정 불가, 신뢰도 낮음.
Projects 원본 업무의 실행 참조/배정·문맥 요약, Assistant의 Track 읽기 principal, desktop
위치가 미확인이다. 다음 재산정은 Map/증거와 외부 앱 계약 연결 후다.

## 실행 순서

1. Demian-first: string int64 계약, metadata allowlist, durable SQLite 원장,
   Run snapshot·SSE adapter·binding 이력. 단독 실행도 업무 미연결로 수용.
2. 전체 Track, Trail, Trace, typed 실행 Map 및 목록, SNB·상태·deep link.
3. 실제 Demian 실행 연결, 보존/복구, Entra 제품 배포.
4. Projects 업무/권한·요약 연결, Demian 문맥 요약, Assistant/desktop
   계약·연결. 지원하지 않는 기능은 capability에 표시.
5. 명령/승인·업무 생성/배정의 source acceptance, 교차 앱 실기·운영 검증.

Projects가 Project/Task·수용 조건을 소유하고, Demian이 Session/Run·실행
권한을 소유한다. Track은 조회 투영·binding·명령 receipt를 소유한다.
Track 장애는 원본 대화/업무 편집을 막지 않아야 한다. AgentTrail 운영은
보존한다. 개인정보 원문·tool arguments·provider identity는 기본 수집하지 않는다.
