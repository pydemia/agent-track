# Agent Track 개발계획

기준: 2026-11-12 KST · 제품 기획 v0.4 · 실행 goal 활성.
[전체 수용 기준표](goal-status.md)가 진행률의 단일 원본이다.

최신 증분: 세션별 managed-child/peer metadata consumer와 중첩 peer 문맥 그룹을
구현했다. 부모 Run·원격 Session이 없는 계약을 그대로 표시하고 실제 Run은
Session/Run 그룹에만 둔다. Windows552개 중543통과·실패0·9skip, typecheck·
분리 build와 합성 UI를 검증했다. 후속으로 원본 DB·role 암호화 백업/격리 복원과
읽기 전용 canary를 거쳐 API8080만 고정 bundle로 가동했다. 운영의 같은19Run·
810event·Entra 실제 Trace/그룹을 재확인했다. worker·원본 Web 요약·자동 startup,
실제 관계 실행은 남았다. `demian-api-reactivation.md`의 보존·대조 기록을 따른다.

## 제품 책임과 변경된 우선순위

Demian 대화 `01a1c901-2cea-7a21-9b38-8d12445f0a49`의 제안을 통합했다.
**독립 Agent Track + Demian 연결 실행 요약 + Projects 업무별 실행 요약**을
구현한다. Projects가 Project/Task·수용 조건을 소유하고, Demian이
Session/Run·실행·권한을 소유한다. Track은 조회 투영·원본 연결 이력과
명령 receipt를 소유한다. Assistant는 지시·소통, desktop은 로컬 접속/수집을
연결한다. 원본 업무를 독립적으로 복제하거나 Track 종료 상태로 완료하지 않는다.

초기 로그 대시보드 위주 순서를 **Demian-first 수집/관계 계약 → 실제 Run
한 개 → 전체 관측 UI → 문맥 요약 → 원본 명령/업무 관리**로 변경했다.
Codex metadata 수집은 병행한다. Demian 저장소의 Codex 로그가 있다는 것과
Demian native API 연결 성공을 구별한다. 원본 AgentTrail은 별도 운영한다.

2026-11-12 UI 우선순위: [업무·협업 Flow 개편](mission-ui-plan.md)에 따라 Track은 업무별 세션/Run 조직, Trail은 작업 경과, Trace는 호출·도구 실행 분석, Map은 명시된 업무·소속·위임·협업 관계로 나눴다. 실제 Pydemia FlowCanvas와 별도 인가 native lineage·tool 결과 조회를 사용한다. source에 없는 목표/의존 관계를 추정해 완성하지 않는다.

## 구현 구조와 현재 결과

| 영역 | 실제 경로 | 현재 결과·남은 검증 |
| --- | --- | --- |
| 계약 조사 | `docs/integration-contracts.md` | native API·인가·관계·공백 조사. 독립 worker 결과 수용 |
| 정규 계약 | `packages/contracts/index.ts` | 외부 ID, string int64, metadata allowlist, Run별 binding |
| 원장 | `packages/storage/store.ts` | SQLite journal, dedupe/gap/cursor, 조회 투영·binding 이력. 백업 선행 archive·dedupe tombstone, 운영 보존 적용 전 |
| Demian adapter | `packages/adapters/demian/` | Run/Session snapshot·per-Run SSE·활성 Run·명시적으로 허용한 메시지 entry 기반 과거 Run 탐색. 기존 private service credential 참조·실제 native Run17event 수집/재시작/공개 Trace 대조 |
| Projects·연결 | `packages/adapters/projects/`, `packages/bindings/` | 전용 reader·현재 ACL·원본 metadata7프로젝트29업무. 실제 QA Run A→B 연결/당시 revision·동일 receipt·재시작·scope 철회/복구 |
| 로컬 수집 | `packages/adapters/codex/` | 허용 저장소의 Codex turn/tool metadata. 원문 제외, 파일/기간/크기 한계 공개 |
| API | `apps/api/` | loopback 전용·Entra proxy 신뢰 key·사용자 source grant·snapshot/SSE·이력 paging |
| 파일 근거 | `apps/api/files.ts`, `packages/projection/file-changes.ts`, `FileEvidencePanel.tsx` | native 파일 편집의 원본 요청·성공/실패 연결, 단순 요청/모호함 구분. 실제4Run·파일/hash·공개 Trail·모바일·철회/복구·원장 불변 대조 |
| 산출물 | `apps/api/evidence.ts`, `ArtifactEvidencePanel.tsx` | native 세션 최근 목록의 Run별 미철회 metadata, 원문 제외·현재 인가 재검사. 실제 answer.txt 원본/API/공개 Trail 대조 |
| 화면 | `apps/web/` | Track/Trail/Trace/Map·source 상태·SNB·필터·URL·조회 이력 로컬 실기 확인. 공개 native 실행·SSO 실기 확인 |
| 복구 | `scripts/storage-admin.ts` | 온라인 backup·integrity·binding import. 복원 fixture와 실제 backup→별도 복원 DB/API 대조 통과. 운영 DB 전환 훈련과 구별 |
| 인증 준비 | `deploy/sso/`, `deploy/track/` | 전용 Entra 앱/credential 준비. Track 공개 로그인·API/SSE·logout·재로그인 검증 |
| 명령 | `packages/commands/`, `apps/api/commands.ts` | 단일 owner 명시 opt-in cancel·receipt·deadline·unknown·재시작·중복 방지. 실제 native 접수/취소 종료 확인, 재개/재시도 미지원 |
| 승인 | `packages/approvals/`, `apps/api/permissions.ts`, `RunApprovals.tsx` | native 요청/명시 검토·fingerprint·scope/expiry·receipt/unknown·권한 재확인. 실제 단일 호출 허용/거절/자동 만료·철회/복구·모바일 대조 |
| 테스트 | `tests/` | 코드 CI552개: Windows543통과/9skip, Ubuntu542통과/10skip·실패0. typecheck·build 통과. 원본 DB 복구·실제 API/Entra 대조는 별도 증거로 구별 |

