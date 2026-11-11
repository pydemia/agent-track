# 원본 앱의 실행 문맥 요약 계약

기준: 2026-11-12 KST. AT-20의 Track 측 읽기 API·서버 client·React 요약 component를
구현했다. 원본 Demian/Projects BFF·화면 연결은 아직 하지 않았다. 전체 goal은
동일 가중치14/21(66.7%)이며 이 준비를 실제 원본 앱 통합 완료로 계산하지 않는다.

## 조회 대상과 응답

버전 prefix는 `/api/integrations/context/v1`이다. GET만 허용하고 query/body는 받지 않는다.

| 문맥 | 경로 | 필요한 명시 범위 |
| --- | --- | --- |
| Projects Project | `/projects/{sourceId}/{projectId}` | Project scope + 허용 native source |
| Projects Task | 위 경로 + `/tasks/{taskId}` | Project scope·현재 원본 Task/Project 일치 |
| Demian Session | `/sessions/{sourceId}/{sessionId}` | 해당 source/Session scope |
| Demian Run | `/runs/{sourceId}/{runId}` | 현재 관측된 Run의 source/Session scope |

원본 ID는 UUID이고 source ID는 등록된 식별자다. Project/Task는 명시 Run binding으로
연결된 실행만 조회한다. Session은 해당 Session의 관측 Run을 조회한다. 따라서 같은
Task에 Run2개가 연결돼도, 그 Session에는 과거의 다른 Run이 함께 존재할 수 있다.
제목·발생 시각의 유사성으로 업무나 세션을 연결하지 않는다.

응답 `version=1`은 요청 context, 최대50개의 source-qualified 고유 Run, Session 수와
정확한 상태별 개수, 관측 시각·문자열 cursor/highWater, stale/incomplete, 원본 Task
현재 revision/state/시험 여부, binding 당시 revision과 Track 링크를 담는다.
원문·제목·도구 인수/출력·파일 경로·provider credential·사용자 identity는 제외한다.
`coverage.kind=observed-window`는 전체 이력이 완전하다는 뜻이 아니다. 한도와 조회 실패를
분리하며, 실패한 원본 Run을 cached 성공으로 내보내지 않는다. 링크는 자격 정보 없는
Track URL이며 연결된 Run이 없으면 null이다. Task의 `todo`와 Run의 `succeeded`는 별개다.

## 서비스 인증과 원본 인가

공개 웹은 기존 Entra 로그인·proxy 경로를 유지한다. 이 API는 loopback peer와 literal
loopback Host의 private hop에서만 별도 reader credential을 받는다. Origin·forwarded
identity·proxy key header가 있으면 거부한다. 공개 Entra endpoint를 service key 우회
경로로 열지 않으며 username/password 로그인을 추가하지 않는다.

요청 header는 `Authorization: Bearer <reader key>`와 `X-Track-Context-Reader: <id>`다.
키는32–256자 base64url이며 서버 파일에서 매 요청 읽는다. Entra client secret, 전체
proxy key나 원본 runtime credential을 재사용하지 않는다. 파일 경로와 실제 키 값 모두
proxy/다른 reader와 분리한다. 구성한 키가 없거나 형식/값이 중복되면 양쪽 인증을
fail closed한다. key 값을 URL·브라우저·소스·로그에 넣지 않는다.

`contextReaders`는 기본 미구성이다. 각 reader는 단일 기존 Track 사용자에 고정되며
`purpose`, `nativeSourceIds`, `projectScopes`, `sessionScopes`를 명시한다. purpose는
감사 용도이고 실제 접근 범위는 명시 scope의 교집합이다. 서비스가 caller 입력으로
다른 사용자를 선택할 수 없다. 모든 조회는 현재 root/source grant·Projects native ACL을
확인한다. 각 Run은 native Run/Session을 새로 읽고 source identity·binding·현재 Project
범위를 다시 검사한다. 접수됐지만 binding이 복구 중인 Run도 배정 원본 Project scope를
벗어나면 제외한다. token 회전·scope/source 변경 중의 결과를 사후 인가 없이 내보내지 않는다.

현재 운영 opt-in은 QA Project1개에 한정한 `projects-context-qa`, `demian-context-qa`다.
후자는 기존 QA Session2개를 명시한다. 키·설정은 private state에 있다. Projects는 소유자
QA Project 한 개에만 opt-in했다. Demian은 분리 native web에서 QA Session 두 개를
실제 연결·검증했으며 원본 web 적용은 보류 중이다. 이는 다중
사용자의 native 권한 위임 계약이 아니다.

## 원본 앱의 소비 방식

`packages/context/client.ts`는 Node 서버 전용이다. credential file을 새로 읽고, literal
loopback origin에서 고정 GET만 수행한다. 응답512KiB·2초 deadline·redirect 거부,
정확한 context/counts·Track URL origin 검증을 적용한다. 401/403/404는 데이터 없는
`forbidden`, 단절/기한/손상은 `unavailable`이다. retry·cache·명령 실행은 하지 않는다.
늦은200·정지한 body도 deadline을 넘겨 성공으로 돌아오지 않고 body를 정리한다.

