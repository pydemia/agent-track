# Demian 실행 연결 후속 순서

2026-11-13 최신 runtime: 원본 rollback과 candidate를 각각 작업별 새 launcher로
3002에서 실제 기동·종료했다. 중복 작업은 기록/프로세스를 보존해 거부하며 ready의
정확한 identity·작업 명령·listener와 native handle 종료를 검증했다. candidate의
기존2Session scope 중 실제1Session3Run 요약·Track 링크와403 경계를 확인했다.
원본45테이블/보안 catalog·설정11개·서비스4개 보존, 새 암호화 backup의 실제 격리
복원·검사 컨테이너 정리도 완료했다. 결과는 `demian-public-web-runtime-verification.json`.
이 검증을 반복하는 대신 다음에는 current pins/backup 일치 확인과 public-only
전환 operator의 journal·조건부 파일 쓰기·시작 결과 유실 복구를 연결한다. 실제
공개 웹 교체와 Microsoft 로그인은 여전히 남았다. 기존 API/worker를 재시작하지 않는다.

2026-11-13 원본 웹 후속: [공개 웹·Entra 전환 준비](demian-public-web-preparation.md)의
별도 public 활성화·포트/복구 경계와 Demian SSO renderer를 구현·검사했다. 운영
웹/인증은 아직 교체하지 않았다. 기존 dual-profile `promote-web.mjs`를 그대로
실행하지 않는다. 다음 실제 전환에는 public-only adapter·현재 보존 기준·최신
암호화 backup의 현재 일치 확인이 필요하다. 원본 build의 rollback1527파일은 동결·
기동 검증했다. Microsoft 관리자 탭은 비밀번호 입력 대기이며 이번 작업에서 Demian의
새 등록/secret을 생성하지 않았다. 기존 Track/Trail 설정을 재생성하지 않는다.

기준: 2026-11-12 KST. Track의 산출물 그룹 연결은 기존 native metadata를
읽어 검증했다. 현재 API-only 관측과 worker 실행 준비를 구분한다. 전체 수용
조건은 14/21(66.7%, 동일 가중치), 완료 예상 산정 불가·신뢰도 낮음이다.

## 확인한 상태와 출처

원본 API는 고정된 bundle로 운영 중이고 worker·optional work-runtime·peer
registry는 활성화하지 않았다. 원본 19 Run·810 event와 기존 Assistant 37 event를
Track에서 재확인했다. 새 Task·Run·모델 호출을 만들지 않았다.

Demian 소유 대화 `01a1c901-2cea-7a21-9b38-8d12445f0a49`의
`01a1cef0-8526-7613-8186-52ec435e59a3` 턴은 worker·자동 시작을 읽기 전용으로
조사했다. 다음은 그 소유자 조사 결과이며 Track에서 worker를 기동해 검증한
결과가 아니다. 소유자가 마지막으로 대조한 DB 시각은 2026-11-12 17:31:24 KST다.

## 실행 준비

1. API-only 자동 시작은 `bbcfe95`에서 구현하고 현재 사용자 로그온 작업을 등록했다.
   실제 task 결과0·기존 PID15940 재사용과 전체 native DB/보안 catalog·설정 8개·
   process 보존을 확인했다. 실행 계정·격리 home·설정·frozen entry/hash와 현재
   listener의 PID·exe·entry·creation time을 대조한다. 다른 listener는 보존한다.
   실제 native cold start·PC 재부팅과 구분한다. `demian-api-startup.md` 참고.
2. Worker는 기동 즉시 상태 발행·만료 복구·작업 임대를 시작한다. queued=0은
   새 작업 유입 차단이 아니다. 현재 stop은 진행 중인 polling·임대와 별도 상태
   발행을 모두 기다리지 않으므로 작업 수신 제어와 종료 경합을 먼저 해소한다.
3. Worker와 runtime core를 함께 고정한다. 설치 worker와 현재 source build는
   DB 관계 모듈 구간이 달랐고 core는 일치했다는 소유자 보고가 있다. mutable
   checkout의 runtime module을 frozen worker와 혼용하지 않는다. 외부 import·
   resource 경로와 초기화 부작용은 추가 검증 대상이다.
