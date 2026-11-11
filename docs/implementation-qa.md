# 구현 QA 기록

기준: 2026-11-11 KST · native 관측/취소 변경 working tree. 실제 revision은
Git 기록과 대조한다. 최초 commit `1fadf6c`의 원격 CI 성공을 이후 변경의
성공으로 대신하지 않는다.

## 현재 검사

| 검사 | 결과 | 한계 |
| --- | --- | --- |
| `npm test` | 117개 통과·실패0·skip0 | fake HTTP/native fixture와 실제 서비스 실기를 구분 |
| `npm run typecheck` | 통과 | TS5.9.3·Node24.21.0 |
| `npm run build` | 통과 | React19·Vite8. 최신 변경 후 build/배포 대조 기록 확인 |
| 실제 Demian 관측 | native Run 성공, source SSE17개와 원장·cursor17 일치, 재시작/공개 Trace 대조 | 전역 과거 feed가 아닌 허용 세션 기반 |
| 실제 Demian 취소 | 격리 Run native accepted→cancelled, 같은 UUID receipt 일치 | CLI operator HTTP 검사. 공개 UI는 종료/receipt 확인, 클릭 전송 실기 남음 |
| 실제 Codex 수집 | 허용 Git 폴더·최근7일·최신100파일 | 한 PC. native Demian/desktop bridge와 별도 |
| 원장 복원 | 실제 online backup→별도 DB→loopback API232Run·17,456event, cursor/receipt digest 정합 | 운영 DB 경로 전환하지 않음. 실제 binding/pending0은 fixture로 보완 |
| 보존 | backup 선행 명시 archive, tombstone/dedupe/cursor/incomplete fixture | 자동 삭제 비활성. 실제 운영 이력은 삭제하지 않음 |
| 공개 인증 | Entra 본인 동의·로그인/API/SSE·logout·재로그인, 미인증/Basic/위조401 | 단일 owner. 타 앱 ACL·다중 사용자 위임 미완료 |
| favicon | 인증 후 관측한 public SVG/ICO와 build bytes/hash 일치, 탭 표시 | 자산/연결 변경 시 다시 검사 |
| AgentTrail | 별도 프로세스/DB/Entra 경로 보존 | benchmark 앱 검증은 제품 기능 완료로 계산하지 않음 |

실기 JSON은 `native-observation-verification.json`, `native-cancel-verification.json`,
`live-restore-verification.json`, `track-browser-verification.json`에 있다.
`track-server-verification.json`의 browserLoginVerified=false는 해당 CLI 검사의
범위이며 실제 브라우저 결과는 별도 기록에 있다.

## Projects 실제 읽기와 권한

기존 service API에 별도 Track reader를 등록했다. scope는 projects:read/tasks:read,
원본의 현재 account/project ACL을 사용한다. 실제7개 프로젝트·26개 업무를
원본/BFF/공개 Entra UI에서 대조했다. 전용 reader의 한 Project 접근만 제한해
6개/25개·대상 Task API404·공개 제목/선택지 제거를 확인하고7개/26개로 복원했다.
기존 Assistant principal과 native 업무 자료는 변경하지 않았다. 다른 Actor가
owner reader를 차용하지 못하는 경우와 bound Run의 Project ID 교집합을 검사했다.
과거 snapshot이 철회 뒤 데이터를 되살리지 않도록 BFF process epoch/version을
native event cursor와 별도로 사용한다. 업무 binding/배정·다중 사용자 principal
구성·Assistant 읽기 연결은 별도 미완료다(`projects-live-verification.json`).

## Trace 단계·도구

실제 Demian 개발 세션의 Codex Run13event에서 5개 tool의 시작/완료와
관측 구간740/784/836/908/680ms를 공개 UI에서 대조했다. invocation ID는
원본에 없어 unknown으로, call ID가 없는 이벤트1개는 묶지 않고 표시했다.
시작/종료 상태를 업무 수용·검증 결과로 바꾸지 않는다. 실제 native Run은
17event metadata와 단계 미제공 상태를 확인했다. int64·tuple 충돌·중복/역순·
불완전/충돌/시각 역행·상위 invocation 불일치8개 검사를 통과했다.

## 산출물 metadata

실제 native Run의 answer.txt(40bytes) metadata와 Track API/public Trail의
filename·hash·size를 대조했다. 원문/content URL은 요청하지 않았다.
최근117개 세션 목록의 exact Run·미철회 metadata만 내보내며 전체 이력으로
표시하지 않는다. 다른 Run/세션 첨부·철회·잘못된 manifest·중간 인가 철회를
fixture로 검사했다(`native-artifacts-verification.json`).