Node 24 LTS의 `node:sqlite`, TypeScript 5.9.3, React 19, Vite 8을 사용한다.
한 서버의 journal writer부터 시작한다. 다중 사용자 source 권한 위임은 별도
native 계약이 필요하다. 서비스 계정의 원본 권한이 모든 Track 사용자에게
자동 상속된다고 가정하지 않는다. 초기 배포는 명시한 소유자 계정만 허용한다.

## 남은 단계와 수용 조건

| 작업 | 결과와 순서 | 요구 |
| --- | --- | --- |
| DEV-01 계약 보강 | Demian service principal·Projects 외부 참조·Assistant 읽기 feed·desktop 경로 확인 | AT-01/06/07/14/18~20 |
| DEV-02 원장 검증 | immutable sequence, replay conflict, gap, restart, metadata 제한을 native 실행과 대조 | AT-01~05/18/19/21 |
| DEV-03 실기 UI | 전체 프로젝트·URL 선택 복구·미연결/권한/stale·네 보기·favicon·SNB pointer/keyboard/mobile | AT-02~08/12/15/16 |
| DEV-04 제품 배포 | Track 전용 Entra 로그인/API/SSE/logout, 공개 Basic 거부, 상시 startup·Cloudflare·복구 | AT-07/13/17 |
| DEV-05 원본 연결 | Projects read/ACL 및 Run binding, Demian/Projects 요약, Assistant/desktop 실제 연결 | AT-06/11/14/19~21 |
| DEV-06 명령·승인 | native capability, actor/grant·만료·철회·expected_version·idempotency·receipt와 timeout unknown | AT-09~11 |
| DEV-07 관계·운영 | invocation/cowork/managed-child/peer·dependency·artifact, 순환·고립, retention·장시간·규모/교차 앱 | AT-12~14/18 |

DEV-02~04는 현재 착수했다. 실제 Run 관측 경로를 먼저 완성하고 조회 MVP를
검증한다. 이 단계가 끝나도 전체 goal의 명령·Projects·Assistant·desktop·운영
조건을 완료 처리하지 않는다. 외부 앱 변경은 해당 저장소 지침과 기존 변경을
보존해 별도 patch로 관리한다. Track 장애가 Demian 대화나 Projects 편집을
막지 않도록 조회 요약을 비필수 경로로 구성한다.

## 지원 범위를 표시하는 규칙

- Demian에는 전역 과거 Run feed가 없다. 명시 Run + 권한 있는 세션의 현재
  Run과 명시적으로 허용한 세션 메시지 entry의 Run ID를 탐색한다. 메시지 원문은 저장/표시하지 않는다. sequence_text는 끝까지 문자열이며 message cursor와 섞지 않는다.
- invocation/cowork는 별도 Run 수에 합산하지 않는다. managed child/peer는
  별도 API 권한·근거를 받아야 하며 기본 event stream만으로 생성하지 않는다.
- Projects task revision과 Run별 binding 이력을 보존한다. 재연결이 과거 실행
  업무를 덮지 않으며 검증·agent report·Run 종료·업무 수용을 구분한다.
- 미지원 명령을 실행 버튼으로 제공하거나 요청 전달을 source acceptance로
  표시하지 않는다. 현재 단일 소유자는 Track에서 원본 요청을 검토하고 native 결정 API로 처리한다.
- Source grant와 Projects grant는 독립이다. 초기 owner 제한은 다중 사용자
  원본 인가 교집합 검증을 대체하지 않는다.