4. 원래 worker-home·runtime-home·provider별 OAuth 위치를 보존한다. Legacy
   provider의 상태 검사는 OAuth 갱신·저장을 할 수 있어 최종 합성 설정까지 확인한다.
   실행 파일 존재나 capability catalog만으로 인증·managed-child 준비를 완료 처리하지 않는다.
5. Worker를 기동할 때는 해당 worker의 status/capability/catalog 갱신과 실제 작업
   임대에 따른 쓰기를 구분한다. 기존 종료 Run·event·message·artifact·역할·멤버십·
   credential을 초기화하거나 source 재수집을 새 실행으로 계산하지 않는다.

## 교차 앱 연결

배포된 Assistant reader `5196c8bc`의 최초 조사에는 Demian dispatch adapter가
없었다. 이후 통합 Root의 별도 작업 조사에서 기존 durable gateway와 최신 검증
기록을 확인했다. 별도 gateway의 미커밋 source까지 포함해 `5196c8bc` 기반의
격리 branch에 통합하고 있다. adapter나 receipt 원장을 새로 중복 구현하지 않는다.
Projects의 Assistant 실행 링크는 WorkExecution ID이므로 Demian Run ID로
덮어쓰지 않는다.

기존 gateway의 owner-scoped intent·서명 요청·POST-once·native receipt와
GET-only 유실 응답 조정을 재사용한다. strict 관측 및 v2 producer 참조 계약은
`assistant-demian-observer.md`를 따른다. 현재 운영 source는 v1이며 v2 소비자의
정확한 native source mapping·현재 Assistant/Projects/Demian 권한 교집합과
operation receipt 대조는 Track에 구현했다. Root 소유 native 전환과 실제
producer/credential 설정은 남았다. 전환은 Work/runtime DDL을 추가하므로 이전
schemaUnchanged guard 대신 최신 데이터 보존·backup/rollback 계약을 새로
정의해야 한다. Track 읽기 key·Entra proxy·브라우저 cookie는
실행 권한으로 사용하지 않는다. 기존 model input에 제어 정보를 넣지 않는다.

현재 source 구현·proposal은 운영 activation과 다르다. 실행 준비가 갖춰진 뒤
명시된 QA 업무 하나에서 실제 parent/child·peer·교차 앱 관계를 생성·대조하고,
고유 Run 집계·nested group·경계 edge·검증/수용 상태의 구분을 확인한다. 별도
desktop 앱인지 현재 PC 실행 환경인지의 사용자 답변과 두 번째 실제 장치도 남아 있다.

## 2026-11-13 읽기 전용 재확인과 다음 경계

Native PR22는 `b449f5fe`의 open/draft 상태다. API-only PID15940과 원본
19Run/810event·45테이블은 유지했고 worker/runtime/credential을 변경하지 않았다.
Track는 그룹 요약·탐색 복원 구현을 게시했으며 실행 준비를 대신하지 않는다.

현재 worker source의 `start()`는 provider 로그인 worker와 상태 발행·만료 복구를
거쳐 lease를 시작한다. `stop()`은 active execution과 로그인 worker를 기다리지만
전체 polling·lease·별도 status publish를 모두 기다리는 계약은 확인하지 못했다.
worker/config/runtime-bridge의 기존 미커밋 변경은 보존했고 읽기만 했다.

소유자 대화의 후속 조사에서 기존 freeze/drain/정확한 QA scope lease 계약은
없다고 확인했다. 기존 source manifest689개와 metadata 후속8개를 경로로 합친
현재692개는 전부 SHA가 일치했다. 이 소스와 worker/core 산출물2개를 보존하고
격리 branch의 `5943eec`에 source snapshot을 기록했다. 원본 WIP는 수정하지 않았다.