원본 BFF는 이 client를 호출하기 **전에** native 로그인 사용자와 해당 Project/Session의
접근을 확인해야 한다. 현재 owner-bound reader는 같은 소유자의 요청에만 사용할 수 있다.
기존 서비스 key를 임의 native 사용자에게 빌려주면 안 된다. 다른 사용자는 그 사용자의
별도 원본/Track 인가와 reader 계약을 구성한 뒤 지원한다. Projects BFF에는 같은 owner와
현재 Project/Task 인가를 조회 전후 연결했다. Demian BFF도 기존 trusted owner의
actor·organization·role·auth mode와 Session/workspace를 조회 전후 확인한다.
원본 cookie가 있으면 해당 credential이 우선하며 잘못된 cookie를 서버 key로 대체하지 않는다.

`packages/context/ExecutionSummary.tsx`는 host React component다. BFF가 검증한 결과를
prop으로 받으며 browser fetch·token·iframe·실행 명령은 없다. 관측 Run/Session·상태,
원본 업무 상태/revision과 Track 확대 링크를 표시하고 전체 ID는 펼침 안에 둔다. host
브랜드와 탐색을 유지하며 이 optional 조회의 오류가 대화 입력·업무 편집 경로로 전파되지
않게 원본 앱에서 별도 상태로 렌더링해야 한다.

`node scripts/build-context-client.mjs`는 private QA용 standalone Node22+ client bundle과
source/bundle SHA-256을 `.runtime/context-client/`에 만든다. 원본 앱의 BFF 설정·권한 검사는
이 bundle로 대체되지 않는다.

## 확인한 증거와 남은 조건

테스트214개·typecheck·build가 통과했다. SQLite/HTTP fixture는 원본 Task/native 상태,
권한·key 회전·scope 변경, 일반 API/명령 차단, pending binding·부분 조회를 검사한다.
독립 검토에서 서로 다른 key file의 동일값 문제를 재현한 뒤 실제 값의 분리를 추가했고
회귀 검사·독립 재검토로 해결을 확인했다.

Linux 원본 앱 호스트에서 이미 보유한 Node24.21.0 image의 임시 read-only helper로
실제 private bridge·reader 두 개를 사용했다. QA Task Run2/Session2/성공2·`todo`, 해당
Session의 관측 Run2, 범위 밖 거부·단절 시 데이터 없는 오류를 대조했다. Task 조회는
단일 측정728ms이며 SLA/p95가 아니다. SDK bundle hash·키 파일0600/폴더0700을 확인했고
새 native Run·원본 업무 변경은 없었다. `native-context-summary-verification.json`이
기계 판독 근거다. 공개 미인증401·기존 Basic/위장 거부·favicon bytes/hash도 재대조했다.

Projects 원본 BFF·개요·Task 목록/상세 연결은 소유자 QA Project 한 개에서 운영 검증했다.
현재 로그인과 native Project/Task ACL을 조회 전후 검사하며, account-ID로 keyed된 기존
Workbench가 계정 변경/로그아웃 때 해당 상태를 해제한다. scope 전환 중 늦은 결과와
철회된 이전 활동 badge는 제거한다. 업무 행마다 새 조회하지 않고 Project 요약에서 파생한다.

실제 Task의 Run2/Session2/성공2와 원본 todo/r1을 별도로 표시하고 같은 실행의 Track Map
이동을 Entra 로그인까지 대조했다. 전용 socket bridge만 끊었을 때 기존 실행 표시가 사라지고
불러오기 실패를 표시했다. 같은 시점에 새 QA Task 생성·수정 저장(r2)이 성공했으며 기존
Task는 r1/todo를 유지했다. bridge 복원 뒤 요약은 자동 회복했다. 390px·Tab/Enter도 확인했다.

원본 source archive335파일·운영 payload92파일 대조 후 분리 snapshot에 작은 patch만
적용했다. PostgreSQL432·web288 검사, 정적 검사·표준 build·favicon 검사와 독립 검토를
통과했다. 배포는 exact base image 위의31파일 layer이며 DB/ingress container·기존 환경·
mount/command/user·private mount hash와 schema0016을 보존했다. 원본 checkout 수정은
없다. `projects-context-native-ui-verification.json`, `projects-context-public-verification.json`,
`../integrations/projects/README.md`가 근거다.

Demian 대화의 BFF·요약 UI는 같은 설치 source와 대조한 분리 Next web에서 검증했다.
기존 대화 입력 경로와 별도 상태를 사용하고4초 deadline·완료 후15초 polling을 적용한다.
실제 QA Session에서 요약 연결만 끊은 동안 Run이 성공했고18event·도구0건을 원장과
대조했다. 복구 후 요약 Run 수는2→3이며 같은 공개 Map의 정확한 Run을 선택했다.
390px·Tab과 이전 링크 제거도 확인했다. native web120개·Track236개 검사를 통과했다.
`demian-context-native-ui-verification.json`·`../integrations/demian/README.md`가 근거다.

AT-20은 여전히 부분이다. 원본 web 교체 전 기존 Docker DB 연결 종료로 native API와
worker가 중단된 것을 발견했다. Docker bootstrap의 데이터 디스크 인식 오류를 확인하고
추가 재기동·수리를 멈췄으며 원본 web·startup·active release는 변경하지 않았다.
DB/API/worker 복구 후 원본 web 적용·브라우저 검증과 다른 사용자·Project의 별도 인가
계약이 남았다. QA clone의 실제 실행과 원본 운영 적용을 구별한다.