## 브라우저와 UI

- 전체5저장소와 native workspace를 함께 조회. 프로젝트/source 필터·해제·
  Run 선택·Trace/Trail·뒤로 가기를 확인했다. 필터 ID는 source 포함 opaque key다.
- SNB960px: sidebar244/main700.8→접힌 main944.8. pointer272·keyboard+4·
  reload272. 390×844: 기본 닫힘·overflow 없음·drawer340, Tab 순환·Escape focus 복귀.
- 공개 Trace의 실제 native seq17·redacted 및 취소된 Run의 receipt/종료 상태를 확인했다.
- 별도 local QA14347은 공개 배포와 분리한 GET-only loopback BFF로 변경했으며
  현재 종료했다. private proxy credential은 서버에만 있고 공개 local-auth 경로는 없다.
- 분리 loopback QA에서 네 빈 보기·503/복구·stale·철회·401 만료를 검사했고 임시 탭/프로세스를 종료했다. native 취소 확인 폼 클릭은 미검증이다.

## 리뷰 반영

Source ID 재사용 시 stale connected state가 남던 실패를 durable identity pin으로
수정했다. SNB grid·이벤트 paging/tail race·source 철회 시 UI cache를 수정했다.
늦은 snapshot 응답과 이전 SSE handler가 철회 후 데이터를 되살리지 않도록
abort/generation/stream identity를 검사한다.

취소 리뷰는 이미 cancelling인 Run에 추가 dispatch되는 실패를 재현했다.
원본 상태 관측만 남기고 전송하지 않도록 수정해 회귀 검사를 통과했다.
native 수집의 늦은 허용 SSE가 다른 Run의403 캐시를 재노출하던 실패도 재현/수정했다.
출처 전체 snapshot/event 인가 후 connected를 게시하며 단일403이면 보수적으로
출처 전체 캐시를 숨긴다. 서로 다른 UUID의 동시 요청도 actor/Run 단위 SQLite transaction으로 막는다.
unknown 요청은 재시작해도 재전송하지 않는다. 원본 cancel의 atomic cursor
조건은 지원되지 않는 한계로 명시했다(`cancel-review.md`).

## 전체 수용

[goal 기준표](goal-status.md)의 **13/21(61.9%, 동일 가중치)**다. 테스트 수나
배포 경로 준비를 전체 달성률로 환산하지 않는다. 전체 일정은 Projects/
Assistant 계약과 desktop 위치 미확인으로 산정 불가·신뢰도 낮음이다.
다음 재산정은 Map/증거와 외부 앱 계약 연결 후다.

## 명시적 Run binding 구현·실기

Track 원장에만 연결을 기록한다. POST /api/bindings는 정확한 Origin, 단일
Entra 소유자, 최신 native Run/Task와 Project 범위를 확인한다. 요청 UUID와
예상 binding version으로 append/current/receipt를 한 트랜잭션에서 저장한다.
원본 Task 생성·배정·완료와 구별한다. GET /api/runs/:key/binding은 현재
접근 가능한 Project 이력만 반환한다. Artifact/취소 경계도 awaited source
조회 뒤 Project grant를 갱신한다.

실제 QA Task2개를 원본 UI에서 생성했고, 기존 격리 Run을 A→B로 연결했다.
A의 원본 revision2 수정 후 stale 선택 저장409, 연결 당시 revision1 보존,
첫 요청 재수신 시 동일 receipt/이력2건, 제품 재시작 후 보존을 확인했다.
Run은 succeeded, 두 원본 Task는 todo다. 별도 reader scope에서 QA Project를
빼면 공개 metadata가 숨겨지고 binding/events/artifacts/commands가404,
복구 후 이력2건/7프로젝트28업무가 돌아왔다. 기존 Assistant principal과
업무 자료는 유지했다. 증거: native-binding-verification.json.

390px에서 document client/scroll 모두375px, 연결 이력2건과 Tab→프로젝트
선택을 확인했다. 일시 viewport를 복구하고 QA 탭을 닫았다.117개 테스트는
CAS·actor receipt·Run 격리·int64·롤백·재시작/backup·권한 철회 경계를 포함한다.

## Native 승인 요청·결정