그 위에 DB·인증/provider 쓰기를 하지 않는 `frozen-readiness` 진입점을 구현했다.
별도 설치한 dependency와 소스·worker/core를 manifest 하나로 묶고 외부 pin으로
전체 tree의 누락·추가·변조·외부 link·만료를 검사한다. 현재 실행 파일도 해당
payload에 속해야 한다. 모드 누락·빈 값·미지원·아직 구현 전인 `qa`는 일반 실행으로
넘어가지 않고 거부한다. 이 branch의 일반 실행은 명시적인 `general`에서만 가능하다.
원본 worker service 설정은 변경하지 않았다.

후속 격리 구현 `1c691aa`는 정확한 org→workspace→session→run tuple의 만료 있는
QA scope를 candidate lease와 만료 복구·workspace lease 삭제에 함께 적용한다.
진행 중 prepare/claim·미dispatch claim·실행/event/heartbeat/status/login을 모두
기다리는 drain과 명시적 cancel 전환도 구현했다. 늦은 claim의 정리 실패를 성공으로
숨기지 않는다. child/peer/delegated의 QA 등록은 여전히 기존 admission transaction에서
권한·Run·receipt와 원자적으로 처리해야 한다. ancestry/tag에서 권한을 상속하지 않는다.
QA intake 제한과 전역 admission freeze는 다른 기능이다.

준비 검사는 실제 worker 활성화·provider 인증·Task/Run 생성이 아니다. 실제 기동·
credential·DDL 변경은 최신 보존/복구와 현재 원본 권한을 검증한 뒤 수행한다.
native Work/runtime DDL 전환에는 기존 schemaUnchanged guard를 재사용하지 않는다.

격리 구현은 `d493ae8`의 로컬 commit이며 아직 원격 게시·운영 적용하지 않았다.
준비 검사69개·compiled CLI8개와 worker typecheck·core/worker build를 통과했다.
실제 dependency18,886개 파일을 포함한19,589파일/5link payload의 compiled
진입점에서도 추가 runtime import·network·subprocess·payload 밖 파일 조회 시도는
모두0이고 dispatch는 false였다. 원본692입력/산출물2개, DB 전체 행·DDL·sequence·
보안 catalog, 보호 파일8개와 API/Web/gate/container를 보존했다.
검사 범위·pin·잔여 조건은 `demian-worker-readiness-verification.json`에 기록한다.

범위 제한·종료 후속은 별도 label-owned tmpfs PostgreSQL과 fake provider/CLI에서
관련154개 전부 통과·skip0, worker/db typecheck와 worker build를 확인했다.
기존 취소·완료 fence도 함께 검사했다. 실제 OS 신호의 교차 플랫폼 검증은 아니며,
검사에는 운영 DB·provider credential을 사용하지 않았다. 운영 DB는 별도의 읽기 전용
보존 대조만 수행했다. QA 컨테이너·임시 credential은
정리했고 원본692입력/산출물2개·전체 native DB/보안 catalog·보호 파일8개·서비스를
보존했다. `demian-worker-intake-verification.json`에 범위와 초기 fixture 오류도 기록했다.

이 변경도 로컬 commit이며 운영 worker·QA CLI를 활성화하지 않았다. 다음은 현재
권한에 따른 atomic QA 등록과 pinned runtime/설정 전달이다. 이전 d493ae8의 frozen
payload를 새 worker의 준비 증거로 재사용하지 않고 활성화 직전 새 closure를 만든다.

## 2026-11-13 원자적 등록과 runtime pin

격리 native `e458d12`는 managed-child·peer-processing·delegated-work의 기존
권한·Run·receipt transaction에 명시적인 QA 등록을 연결했다. 현재 owner/admin이
승인한 종류·operation·actor/멤버십 기간·대상 tuple·요청 digest만 등록한다.
새 요청이 불일치하거나 등록 저장이 실패하면 Run·receipt·event까지 rollback한다.
같은 Session/root/tag/ancestry로 등록하지 않으며 과거 Run을 replay로 소급
등록하지 않는다. 기존 native 현재 권한 검사는 그대로 필요하다.