- Codex 수집 범위는 설정한 기간·파일 수·저장소에 한한다. Claude/desktop
  metadata는 구현 전까지 미지원이며 이름만 추가해 성공으로 표시하지 않는다.

## 검증과 완료 예상

현재 제품 수용 완료는 동일 가중치14/21 (66.7%)이다. 312개 deterministic test는 ID·재수신·int64·
민감 원문 제외·권한 거부·binding 이력·backup 복원의 기반 증거다. 브라우저,
native 실행, Entra, 교차 앱 실기 증거가 필요한 요구는 미완료로 유지한다.

Node group의 계획·구현은 `mission-ui-plan.md`의 AT-12 보완에 연결했다.
원본/명시 binding과 사용자 화면 묶음을 구분하고, 중첩 접힘·내부 탐색·깊이 preset·
원본 관계 상세를 제공한다. 공개 Projects 업무2개·선행 관계1개, Codex Run1개·도구4개의
실기는 `node-groups-verification.json`에 기록했다. 대표 경계선·10,000-depth는 순수
projection 검사이며 실제 대규모 브라우저 성능이나 child/peer 조직화 실기를 대신하지 않는다.
사용자의 in-depth 요구에 따라 그룹 개발 순서는 **묶음 요약 → 내부/외부 문맥 탐색
→ 네 화면 공통 범위 → 저장 보기**로 구체화했다. 앞의 세 단계는 현재 metadata
범위에서 구현했으며 실제 조직화 업무의 전체 실기와 저장 보기는 남았다. 기존 그룹 동작은 유지하며
저장 기능만으로 내부 흐름의 설명을 대신하지 않는다. 상세 시나리오와
AT-12-G01~G05는 `mission-ui-plan.md`의 작업 묶음 중심 탐색에 연결한다.

| 순서 | 변경 범위·의존성 | 구현 위치·수용 증거 | 현재 상태 |
| --- | --- | --- | --- |
| 1. 묶음 요약 | 현재 허용된 구성/상태·대기·산출물 근거를 연결. 원본 목적/입력/수용 조건 미제공과 부분 관측 구분 | `packages/projection/flow-group-context.ts`, `apps/web/src/FlowGrouping.tsx`. AT-12-G03, 혼합 단위·실패/미확인 검사 | 현재 metadata 구현. 원본 의미 필드 추가는 producer 계약에 의존 |
| 2. 내부/외부 문맥 | 그룹별 펼침·내부 초점·breadcrumb, 외부 선행/후속과 원본 끝점 이동·상위 복귀 | `FlowGrouping.tsx`, `flow-group-layout.ts`, `flow-navigation-state.ts`. AT-12-G01/G02, 경계 대표선·선택/viewport 검사 | 현재 화면 구현. 실제 복합 분기·합류 업무의 전체 왕복 검증은 남음 |
| 3. 공통 범위 | 현재 허용된 멤버를 네 화면에 전달. Trail은 Run별 lane, Trace는 실행별 흐름, Track은 업무별 요약 유지 | `packages/projection/group-workspace-scope.ts`, `apps/web/src/group-workspace-client.ts`와 네 소비 화면. AT-12-G04/G05, 전환·철회·동일 ID 구별 | 구현·합성 UI/HTTP 검사·게시 확인. 현재 운영 Entra GUI와 전체 실제 조직화 검증은 남음 |
| 4. 저장 보기 | 계정별 멤버 ID·묶음 이름·접힘 상태 저장과 재접속 시 원본 권한 재검사 | `saved-flow-views.md`, AT-12-G06. 계정 분리·CAS·재접속 복원·권한 철회와 새 관측 후 철회 검사 | 구현·격리 HTTP/SQLite·합성 UI 검사. 운영 DB/설정 backup·API/정적 경로 분리와 실제 owner 게시 검증은 남음 |

1단계 중 현재 제공되는 metadata의 단위별 상태·명시된 대기/실패/검토·선행/후속
업무·산출물 관계 요약과 원본 상세 이동을 구현했다. 고유 Run/산출물 중복과
그룹 밖의 충돌도 대조하며, 목적·입력·수용 조건은 원본 미제공으로 표시한다.
이 구현을 전체 업무의 수용 완료나 실행 차단 판정으로 계산하지 않는다.
2단계의 현재 화면 내 선택·접힘·viewport 복원과 경계 상세 왕복도 구현했다.
동일 구조 재조회는 이력을 유지하고 계정/구조 변경은 이전 ID를 제거한다.
3단계 공통 범위도 구현했다. 네 보기 전환 시 같은 source-qualified 업무·Run·
Assistant 실행을 유지하고 현재 권한과 명시 연결을 재검사한다. 선택한 역할의
관련 Run은 원본 소속을 바꾸지 않는 경계 문맥으로 제공한다. Trail/Trace는
실행별 근거를 분리하고 하위 역할 표는 선택 범위로 제한한다. 역할 귀속 없는
Assistant 전체 이력은 하위 묶음 이력으로 표시하지 않는다. 합성 UI와 HTTP
경계 검사·Windows/Ubuntu CI를 통과한 구현을 Track API/프런트엔드에 게시했다.
운영 API·assets 대조와 현재 Entra GUI 검수를 구분하며, 후자와 실제 조직화
시나리오·4단계 저장은 후속이다.