현재 단일 Entra 소유자의 명시 approvalUsers opt-in에 한한다. metadata 목록은
도구/요청/만료/상태와 검토 fingerprint만 내보낸다. 사용자가 요청 내용을
열 때만 현재 인가로 tool input/reason을 조회하며, UI 닫기·만료·철회·선택
변경 시 제거한다. 원문은 원장·receipt에 저장하지 않는다. 승인 목적의 명시
조회와 기본 metadata 수집을 구별한다.1MiB transport/64KiB review 제한을
넘으면 blind approval을 허용하지 않는다.

결정은 allow_once/allow_session/deny다. 세션 허용은 같은 세션/같은 도구의
후속 호출까지 포함한다고 명시한다. source request의 identity/input/tool/expiry
fingerprint·native Run/Project 인가를 새로 확인하고 원본 API가 pending/expiry를
원자적으로 재검사한다. Track client deadline은120초 이내다. 요청 UUID receipt와
actor/Run/permission별 미확정 요청 선점으로 중복·반대 결정을 막는다. 단절·
재시작 unknown은 읽기만 수행하며 재전송하지 않는다. 결정 반영과 도구 실행
성공은 별도다. 기존 결정을 관측한 경우 전송하지 않았음을 명시한다.

실제 QA: native fileChange1회 허용·동일 receipt·30byte 파일/hash 대조,
공개 UI 거절·파일 없음, 원본 자동 expiry·Track 결정0·파일 없음, 유효한
client deadline의 late 허용 요청도 expired로 차단·원본 불변을 확인했다.
Project reader scope7→6에서 열어 둔 검토 인자/Run 제거·metadata/review/receipt
각404, 원본 요청은 pending 유지, scope7복구를 대조했다. 원본 expiry를
앞당기거나 보안 설정을 완화하지 않았다. 별도 QA 세션의 allow_session도 확인했다. 도구2회를 실행하고 native 승인
요청은1건이었다. 이름을 고정한 새 QA 파일2개만 생성했으며 첫 호출의
요청 내용을 검토하고 범위 경고를 표시했다.117개 테스트와 독립 리뷰 보강,390px client/scroll375px,
Tab으로 범위 버튼 탐색, 만료 후 raw 인자 제거를 확인했다.

첫 builtin write_file 요청은 Codex provider에서 도구 미제공으로 종료됐다.
원본 native editor로 다시 검증했고, 이 첫 실행을 승인 성공으로 계산하지
않았다. 현재 external fileChange feed는 편집 제안과 도구 완료를 별도 제공하고 file.diff
event는 내보내지 않는다. 아래 원본 파일 조회가 두 근거를 연결한다.
증거는 native-approval*-verification.json과 해당 공개 화면 기록이다.

## 원본 파일 변경 근거

GET /api/runs/:key/files는 현재 원본 인가와 Project grant를 확인하고, 원장
관측 high water까지만 native SSE를 재조회한다. 원본이 권한 철회로 스트림을
조용히 닫을 수도 있어 조회 후 native Run을 다시 읽고 Project 인가도 갱신한다.
원문·patch·tool input/output를 내보내거나 저장하지 않는다. 기존 정규 이벤트
해시/cursor는 재작성하지 않는다.

정확한 codex-app-server/fileChange 요청의 경로·operation과 같은 call/invocation의
성공 완료를 연결한다. 요청만으로 변경 성공을 만들지 않는다. 실패·누락·재사용·
충돌은 failed/pending/ambiguous로 구분하며 직접 workspace diff 이벤트도
경로 metadata만 취한다. 실제 파일 최종 상태·일반 filesystem diff를 보증하지
않는다. 최대2000events/8MiB, 요청당100경로, 표시500행이며 한도·gap·부분
범위를 표시한다. 네이티브 source feed를 보강하기 전의 bounded replay 계약이다.

실제4Run: 성공한 단일/세션 허용 편집의3파일이 각각30byte/hash와 일치하고
요청/완료seq가 연결됐다. 거절/만료의2요청은 실패 근거·파일 없음으로 대조했다.
조회 전후 immutable event digest/payload가 같았다. 공개 Trail 성공2파일·실패
구분,390px client/scroll375px·Tab 목록focus, reader scope7→6에서 파일 API404와
경로 제거→7복구를 확인했다.117개 전체검사 중16개 신규 검사는 pairing·출처/
invocation·int64·중복·역순·경로/원문·표시/전송/이벤트 한도·native/Project 철회를
다룬다. 증거는 native-files-verification.json이다.