v2 선택은 scope ID·설정 hash·worker·org·만료와 실제 receipt를 대조한다.
복구 transaction 동안 별도 수행자의 권한 철회가 Run 변경과 workspace lease
삭제를 분리하지 못하도록 사용자·멤버십·등록 행도 보호한다. 모든 QA worker는
v1 tuple을 포함해 runtime의 실제 파일 경로·SHA pin을 필수로 받고, cache가
있어도 다시 검증한다. 환경 URL override나 기존 cache로 fallback하지 않는다.

관련189개 검사를 실제 분리 PostgreSQL·fake provider/CLI와 원본 계층에서
전부 통과했고 worker/db typecheck·worker build도 통과했다. 새19,599파일/5link
closure의 compiled 준비 검사에서 추가 import·network·subprocess·payload 밖
파일 조회 시도는0, dispatch=false였다. 검사 DB·임시 인증 정보는 정리했고
원본692입력·산출물2개·전체 DB/보안 catalog·보호 파일8개·서비스를 보존했다.
운영 DB는 읽기 전용 보존 대조만 했으며 migration025는 검사 DB에만 적용했다.

`demian-worker-admission-verification.json`에 revision·검사·pin과 한계를 기록했다.
현재 code도 로컬 commit이며 QA CLI·운영 worker는 활성화하지 않았다. 다음은
현재 private 실행 설정과 release/registry를 묶는 trusted QA launcher, 실제
기동 전 최신 backup/rollback 및 schema/source/image guard다. 실제 조직화·
교차 앱 업무, 원본 Web 문맥/인증과 desktop/두 번째 장치는 여전히 미완료다.

## 고정 설정을 사용하는 QA 기동 후속

별도 native branch의 로컬 `8afec9e`는 명시적인 `qa` 진입점을 구현했다.
descriptor 원문 pin·현재 v2 registry·closed release/실제 entry를 확인한 뒤
DB/runtime을 초기화한다. config·deployment·참조 service config·private 환경과
DB 설정은 payload 밖에서 각각 hash로 고정한다. 암묵적인 홈 설정은 부재를
재검사하고 환경 fallback을 차단한다. descriptor 만료는 release/scope 안으로
제한하며 작업·dispatch마다 executable/private pin과 현재 권한을 다시 확인한다.

QA는 전역 login 큐·provider 계정/status probe를 시작하지 않는다. 승인된
managed-child Session만 catalog를 검사·갱신하고 inspection 중 철회는 upsert를
차단한다. claim 수와 다음 claim까지의 idle 한도 후 종료하며 event/heartbeat/
status·pool을 정리한다. idle 한도는 실행 중 provider 전체의 wall-clock 한도가
아니며 `qa_stopped`는 Run 성공·업무 수용을 뜻하지 않는다.

실제 compiled entry·pinned core·임시 PostgreSQL·제어된 HTTP provider에서 등록
Run 한 개의 성공·receipt·budget·종료 event와 process 종료를 확인했다. 별도
실제 core QA 검사는 actor journal도 대조했다. managed-child/peer fixture·
범위/철회/복구/종료를 포함해 관련245개
검사를 모두 통과했다(skip0). 독립 리뷰의 홈 설정·service config·release 유효성
지적 세 건을 수정하고 재검토했다. 전체 native/Linux·실제 OS signal 검증은 아니다.

새19,601파일/5link payload의 frozen-readiness는 추가 import·network·subprocess·
외부 파일 조회 시도0, dispatch=false였고 현재 source/산출물714개와 일치했다.
전체 dependency/source closure는 preflight에서 검사하며 이후 callback에서는
manifest·worker/core·private pin을 재검사한다. 나머지 파일은 operator-owned
freezing이 전제이며 filesystem의 원자적 잠금으로 설명하지 않는다.

원본692입력·산출물2·전체 DB/DDL/sequence/보안 catalog·보호파일8과 기존
API/Web/gate/container를 보존했다. label-owned 검사 DB·tmpfs·임시 credential을
정리했으며 원본19Run/810event는 그대로다. 새 코드는 로컬 commit만 있고
운영 migration025·worker·producer 전환은 수행하지 않았다.
`demian-worker-launch-verification.json`에 현재 증거와 한계를 기록한다.

