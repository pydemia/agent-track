# Agent Track 개발계획

현재 후속: Assistant9382c9c·Track9639375와 보호 source가 운영 연결돼 있다.
같은 실제 Execution/Run/Task에서 실행 성공→Projects 결과 선첨부→Note 발행·참조→
Track 관측을 확인했다. [현재 업무 근거](workflow-observation-2026-11-14.json)를 따른다.
상세 Trace 보완 source는 Track17e5ff0·Native9f45e6c·Personaf9f78ac다. Track의
CI43494168243은 Windows·Ubuntu 모두 성공했고 세 후보를 별도로 동결했다.
새 evidence 운영 전환은 아직 하지 않았다. Persona CI는 결제/한도 annotation과 함께
실행 step 없이 실패했다. 현재 PC 브라우저는 Entra 비밀번호 단계로 사용자 로그인 대기다.
수용15/21·71.4%(상위 동일 가중치·부분0)·전체 ETA 산정 불가/신뢰도 낮음을 유지한다.
[상세 조회 계약](native-run-evidence.md)과 [전체 기준표](goal-status.md)를 우선한다.

## AT-09 재개·재시도 구현 순서

Native Codex 실행기는 이미 `thread/resume` 후 새 `turn/start`를 수행한다.
`prepared-delegation.ts`는 기존 binding과 native thread가 있으면 엄격한 resume를
요구한다. 현재 PostgreSQL 통합 fixture는 동일 thread·서로 다른 turn/Run·receipt2개를
검증한다. 이것은 실제 제공자 재시도 명령의 운영 성공 증거는 아니다.

따라서 부족한 기능을 단순히 ‘Native resume 자체가 없음’으로 정리하지 않는다.
필요한 것은 업무·이전 Run·명령·새 Run을 연결하는 원본 명령 계약과 Track의 복구다.

| 동작 | 실제 의미 | 유지할 경계 |
| --- | --- | --- |
| Session 계속 실행 | 새 입력으로 같은 Session/native thread에 새 turn·Run 생성 | 실패 업무 재시도와 구별 |
| 실패 재시도 | 같은 논리 업무·입력 revision의 새 실행 시도, `retry_of`로 이전 Run 연결 | 원래 실패 상태·이벤트·메시지·usage·receipt 불변 |
| 중단 작업 재개 | 이전 실행의 종료 확인 후 `continues` 관계의 후속 Run 생성 | cancelled/failed Run을 running으로 되돌리지 않음 |
| 승인 대기 해결 | 정확한 pending permission에 명시 결정 전달, 같은 worker/attempt/lease에서 계속 | 일반 재개 버튼으로 도구를 자동 허용하지 않음 |

1. **Native admission·receipt**: `POST /api/v1/runs/:runId/commands`와 Session별 명령
   조회 계약을 추가한다. command ID·kind·canonical digest·원본 업무/입력/문맥 pin·기대
   Session head·Run 상태·기한·현재 actor/authority를 고정한다. 같은 transaction에서
   receipt·후속 Run·명시 관계를 저장하고 원래 Run은 보존한다. 같은 ID/같은 digest는
   같은 결과를, 다른 digest는409를 반환한다. 다른 ID의 동시 요청도 같은 관측 head에서
   후속 Run을 두 개 만들지 못해야 한다. 기존 enqueue key 재사용은 원래 Run 조회이며
   실패 재시도가 아니다.
2. **Assistant 실행 소유권**: 보호된 실행은 기존 read-only Track reader로 명령을 보내지
   않는다. Assistant의 현재 owner/Task/역할을 확인하는 제어 경로가 새 runtime attempt와
   Native command/Run 관계를 journal에 반영해야 한다. 현재 `WorkCoordinator.reconcile`
   은 `reconciliation_required` 확인·발행 복구이며, 실패 역할 재실행 계약이 아니다.
   Native Run만 별도로 재시도하고 coordinator가 예전 Run을 계속 읽는 구현을 피한다.
   실제로 지원하는 일반·보호된 경로를 모두 capability와 권한에 연결한다.
