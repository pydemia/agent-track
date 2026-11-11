# Agent Track 개발계획

기준: 2026-11-11 KST · 제품 기획 v0.3 · 실행 goal 활성.
[전체 수용 기준표](goal-status.md)가 진행률의 단일 원본이다.

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

## 구현 구조와 현재 결과

| 영역 | 실제 경로 | 현재 결과·남은 검증 |
| --- | --- | --- |
| 계약 조사 | `docs/integration-contracts.md` | native API·인가·관계·공백 조사. 독립 worker 결과 수용 |
| 정규 계약 | `packages/contracts/index.ts` | 외부 ID, string int64, metadata allowlist, Run별 binding |
| 원장 | `packages/storage/store.ts` | SQLite journal, dedupe/gap/cursor, 조회 투영·binding 이력. 백업 선행 archive·dedupe tombstone, 운영 보존 적용 전 |
| Demian adapter | `packages/adapters/demian/` | Run/Session snapshot·per-Run SSE·활성 Run·명시적으로 허용한 메시지 entry 기반 과거 Run 탐색. 기존 private service credential 참조·실제 native Run17event 수집/재시작/공개 Trace 대조 |
| Projects·연결 | `packages/adapters/projects/`, `packages/bindings/` | 전용 reader·현재 ACL·원본 metadata7프로젝트28업무. 실제 QA Run A→B 연결/당시 revision·동일 receipt·재시작·scope 철회/복구 |
| 로컬 수집 | `packages/adapters/codex/` | 허용 저장소의 Codex turn/tool metadata. 원문 제외, 파일/기간/크기 한계 공개 |
| API | `apps/api/` | loopback 전용·Entra proxy 신뢰 key·사용자 source grant·snapshot/SSE·이력 paging |
| 산출물 | `apps/api/evidence.ts`, `ArtifactEvidencePanel.tsx` | native 세션 최근 목록의 Run별 미철회 metadata, 원문 제외·현재 인가 재검사. 실제 answer.txt 원본/API/공개 Trail 대조 |
| 화면 | `apps/web/` | Track/Trail/Trace/Map·source 상태·SNB·필터·URL·조회 이력 로컬 실기 확인. 공개 native 실행·SSO 실기 확인 |
| 복구 | `scripts/storage-admin.ts` | 온라인 backup·integrity·binding import. 복원 fixture와 실제 backup→별도 복원 DB/API 대조 통과. 운영 DB 전환 훈련과 구별 |
| 인증 준비 | `deploy/sso/`, `deploy/track/` | 전용 Entra 앱/credential 준비. Track 공개 로그인·API/SSE·logout·재로그인 검증 |
| 명령 | `packages/commands/`, `apps/api/commands.ts` | 단일 owner 명시 opt-in cancel·receipt·deadline·unknown·재시작·중복 방지. 실제 native 접수/취소 종료 확인, 재개/재시도 미지원 |
| 테스트 | `tests/` | 85개 통과, typecheck 통과. 실제 앱 교차 실행·규모 검증 전 |

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
  표시하지 않는다. 초기 승인은 원본 Demian에서 처리한다.
- Source grant와 Projects grant는 독립이다. 초기 owner 제한은 다중 사용자
  원본 인가 교집합 검증을 대체하지 않는다.
- Codex 수집 범위는 설정한 기간·파일 수·저장소에 한한다. Claude/desktop
  metadata는 구현 전까지 미지원이며 이름만 추가해 성공으로 표시하지 않는다.

## 검증과 완료 예상

현재 제품 수용 완료는 11/21 (52.4%)이다. 85개 deterministic test는 ID·재수신·int64·
민감 원문 제외·권한 거부·binding 이력·backup 복원의 기반 증거다. 브라우저,
native 실행, Entra, 교차 앱 실기 증거가 필요한 요구는 미완료로 유지한다.

전체 완료 예상은 아직 신뢰 있게 산정할 수 없다. Projects 문맥 요약·배정, Assistant의 신규 읽기 계약과 desktop 위치가 미확인이다. Demian credential과 실제 native 실행 연결은 확인했다. 다음
재집계는 원본 명령·문맥 요약 연결 후이며, 확인 가능한 잔여 작업과 외부
대기를 분리해 기록한다. 날짜나 fixtures를 실기 성공 대신 사용하지 않는다.