사용자의 기존 세션 문의 지시에 따라 Demian과 Persona Root에 현재 credential
참조·provider profile·실제 binding과 최신 backup/rollback guard를 읽기 전용으로
문의했다. 배포·binding 변경이나 worker 기동을 요청한 것은 아니다. 다음은
현재 소유자 메타데이터 대조, 실제 대상의 새 보존/rollback 검사, 명시 QA 업무의
native 실행·group UI 대조다. 전체 수용 완료14/21은 유지한다.

2026-11-13 소유자 회신 대조: Demian·Persona Root·gateway 개발 세션의 읽기
전용 확인에서 현재 로컬 executor credential/binding이 provision된 근거는
확인되지 않았다. gateway 담당자가 canonical `public.work_runtime_bindings`
전체0행·활성0행, `PERSONA_DEMIAN_RUNTIME_CONFIG_FILE` 배치 미확인과 native
launcher의 `DEMIAN_WORK_RUNTIME_CONFIG_FILE` 미주입을 보고했다. 기존 API
token/reader key·Workspace/Session·도메인을 executor tuple로 대체하지 않는다.
이는 해당 로컬 호스트와 조회 시점의 결과이며 다른 온프레미스 호스트의 부재를
뜻하지 않는다. 원본 worker profile은 native CLI의 명시적 개인 OAuth home을
사용하므로 QA HOME 변경만으로 인증을 격리할 수 없다. 실제 provision에는
현재 authority/별도 자격 증명·Root 소유 DDL 전환·새 backup/rollback guard와
provider 실행 가능성 확인이 선행되어야 한다. 원본 worker·DB·OAuth home은
변경하지 않았다. UI의 공통 그룹 범위 구현을 이 provision 또는 실제 협업 실행
완료로 계산하지 않는다.

## 실제 Codex HTTP 관리형 child QA

2026-11-13 기존 `codex` HTTP adapter를 별도 QA profile로 구성했다. 운영의
`codex-app-server`·Claude·Antigravity CLI 설정은 그대로다. 실제 모델 목록을
조회하고 `gpt-6-astra`를 명시적으로 고정했다. 목록 adapter의 첫 항목 표시를
서버가 지정한 기본 모델로 해석하지 않는다. 원본 인증에서 access token/account
참조만 QA 파일로 제한하고 갱신 토큰을 복사하지 않았으며, 원본 auth hash와
native 전체 데이터·설정·서비스를 대조했다. 실제 provider 응답 확인 후 별도
tmpfs PostgreSQL·v2 registry의 명시 작업1건과 full frozen release를 연결했다.

실제 native managed-child API로 생성한 Run1건이 compiled worker에서 성공했다.
모델 요청1회·641토큰·canonical17event·서로 다른 부모/child invocation ID와
응답 marker를 대조했다. loopback 전송 gate는 실제 upstream으로 전달하며,
영속 단일 operation claim·모델/무도구/만료/본문 한도·오류 본문 제한을 적용했다.
이 gate는 모델 응답을 모의 생성하지 않는다. 준비용 smoke 요청1회/58토큰과
구분하며 이번 QA provider 요청은 합계2회/699토큰이다.

원본 서비스나 Work runtime binding을 전환한 결과가 아니며, 부모 모델 자체는
실행하지 않은 explicit child 경로다. 원본 authority/DDL·새 backup/rollback과
Assistant 교차 앱 업무는 여전히 필요하다. 완료 뒤 접근 토큰 사본·QA API/DB
credential·임시 API/Track·owned container를 정리하고 private QA DB 보관본과
metadata 증거를 남겼다. 보관본을 새 owned tmpfs DB에 복원해 같은 성공 Run·
17event·receipt와 실제 assistant-role 응답의 정확한 일치를 확인했다. 사용자
요청문을 응답 근거로 사용하지 않았고 추가 모델 호출도 없었다. 복원 container와
credential도 정리했다. worker 종료 뒤
검증 스크립트의 잘못된 table 조회는 `session_messages` 읽기로 복구했고 Run을
재실행하지 않았다. 실제 worker 종료 코드는 보관되지 않아 정상 종료 코드0을
주장하지 않는다. `native-managed-child-verification.json` 참고.