3. **Track 제어·복구**: 현재 Projects/Session/Run 인가와 실제 capability를 대조한다.
   응답 유실·재시작 후에는 같은 native command ID를 조회한다. `unknown`을 다른 Run의
   존재로 성공 처리하거나 새 key로 자동 재전송하지 않는다. 명령 접수와 후속 Run의
   성공·업무 수용을 각각 표시한다. 버튼은 ‘실패 재시도’·‘작업 재개’·‘승인 대기 해결’의
   실제 의미에 맞게 구분하고 predecessor/successor를 Flow에서 선택할 수 있게 한다.
4. **검증**: 중복/동시 요청, digest 충돌, Session head 변경, 현재 권한 철회, commit 후
   응답 유실, Track 재시작, 원래 이력 보존, binding 불일치, pending permission fence를
   실제 DB/API로 검사한다. 같은 thread/new turn/new Run과 명령 관계를 fixture와 실제
   제공자 실행으로 각각 확인한다. 단순 enqueue2회 성공을 retry 수용으로 세지 않는다.

후속 Native d3ffeb9에 명령 접수·불변 receipt·후속 관계·같은 ID 복구를 구현했다.
실제 격리 PostgreSQL의 DB/일반·보호 HTTP/prepared worker72개 통과·선택환경2개 skip,
독립 리뷰의 개인/배포 권한 분기 오류 재현·수정 후 일반 HTTP6개 통과를 확인했다.
Track 서버용 계약·일반 owner transport도 추가했다. 두 suite의 중복 사례는 합산하지
않는다. [구현 단계와 남은 범위](native-run-commands.md)를 따른다. 운영 명령은 여전히
cancel-only다. 후속 Assistant e9c6f7c에 owner intent·이전 시도 history·새 correlation/ref·
native 명령 한 번 접수와 같은 ID 복구를 구현했고, 관련241개와 실제 PostgreSQL/
Assistant schema·signer·gateway 연동3개를 통과했다. 원본의 후속 paired 검사 source는
2c113bb다. 후속 Persona2aefb07·Track에 과거 시도 보호 reader와 시도별 native/evidence
조회를 구현했다. 원본 Run·이벤트 원장 보존과 현재 인가 재검사를 실제 reader/client 및
Track HTTP/SQLite 검사로 확인했다. [조회 계약과 다음 Flow 연결](assistant-attempts.md),
[검사 범위](assistant-attempt-verification.json)를 따른다. 후속 Flow에는 실제 시도 Run과
coordinator intent edge·역할 시도 그룹·네 보기의 탐색을 연결했다. 후속
[보호 owner 제어 broker/UI](coordinator-command-controls.md)는 원본 writer,
영속 검토·CAS 한 번 전송·동일 ID 복구·현재 역할/Run 대조까지 소스로 구현했다.
운영 반영, 인증된 사용자 화면과 실제 제공자 검증은 **미완료**다.
일반 Native owner의 [검토·단일 전송·동일 ID 복구 UI](run-successor-controls.md)는 후속
source에 구현했다. 취소와 별도인 명시 권한이 필요하며 운영 설정은 활성화하지 않았다.
일반 명령 receipt의 [Flow 관계 연결](native-command-flow.md)은 후속 source에 구현했다.
새 private table의 release/rollback·운영·인증된 화면 수용 검증은 남아 있다.
AT-09를 기존 전체 목표에서 제외하지 않는다. 변경된 모델·역할·입력은 새 요청/revision으로
검토하며, 실패 전에 이미 발생했을 수 있는 외부 효과를 rollback됐다고 표시하지 않는다.

## 이전 시점의 기록

아래01:51의 preview 실패는 후속 검증 전의 기록이다.