2026-11-13 그룹 UI 상세 기획은
[Task 묶음의 흐름 해석](mission-ui-plan.md#task-묶음의-흐름-해석)에 추가했다.
순차·분기·합류·위임·재시도·공유 작업의 표현과 원본 근거를 구별하고,
그룹 선택 → 선택한 가지 펼침 → 원본 끝점/실행 상세 → 상위 복귀의 동작을
기존 구현과 대조했다. 구현한 공통 범위는 현재 화면 묶음의 멤버 ID와
권한 재검사 계약을 바탕으로 Map → Trace → Trail → Track 이동에
연결한다. 계정별 저장은 후속이다. 새 구현 검증에는 동일한 분기·합류
사례와 승인 대기·실패·공유 Session·철회·모바일을 사용하며, 실제 협업 실행과
합성 fixture를 별도로 기록한다. 이 기획 보완으로 수용 완료 수를 올리지 않는다.

원본 목표·work package·대기 원인이 제공되지 않는 경우 사용자 화면 묶음과
미확인 상태로 표현한다. UI 계층을 위해 새 실행 관계를 추론하지 않는다.
실제 child/peer 조직화·교차 앱 업무의 검증은 기존 AT-12/14/18 잔여 조건으로 유지한다.

2026-11-13 실제 coordinator QA는 정렬 담당을 선택하는 모델 호출까지 진행했으나
child runtime의 `delegate_agent` 실행 연결이 없어 하위 실행 전 실패했다. Run은
제한 시간에 취소했고 원본에는 호출 종료 이벤트가 없었다. 이 사례를 바탕으로
명시된 호출 취소와 Run만 종료된 호출의 종료 미확인을 구별하도록 Trace·그룹
요약을 수정했다. 원본 event와 digest 형식은 변경하지 않았다. 중첩 위임 수정은
현재 권한 재검사·대상 provider authority·cwd와 작업 범위·durable context를
보존해야 하며 cowork/scoped member의 재위임을 자동 허용하지 않는다.

후속 `d0aaa0b`에서 일반 child의 중첩 위임을 수정하고 관련140검사·계정별 문맥과
권한 철회·terminal 저장 중 취소를 검증했다. 새 frozen release의 별도 실제 QA는
coordinator의 두 specialist 위임과 최종 종합까지 성공했다. Track의 원본 invocation
관계/lifecycle 중복 선을 근거 보존 방식으로 정리하고 실제 그룹 상세·하위 범위·
네 보기로 대조했다. 운영 native worker 전환·cowork/peer·전체 교차 앱·추가 기기는
잔여 조건이다. 호출 이름은 UUID를 이름으로 추정하지 않고 별도 인가된 configured
Agent metadata 읽기 계약으로 보강하며 기존 immutable event digest를 변경하지 않는다.

전체 완료 예상은 아직 신뢰 있게 산정할 수 없으며 신뢰도는 낮다. Projects 원본 업무 생성·기존 Session 배정은 실제 접수와 성공까지 대조했다. 문맥 요약의 Track API·서버 client·host component와 Projects BFF·개요/목록/상세 연결을 소유자 QA 범위에서 운영 확인했다. 같은 실행의 Map 이동·실제 연결 장애 중 업무 생성/수정·자동 복구도 대조했다. 실제 Projects dependency 조회·Map과 철회 시 그래프/URL 제거도 운영 확인했다. Demian 대화 요약·장애 격리는 분리 native web에서 확인했으나 원본 Web 적용은 보류 중이다. Demian API-only는 보존 검증 후 재가동했고 worker는 중단 상태다. Assistant v1 native reader·전용 credential·Track UI는 운영 확인했고, v2 소비자의 명시적 출처 mapping·현재 권한/receipt 대조와 역할→Run 관계도 구현했다. v2 원본 전환·실제 producer/실행 준비, desktop 의미·위치·다른 장치 연결은 남았다. 다음
재집계는 실제 child/peer·원본 앱 문맥 요약 연결 후이며, 확인 가능한 잔여 작업과 외부
대기를 분리해 기록한다. 날짜나 fixtures를 실기 성공 대신 사용하지 않는다.