## 실제 coordinator QA의 실패 경계

2026-11-13 같은 고정 release로 coordinator → sorter → verifier → 최종 종합을
시도했다. 명시 registry1건과 외부 요청 최대5회의 별도 QA 범위다. 실제 외부
모델 요청은1회/1,368토큰이고 coordinator가 sorter에 대한 `delegate_agent`를
선택했다. 그러나 child 실행에는 runner callback이 전달되지 않아 도구가
`delegate_agent is not available in this session.`을 반환했다. 하위 Agent는
실행되지 않았으며 검증·종합 결과도 없다. 뒤의27회 요청은 gate에서 upstream
전 차단했고,180초 watchdog이 Run을 취소했다. worker 종료 코드0은 QA worker
종료의 근거이며 업무 성공이 아니다. Run은1attempt·47event/cursor47로 남았다.

원본에는 Run의 취소만 있고 invocation 취소 이벤트는 없다. 실제 UI에서도
Run 취소·호출 종료 미확인·도구 실패를 구별하고, 그룹 내부/접기/네 보기 공통
범위의2node/1edge와390px를 대조했다. 명시 invocation 취소 이벤트 처리와
종료 근거 충돌은 별도의 회귀 검사로 확인했다. screenshot은 CDP timeout으로
확보하지 못했다. Native source는 수정하지 않았으며 자체 소스 검토에서도
child callback 누락을 확인했다. 단순 연결 전에 호출자·depth/allowlist·취소와
원본 권한/계정·cwd·작업 범위·durable context를 보존하는 검사가 필요하다.
Cowork/scoped member의 재위임 허용으로 확장하지 않는다.

격리 DB는 private 보관본으로 남기고 QA container/API/Track·access token 사본·
DB/API credential을 정리했다. 원본45테이블 전체 데이터/DDL/sequence/보안
catalog·보호파일8·서비스3·source692/산출물2는 같았다. 이 실패를 실제 조직화
완료로 계산하지 않으며 전체14/21을 유지한다. `native-coordinator-verification.json`
참고.

## 실제 coordinator 중첩 위임 성공

후속 별도 source `d0aaa0b`는 일반 child에 runner를 연결하고 현재 호출자를 직전
부모로 전달한다. 기존 대상/승인 검증과 대상별 계정·cwd·session context를
유지하며 조상·대상·host 검사 뒤 조상 권한을 재확인한다. 검사는 깊이에 선형으로
증가하며 여러 원격 계정의 원자적 철회를 보장하는 계약은 아니다. Cowork 멤버와
정의된 writeScope는 내부 callback까지 재위임을 거부한다. 취소된 상위 세션은
다음 모델 요청을 보내지 않는다. 호출 종료는 모델 응답/terminal 저장 직전 signal로
결정하므로 저장 중 취소가 완료한 child와 상위 Run을 모순된 상태로 바꾸지 않는다.

관련140검사·core/worker 타입 검사·build와 독립 검토를 통과했다. 최초 packaging의
npm 버전 인자 오기를 사용 전 발견하고 관측한11.19.0으로 새 bundle을 작성했다.
선택한19,603파일/5link의 closure는 import/network/subprocess/outside-file 부작용0의
frozen-readiness를 통과했다. 잘못 기록한 미사용 bundle은 실행하지 않았다.

새 tmpfs DB와 registry1건으로 실제 coordinator가 sorter를 실행하고 실제 정렬
결과를 verifier에 전달한 뒤 최종 답을 종합했다. Run은1attempt·3invocation·
5외부 요청/6,436토큰·63event로 성공했고, 실제 assistant-role 답과5개 전송 원장을
대조했다. 외부 부모 envelope 모델은 실행하지 않았다. 순차 위임을 Projects의
Task dependency나 cowork/peer 실행으로 해석하지 않는다. actual QA의 snapshot/
63event와 private DB archive를 보존하고 API/Track/container/인증 사본을 정리했다.
후처리의 옛 DB descriptor 파일명은 정확한 새 파일명으로 복구해 제거 상태를
대조했으며 Task를 재실행하지 않았다. 미사용 bundle 폴더의 재귀 삭제는 자동
승인 검토가 정책상 거부해 남겨 두었다. 원본 DB·설정·소스·서비스는 보존했다.