2026-11-14 01:51 KST 진척 점검: 수용15/21·71.4%(상위 동일 가중치·부분0)는
전체 개발 완료율이 아니다. 새 API/gate는 운영 중이나 Assistant reader는 정지
후보, Track 새 보호 source는 운영 설정0개다. 새 backup/격리 복원은 성공했고,
후속 후보 preview는health200 이후 행 보존 assertion·cleanup 실패로 종료했다.
같은 복원본에서 실패 경계를 확인하고 새 reader/collector를 운영 연결한 뒤
전체 실제 업무를 대조한다. 운영 준비·검사 반복을 사용자 수용 완료로 세지 않는다.
전체 ETA 산정 불가·신뢰도 낮음이며 첫 전체 업무와 원본 재개/재시도 범위 확인
후 재산정한다. [현재 상태](goal-status.md)와
[감사](progress-audit-2026-11-13.md#2026-11-14-0151-kst-진척-정체-판정)를 우선한다.
아래는 이전 시점의 계획·기록이다.

2026-11-14 운영 후속: native API와 공개 gate 반영을 완료했다. 기존 worker와
원본 API는 유지했고, Assistant 새0691e1a 이미지의 env·13개 mount·네트워크를
보존한 정지 후보를 대조했다. 다음은 현재 DB 복구/preview → 새 Assistant guard와
운영 교체 → Track source 활성화 → 실제 업무 대조다. 수용15/21·71.4%와 전체
ETA 산정 불가·신뢰도 낮음은 유지한다. [운영 근거](assistant-native-observation-operating.json)를 따른다.

2026-11-14 KST 재점검: 수용률15/21·71.4%(상위 동일 가중치·부분0)는
직전 대비0%p이며 전체 개발 완료율로 사용하지 않는다. 후속 구현에서 보호
metadata 수집→원장→Trace를 연결했다. 격리 PostgreSQL44개와 Persona184개,
실제 HTTP/SQLite 수집6개가 통과했으나 운영 배포·전체 업무 성공은 남는다.
다음 완료 조건은 새 native API/Assistant reader/Track source의 운영 반영이다. 이후 실제
WorkCoordinator/Projects/Note 업무와 desktop 접속을 검증한다. 전체 ETA 산정 불가·
신뢰도 낮음이며 첫 전체 업무 결과와 재개/재시도 구현 범위 확인 시 재산정한다.
[최신 기준표](goal-status.md)와 [재점검](progress-audit-2026-11-13.md#2026-11-14-kst-현재-작업본-재점검)을
우선하며 아래 운영 전환 기록은 당시 증거로 유지한다.
[새 연결의 적용·검증 범위](assistant-native-observation.md)를 따른다.

2026-11-13 23:42 KST 후속: **Assistant f79a5b1 운영 전환과 보존 검증 완료**.
기존13개 app guard layer를 유지하고 새 guard를 구성했다. Docker의 후보 OOM
설정 false/null 표현 차이로 멈춘 후속 검사는 후보에 한정한 기존 정규화 계약으로
수정했고,33개 회귀·Windows/Ubuntu CI와 실제 같은 PID의 guard adoption을 확인했다.
운영4개 새 빈 테이블/9개 schema object와 기존 업무 행·보고서·파일68개, 다른12개
서비스·renderer를 보존했다. 실제 현재 환경/metadata로 native 서명 GET3개도200이다.
운영 Task/Note/Run·모델 요청은 이 전환에서 생성하지 않았다.

다음 임계 작업은 **protected Run metadata 인가 연결 → 실제 지속 WorkCoordinator
업무·Projects 결과 선연결/Note 참조 → desktop 접속·Track 검토**다. 완료한 후보 기동·
백업·운영 전환을 반복하지 않는다. 현재 private 실행 근거는 native-lifecycle-v3이며
실패한 v2 전환 runner를 재실행하지 않는다. 일반 bearer의 보호 Session 차단도 유지한다.
[운영 근거](assistant-native-promotion-verification.json)와 [현재 수용표](goal-status.md)를
우선한다. 수용15/21·71.4%는 유지하며 전체 ETA 산정 불가·신뢰도 낮음이다.
아래는 이전 시점의 기록이다.

2026-11-13 22:51 KST 재점검: 상위 수용15/21·71.4%의 산술은 확인했으나
전체 개발 완료율로 해석할 수 없다. 실제 두 DB 백업/복원과 전체 후보 기동은
확보했지만 후속 복원본 DB 검사가 실패해 Assistant 운영 전환은 미완료다.
다음 작업은 보존된 복원본에서 검사 경계를 해결하고 정확한 DDL/행 변화를
대조하는 것이다. 대용량 백업이나 앱 기동부터 반복하지 않는다. 이후 현재 guard와
운영 전환 → protected metadata → 첫 실제 지속 업무/desktop으로 진행한다.
현재 단계·실패·다음 수용 조건은 [최신 상태](goal-status.md#2026-11-13-2251-kst-재점검)를
우선한다. 전체 완료 예상 산정 불가·신뢰도 낮음이다. 아래는 이전 시점의 기록이다.

현재 기준: 2026-11-13 진척 감사. **수용 항목 15/21·71.4%** (동일 가중치).
AT-18 보류 판정을 정정했으며 전체 업무는 미검증이다. 현재 요구별 판정과 남은
6개 검사는 [전체 기준표](goal-status.md), 근거/한계는
[진척 감사](progress-audit-2026-11-13.md)를 따른다. 전체 완료 예상 산정 불가·
신뢰도 낮음. 운영 실행/인가 연결 → 실제 업무 결과 연결 → desktop/Track 실기가
임계 경로다. 원본 웹 인증 이동·문맥 요약 GUI, 그룹 운영 GUI, 다중 장치 대시보드
검사는 각각의 요구로 추적한다.

최신21:46 KST 기준, Track 운영 코드는 `a3bb446`을 유지하며 Demian
`c439341`의 migration026·실제 역할 binding·전용 API8081/worker·공개 서명
경계를 가동했다. Persona `f79a5b1` 후보 이미지의 Linux→공개 HTTPS→현재 native
인가 조회3개도200이었다. Assistant 운영 전환, protected Run metadata 인가
연결과 전체 업무는 남는다. 이는 AT-14의 전제 진전이며 새 상위 요구 완료로
세지 않는다. [운영 근거](demian-dedicated-service-verification.json)를 따른다.

진척 재점검: 71.4%는 상위 수용 항목의 누적 충족률이며 개발 완료율이나 운영
준비도 추정치가 아니다. AT-09의 재개/재시도와 AT-14의 운영 실행/관측 인가 연결은
실제 기능·연동 부족이다. AT-12의 배포된 사용자 동작, AT-15의 한 대시보드에 여러
장치 세션 표시, AT-20의 원본 인증 GUI/장애 격리는 남은 실기 조건이다. AT-12의
특정 Entra 재로그인·스크린샷 export와 AT-15의 여러 클라이언트 동시 접속은 추가
게이트로 삼지 않는다. AT-06/20의 무인증 Basic401과 인증 HTTP200을 구별하며,
원본의 새 인증 방식 구현 자체를 완료 조건에 덧붙이지 않는다. 기존 공개 Entra
정책은 유지한다. Desktop은 독립 앱/bridge 위치와 API가
미확정이며, Linux peer 실기를 그 연결로 대체하지 않는다. 최근 Projects 운영
계약 전환은 AT-14의 전제 완료로 기록하고 전체 업무 성공으로 집계하지 않는다.
다음 판정은 이들 원래 수용 조건 중 하나의 실제 폐쇄를 근거로 갱신한다.

Projects 원본 계약의 운영 전환을 완료했다. 다섯 기존 설정 layer를 포함한
private canonical replay에서 앱 이미지만 교체했고, 다른 역할·인증·DB 보존과
기존 Assistant 서명 클라이언트의 실제 지원을 확인했다. Source 지원 flag를
위장하거나 소비자의 assert를 해제하지 않았다.
[배포와 복귀 계약](../integrations/projects-results/README.md),
[현재 운영 증거](projects-results-verification.json)를 따른다.

운영 worker 연결 전제 수정도 완료했다. 기존 배포 전용 모드는 상태 게시만
구분하고 일반 대기열 접수·만료 복구·로그인 작업을 제한하지 않았다. 별도 source
`c5284e3`에서 같은 worker의 명시 binding/Run authority와 기존 capability/QA의
교집합으로 접수·복구·lease 정리를 제한했다. 일반 설정 worker는 기존 동작을
유지한다. 별도 실제 PostgreSQL 회귀69개·타입 검사·worker build·독립 소스 검토를
통과했고, [bounded patch](../integrations/demian-worker-intake/README.md)를 보존했다.
이후 위 최신 후속에서 새 전용 worker와 역할 binding을 가동했다. 원본 일반
worker를 켜거나 기존 일반 조회 API의 인증 설정을 바꾸지는 않았다.

현재 native API의 trusted 인증은 하나의 로컬 관리자 신원이다. 그 신원을
위임용 service principal로 바로 지정하면 기존 Track 요청까지 위임 서명이
필요해진다. 이를 피하려고 기존 일반 조회를 유지하는 별도 API·bearer·서명
경계와 동결 runtime 경로를 구성했다. 같은 trusted DB principal을 사용하므로
DB 신원 분리로 표현하지 않는다. 실제 운영 조회 검증과 아직 남은 Assistant의
실행 경로 전환을 구별한다.

다음 임계 작업은 현재 Assistant/native 실행 authority·source tuple과 protected
Run의 metadata 조회 계약을 연결한 뒤, 실제 QA 업무 한 건을 WorkCoordinator →
Projects 결과 선연결 → Note 게시/참조 → Demian 원본/Track 검토로 통과시키는 것이다.
Desktop 접속과 현재 인증 GUI·다중 장치 대시보드는 각 수용 요구에서 추적한다.
새 실행을 보내기 전에 현재 역할/목적지/action ACL과 durable intent를 확인하며
유실된 응답을 새 operation으로 재전송하지 않는다. 완료한 Projects 전환을 다시
실행하지 않는다. 이후 복귀에도 최신 DB·credential·authority와 metadata 호환을
유지한다.

## 시점별 개발 기록

아래 수치와 보류 사유는 당시 기록이다. 최신 판정은 위 기준표가 우선한다.

2026-11-13 실행 연동 후속: 계정 준비 상태 오류 수정 `b6504e5`와 실제 native
위임 Run1/attempt1·전송1/8event를 검증했다. Persona PR22는 CI 네 job 성공·
draft·운영 미배포다. [실기 기록](assistant-native-delegation-verification.json) 참고.

| 다음 단계 | 확보된 근거 | 남은 조건 |
| --- | --- | --- |
| 운영 실행 설정 | host loader·정확한 역할 binding·deployment/session authority를 별도 QA에서 실제 연결 | 현재 운영 tuple·전체 DDL·최신 backup/guard·source pin |
| 인가된 실행 관측 | native Run/응답·receipt/context의 PostgreSQL·SQLite 일치 | protected Run의 metadata 조회 계약. 일반 bearer 공개나 로컬 cached observe로 대체하지 않음 |
| 전체 업무 | 기존 Work selector·actor·membership·Note/Projects signed capability200 확인 | 명시 QA Project/Note 대상의 현재 action ACL·WorkCoordinator 실행·결과 연결 |

전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다. 운영 전환·
전체 교차 앱/desktop 수용과 Entra GUI는 미검증이다.

기준: 2026-11-12 KST · 제품 기획 v0.4 · 실행 goal 활성.
[전체 수용 기준표](goal-status.md)가 진행률의 단일 원본이다.

2026-11-13 Trace 모델 요청 보완: 기존 모델 이벤트가 node로 보이지 않는 경계를
모델 근거 opt-in·Run/호출 그룹·상세·기록 순서로 보완했다. 기존 URL과 이벤트
digest는 유지하고, 종료를 성공으로 보거나 Run 토큰을 요청별로 나누지 않는다.
실제 운영 원본17event·seq4와 로컬3node/2edge·그룹 상세, 실제 Linux archive의
seq6/45·4233ms를 대조했다. 초기 전체 검사1개 실패는 원인 미확인으로 남기고,
단독 재검사·최종975개/타입 검사·분리 build를 확인했다. `a3bb446`의 Windows·
Ubuntu CI와 API·웹 동결 운영 전환을 완료했다. 운영18자산과 실제17event·모델
근거1개·Run 그룹의 접기 내부2edge, 구 API 호환을 대조했다. Entra GUI는
Microsoft 로그인 입력 대기로 미검증이다. [모델 요청 Trace 계약](model-request-trace.md) 참고.
별도 소유자 조회는 운영 executor selector와 native binding/authority가 미구성임을
확인했다. 다음 전체 업무 검증은 기존 token 탐색보다 현재 identity/source tuple,
새 executor 계약, 최신 Work/runtime backup·schema/image guard 구성부터 진행한다.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.

2026-11-13 실제 Linux 처리 후속: 새 Windows peer 메시지 → Linux native
broker → 명시 processing API → Run/receipt1건 → Track의 동일 ID 관계·그룹을
대조했다. Linux 동결 SDK/worker의 실제 모델1요청·49event·성공 Run과
6node/5edge·3그룹 및 접기3edge·키보드 원본 상세를 확인했다. upstream 요청은
Windows 제한 gateway를 통과하며 원본 credential을 Linux로 복사하지 않았다.
마우스·pixel 품질은 미검증이다. 검증 코드 실패·실패 Run과 cleanup의 원격
인증 container ID 변경도 기록했으며 원래 상태로 되돌리지 않았다.
검증 자원은 정리했다. 다음 단계는 보존된 광범위 WIP를 통째로 채택하지 않고
운영 SDK/worker에 필요한 변경·authority·복구 경계를 정한 뒤 실제 서비스에서
검증하는 것이다. Assistant executor와 전체 교차 앱 업무 수용, 운영 Entra GUI도
남는다. [실제 peer 처리 기록](native-peer-processing-verification.json) 참고.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음이다. 아래는 이전 단계다.

2026-11-13 교차 OS 기반 후속: 공식0.12.17 daemon과 SDK `8a7f7f2`로 Windows↔
SSH Linux 서버의 실제 요청/응답·양쪽 inbox ACK·독립 DB readback을 검증했다.
서비스·기존 Agent 설정·원본 credential은 변경하지 않았고 daemon은 종료했다.
격리 팀 상태는 다음 단계용으로 offline 보관한다. Linux 호스트에는 Docker와
Python이 있고 host Node는 없다. 다음 단계는 이 실제 backend 위에 소유 범위의
native API/worker를 구성해 inbound message·conversation과 Run/receipt를 연결하고
Track의 실제 관계·중첩 그룹을 대조하는 것이다. 실제 model/Task 수행은 이 전송
검증에 포함하지 않는다. 운영 SDK/worker·Assistant executor binding·전체 교차 앱
업무와 Entra GUI는 별도 잔여 조건이다. 초기 실패와 cleanup 보정도
[실제 peer 전송 기록](native-peer-transport-verification.json)에 보존한다.

2026-11-13 후속: 실제 cowork의 멤버 간 결과 전달과 4회 모델 요청을 격리 QA에서
확인했다. native SDK의 하위 호출에 cowork 도구·callback·상위 guard를 전달하고,
실패한 병렬 멤버의 취소/정리까지 소유된 별도 worktree에서 보완했다. 원본 SDK와
worker의 운영 교체는 하지 않았다. Track `a56f558`은 그룹 범위 멤버 식별·단위별
시작/종료 요약·명시 부모 호출 아래 중첩, Trace/Trail Run 선택 안내를 추가했다.
로컬 관련41검사·타입 검사·분리 build와 Windows·Ubuntu CI를 통과했으며 운영
웹은 이전 동결 release다.
이후 SDK `8a7f7f2`와 Track `fc87202`로 버전 1 멤버/선행·호출 소속 계약과
중첩 그룹을 구현했다. 새 실제61event에서 dependency와 명시 호출 join을
대조했으며, `0a6a900`으로 상태 갱신 때 포트 측정이 초기화되어 edge가 사라지는
문제도 수정했다. 실제21edge 유지와 접힌 그룹20edge·원본seq16을 확인했다.
현재 동결 버전의 조건부 교체·독립 복구를 지원하는 v2 operator `f73a6d0`을
구현하고 Windows·Ubuntu CI를 통과했다. 실제12테이블 backup과 양쪽18자산의
격리 cold start를 거쳐 `0a6a900` API·웹을 함께 운영 반영했다. Task 두 개의
계정별 저장 보기·revision409·삭제, 기존 이력과 원본 서비스 보존을 확인했다.
Assistant의 최초 미인가 표시는 실제 목록/상세/이벤트200을 거친 뒤 connected로
확인했다. 후속 실제 병렬 QA는 독립 멤버2개의 upstream 구간2.45초 중첩과
합류 멤버의 양쪽 실제 결과 수신·최종 종합을 확인했다. UI14node/26edge·10그룹과
두 선행 관계를 대조했고, 관계 레이블이 그룹 헤더에 가려지는 클릭 문제를
`1f224c7`에서 수정·브라우저 회귀 검증했다. 다음 그룹 작업은 소유자 경계에 따른
SDK/worker 운영 전환과 실제 peer 조직화다. 다른 기기와 전체 업무 수용의 증거로 확대하지 않는다.
[병렬·합류 및 선택 회귀](native-parallel-flow-verification.json)를 따른다.
[운영 업그레이드 증거](track-runtime-upgrade-verification.json)를 따른다.
[실행·보존 기록](native-cowork-verification.json)을 따른다.
[후속 명시 관계·renderer 검증](native-cowork-flow-verification.json)에서 새 실제
실행과 운영 미반영 범위를 구분한다.

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
범위에서 구현했다. 계정별 저장도 격리 검증·운영 반영과 owner API 확인을 완료했다.
Entra GUI와 실제 조직화 업무의 전체 실기는 남았다. 기존 그룹 동작은 유지하며
저장 기능만으로 내부 흐름의 설명을 대신하지 않는다. 상세 시나리오와
AT-12-G01~G05는 `mission-ui-plan.md`의 작업 묶음 중심 탐색에 연결한다.

| 순서 | 변경 범위·의존성 | 구현 위치·수용 증거 | 현재 상태 |
| --- | --- | --- | --- |
| 1. 묶음 요약 | 현재 허용된 구성/상태·대기·산출물 근거를 연결. 원본 목적/입력/수용 조건 미제공과 부분 관측 구분 | `packages/projection/flow-group-context.ts`, `apps/web/src/FlowGrouping.tsx`. AT-12-G03, 혼합 단위·실패/미확인 검사 | 현재 metadata 구현. 원본 의미 필드 추가는 producer 계약에 의존 |
| 2. 내부/외부 문맥 | 그룹별 펼침·내부 초점·breadcrumb, 외부 선행/후속과 원본 끝점 이동·상위 복귀 | `FlowGrouping.tsx`, `flow-group-layout.ts`, `flow-navigation-state.ts`. AT-12-G01/G02, 경계 대표선·선택/viewport 검사 | 현재 화면 구현. 실제 복합 분기·합류 업무의 전체 왕복 검증은 남음 |
| 3. 공통 범위 | 현재 허용된 멤버를 네 화면에 전달. Trail은 Run별 lane, Trace는 실행별 흐름, Track은 업무별 요약 유지 | `packages/projection/group-workspace-scope.ts`, `apps/web/src/group-workspace-client.ts`와 네 소비 화면. AT-12-G04/G05, 전환·철회·동일 ID 구별 | 구현·합성 UI/HTTP 검사·게시 확인. 현재 운영 Entra GUI와 전체 실제 조직화 검증은 남음 |
| 4. 저장 보기 | 계정별 멤버 ID·묶음 이름·접힘 상태 저장과 재접속 시 원본 권한 재검사 | `saved-flow-views.md`, AT-12-G06. 계정 분리·CAS·재접속 복원·권한 철회와 새 관측 후 철회 검사 | 구현·격리 HTTP/SQLite·합성 UI 검사. 동결 API/웹 운영 반영과 실제 허용 Task의 owner API 저장·조회·충돌 검증 완료. Entra GUI와 실제 교차 앱 조직화 업무는 남음 |

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
시나리오는 후속이다. 4단계 저장은 별도 동결 API/웹으로 운영 반영하고 owner
API를 검증했다. 실제 Entra GUI 검증은 남아 있다.

2026-11-13 그룹 UI 상세 기획은
[Task 묶음의 흐름 해석](mission-ui-plan.md#task-묶음의-흐름-해석)에 추가했다.
순차·분기·합류·위임·재시도·공유 작업의 표현과 원본 근거를 구별하고,
그룹 선택 → 선택한 가지 펼침 → 원본 끝점/실행 상세 → 상위 복귀의 동작을
기존 구현과 대조했다. 구현한 공통 범위는 현재 화면 묶음의 멤버 ID와
권한 재검사 계약을 바탕으로 Map → Trace → Trail → Track 이동에
연결한다. 계정별 저장은 `saved-flow-views.md`의 구현·격리·운영 검증과 남은
Entra GUI 확인을 따른다. 새 구현 검증에는 동일한 분기·합류
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