Track에서는 부모 관계 중복 선을 근거 유지 방식으로 정리한10node/15edge/5그룹과
coordinator 묶음5node/5edge를 확인했다. 전체63event와 부분 범위를 구별하고,
네 보기 전환·390px·원본 seq17의 관계 상세를 대조했다. Screenshot은 CDP timeout으로
확보하지 못했다. `native-nested-coordinator-verification.json` 참고. 실제 operating
native worker 전환·peer/cowork·Assistant 교차 앱·추가 기기는 남아 전체14/21이다.

## 실제 Assistant gateway의 native 위임

2026-11-13 native 위임 후속: 실제 Assistant host loader와 계정 준비 상태 조회를
결합하면 빈 membership으로 binding을 찾는 오류가 있었다. 최초 격리 QA는 모델
전송 전에 멈췄다. 현재 owner의 명시 binding들을 준비 상태 검사에만 열거하고
await 뒤 집합 변경을 재검사하도록 수정했다. 실제 실행은 정확한 membership을
계속 요구한다. Persona PR22의 `b6504e5`로 push했고 draft·운영 미배포다.
수정 후 실제 TLS/HMAC API·deployment/session authority·동결 worker/core·native
Codex app-server를 통해 Run1/attempt1·전송1·8event·native turn1이 성공했다.
PostgreSQL·SQLite의 원 assistant 응답 hash와 context/binding/receipt를 독립
대조했다. 요청한/선택된 모델은 gpt-6.1-sol이며 upstream 내부 호출 수·서버 최종
모델을 독립 관측했다고 하지 않는다. latest request370토큰과 같은 native session
관측을 합산하지 않는다. `model.request` 이벤트0을 실제 모델 요청0으로 해석하지
않는다. query-only 로컬 observe는 native binding 철회 뒤에도 이전 completed
snapshot을 반환했으므로 새 native 권한 확인의 대체 증거로 쓰지 않는다.

원본45테이블·42파일·18프로세스와 인증 파일을 보존했고 원본 worker는 시작하지
않았다. QA worker·tmpfs DB와 비밀 파일9개를 정리했다. 초기 회귀3개 실패→관련
103개 통과, 전체1,181개 중1,167통과·14skip·실패0과 타입 검사·build를 확인했다.
전체 검사에도 새 회귀4개가 포함됨을 로그에서 확인했다. 원격 CI43389560563의
앱·collection·container·native worker 네 job도 성공했다. 실제
WorkCoordinator/Projects/Note·desktop 업무와 운영 전환·Entra GUI는 별도다.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다. 다음은
현재 원본 서비스 계약·최신 보존/복구 경계 및 protected Run의 인가된 metadata
조회 경로를 대조한다. [native 위임 실기 기록](assistant-native-delegation-verification.json) 참고.
기존 운영 Assistant 안에서 Note/Projects의 서명된 capability GET200·필수 flags와
위조 요청401을 확인했다. 서명키는 원 컨테이너 밖으로 복사하지 않았다. 이 집계
응답은 대상 Project의 create/update/results attach ACL이나 격리 QA의 별도
쓰기 구성을 확인한 결과가 아니며, 새 업무·모델 요청도 없다.

추가 대상 읽기에서는 Assistant의 기존 기본 Project와 활성 Note workspace revision4·
설정 destination 일치를 확인했다. 과거 Track QA Project는 현재 Assistant 목록에
없었다. Note 읽기는 POST RPC의 내부 GET이므로 최초 GET-only probe가 로컬에서
막았고, workspace/layout GET만 허용한 새 probe로 대조했다. 이를 provider 장애나
쓰기 ACL 허용으로 해석하지 않는다.
