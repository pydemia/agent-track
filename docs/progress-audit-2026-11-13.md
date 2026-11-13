# 진행률 판정 감사

## 2026-11-14 후속 실제 운영 진전

01:51 감사에서 찾은 preview 실패를 같은 복원본에서 해결했다. 기존 시작 문맥
재검사의 Task3revision/UI6event를 정확히 역산한 persona_tasks/ui_events/
sqlite_sequence hash가 백업과 일치했다. 기존 실패 결과는 유지하고, 소유권을
검사한 중지 preview 앱을 제거한 뒤 성공한 Docker 전체 목록으로 부재를 확인했다.
앱 기동·백업부터 반복하지 않았다.

현재 baseline과 보고서가 백업과 같고 다른13개 component를 보존한 사전 검사
후 새 Assistant0691e1a로 전환했다. 실제 운영 DB의 schema·행·보고서·파일68개,
다른12개 서비스·renderer와 현재 역할의 native 서명 조회3개200을 확인했다.
같은 새 프로세스136177을 guard가 adopt했으며 이전f79 이미지는 중지 보존했다.
현재 Track 전용 reader credential로 새 Assistantv2 capability/목록도200이다.
새9639375 CI43468025771은 Windows·Ubuntu 성공이다.

새 Track release는2031file/27package를 별도 동결했지만 아직 운영 교체·새 보호
source 활성화 전이다. 수용15/21·71.4%(동일 가중치·부분0)는 유지하며 이 단계
진전을 전체 업무 성공으로 세지 않는다. 전체 ETA 산정 불가·신뢰도 낮음이며
첫 실제 전체 업무·원본 재개/재시도 범위 확인 후 재산정한다.
[최신 운영 증거](assistant-native-observation-operating.json)를 따른다.

## 2026-11-14 01:51 KST 진척 정체 판정

판정: **15/21·71.4%의 산술은 맞으나, 전체 개발 진척을 대표하는 보고로는 부족하다.**
요구별 수용 판정과 구현·운영 반영 단계를 구분해야 한다. 완료된 작은 요구와
전체 앱 통합 AT-14를 같은1점으로 계산하며, 부분은0점이다. 마지막14→15 증가는
11월13일18:10의 AT-18 판정 정정이었다. 약7시간40분 동안 새 상위 수용 완료가
없었고 전체 업무 성공도 나오지 않았다. 실제 작업이 없었던 것은 아니지만,
운영 준비·검증과 사용자 수용 사이의 차이가 보고에 충분히 드러나지 않았다.

이번 읽기 점검 기준은 main `de83d93e923fec303f6dde54531cebcef52755ac`와 미커밋
`tests/windows-web-process.test.ts`다. 원래21개 요구와 기존 완료15/부분6은 유지한다.
기존 완료는 기록된 owner/QA 환경의 누적 판정이며 이번에15개 운영 기능을 모두
재실행하거나 현재 배포의 전체 회귀 통과를 선언한 것이 아니다.

| 직접 재조회한 근거 | 결과와 한계 |
| --- | --- |
| 운영 pointer·설정·listener | Track release a3bb446/PID34464. 설정source5개 중 assistantNativeSourceId를 가진 보호 source0개. 새 코드 존재와 실제 운영 연결은 다름 |
| native/gate listener 및 기존 전환 증거 | API8081=16328/gate3100=22040. 원본API8080=15940/Web3001=55184 유지. 서명200/거부403 근거는 있으나 실제 보호 Run 본문 성공은 아직 없음 |
| 새 backup 작업의 terminal 결과 | encrypted-backup-restored-and-verified, helperRemoved=true. 두 DB별 일관성·격리 복원이며 운영 원본 복원이나 전체 업무 성공이 아님 |
| 같은 preview 작업 terminal 결과 | 실패. 후보 앱은health200. Work/runtime quick_check=ok·FK오류0·schema 동일. work lease2개 외 runtime persona_tasks/runtime_leases/sqlite_sequence/ui_events의 digest 변경. 정확한 업무 행 변경 원인은 아직 미확정. 기존 시작 delta 허용을 검토 없이 재사용하지 않음 |
| preview 정리 | cleanupFailed=true/helperRemoved=false. app에 operation label을 추가하지 않은 채 label 일치를 요구하는 cleanup 코드 불일치를 확인. 후속 소유권 확인·정리가 필요하며 검증을 통과로 바꾸지 않음 |
| 현재 main CI43463616697 | GitHub API 재조회: Ubuntu success, Windows failure의 실패 단계Run npm test. 현재 main 전체 CI 성공이 아님 |
| 미커밋 Windows fixture 관련 검사 | 보존 로그3pass/0fail/0skip, 실행은 종료. 로컬 관련 검사 통과이며 동일 변경의 CI 성공·과거 실패 원인 확정은 아님 |

읽기 점검은 원본 업무 데이터나 credential을 출력하지 않았고 새 운영 Task·Note·Run·
모델 요청, 배포·재시작·원본 DB 복원을 수행하지 않았다. 이미 끝난 backup과 preview를
관찰 실패만으로 다시 시작하지 않았다. preview 실패는 schema/DB 무결성 실패로
뭉뚱그리지 않고 행 보존 assertion과 cleanup의 별도 문제로 추적한다.

개선된 보고 기준은 [현재 상태](goal-status.md)다.
상위21개 분모·동일 가중치를 유지하며 임의로 부분50%/90%를 주지 않는다. 하위
단계는 구현/격리 검증/운영 반영/사용자 수용으로 기록하고 별도 개발 완료율을
만들지 않는다. 같은 검사·기동·backup 반복은 새 진척에서 제외한다.

남은 전체 범위는 AT-06/09/12/14/15/20이다. 다음 임계 작업은 같은 후보 복원본의
실패 원인 해결 → 새 Assistant/Track 보호 수집 운영 연결 → 실제 전체 업무의
결과·참조·Trace 대조다. AT-09 원본 재개/재시도는 기능 자체가 미지원이며,
그룹 탐색·다중 장치 기본 대시보드·동일 선택 이동·문맥 장애 격리 실기도 남는다.
전체 ETA는 산정 불가·신뢰도 낮음. 첫 전체 업무와 재개/재시도 구현 범위 확인이
재산정 지점이다. 별도 desktop 앱 계약이나 screenshot export를 추가 조건으로
만들지 않는다. goal은 원래 전체 범위로 active를 유지한다.

아래는 이전 시점의 감사 기록이다.

## 2026-11-14 보호 Run 수집 구현 후속

아래 감사에서 확인한 수집 경로 미연결을 실제로 수정했다. 새 Assistant metadata
route를 현재 소유자/Projects/원본 receipt와 대조하고, 별도 읽기 source의 Run별
허용 범위로 수집해 Track 원장·업무 연결·Trace를 구성한다. 합성 upstream을 쓰는
실제 HTTP/SQLite 검사6개에서 도구 호출의 시작/완료·pagination·철회·재시작을 확인했다.
실제 Demian SQL 조회와 portable 계약을 대조한 격리 PostgreSQL44개도 통과했다.
Persona coordinator/gateway184개는 lifecycle 호출/dispatch/관측 DB 쓰기 없이 현재
metadata를 읽는 경계와 늦은 철회를 검사했다. 각 검사에 skip은 없다.

전체 회귀 검사에서는 다른 actor의403을503으로 바꾸는 사전 조회 회귀1개를 찾아
연결된 Assistant 소유자만 조회하도록 수정했다. 해당 API/수집25개가 통과했고 최종 전체 회귀는990통과·실패0·Windows POSIX 검사9skip이다. 원본 운영 서비스·DB와 AgentTrail은 이번 작업에서 변경하지 않았다.

수용15/21·71.4%(동일 가중치·부분0), 직전 대비0%p를 유지한다. 이번 진전은
AT-14의 **코드와 격리 통합 경로 확보**이며 운영 업무 수용이 아니다. 다음 조건은
새 경로 운영 반영 후 실제 WorkCoordinator/Projects/Note→Track 업무 대조다.
과거 사용자 지정과 현재 hostname/IP를 대조해 desktop은 현재 Windows PC로
확인했다. 별도 앱 계약을 추가 대기 조건으로 삼지 않으며 같은 업무 접속 실기를
수행한다. ETA 산정 불가·신뢰도 낮음이며 첫 전체 업무 결과와 재개/재시도 구현
범위가 다음 재산정 근거다. [구조·근거](assistant-native-observation.md)를 따른다.

아래는 수집 구현 전의 감사 기록이다.

## 2026-11-14 KST 현재 작업본 재점검

기준 revision `bc4d262`와 미커밋 작업본을 대조했다. `goal-status.md`의 현재
요구 행은21개, 고유 ID21개, 완료15개·부분6개다. 기존 동일 가중치·부분0 기준의
수용률71.4%는 산술상 맞고 직전 대비0%p다. **제품 전체 개발 완료율로는 부적절하다.**
서로 크기가 다른 요구를 모두 닫을 때만 숫자가 변한다. 마지막 집계 상승도 새
기능 완료가 아닌 AT-18 판정 정정이었다. 기존15개 완료는 기록된 owner/QA 범위의
누적 판정이며, 이번에 전체 운영 기능을 재실행해 인증한 것이 아니다.

정체 원인은 집계 단위와 실제 미연결 기능 양쪽에 있다. 현재 단계를 구분한다.

| 경로 | 확인된 상태 | 아직 필요한 결과 |
| --- | --- | --- |
| Assistant/native 실행 전제 | 직전 운영 전환·DB 보존·현재 인가 조회의 증거 확보 | 해당 전제를 전체 업무 성공으로 확대하지 않음 |
| 보호된 Run metadata 조회 | Demian·Persona·Track의 미커밋 계약/조회 코드 존재. 이번 Track 관련 테스트12개·타입 검사 통과 | 실제 PostgreSQL/서비스 통합, 코드 반영과 운영 배포 |
| Track 수집·Trace 표시 | 새 `AssistantClient.nativeMetadata()`는 있으나 `apps`의 수집/authority 경로에서 호출하지 않음 | 현재 인가된 수집→원장→Trace 표시 연결. 보통 bearer의 보호 Run 차단은 유지 |
| 지속 업무 | 전체 WorkCoordinator→Projects 결과→Note→Track 성공 증거 없음 | 한 실제 업무의 지시·실행·결과·참조·관측을 같은 ID/receipt로 대조 |
| desktop | 독립 앱/접속 경로 계약 미확정 | 실제 대상 확인과 동일 업무 접속. Linux peer를 대체 증거로 사용하지 않음 |
| 다른 잔여 요구 | AT-06/09/12/15/20은 현재 기준표의 부분 상태 유지 | 원본 재개/재시도 구현, 동일 선택 이동·그룹 사용자 동작·여러 장치 대시보드·문맥 요약 실기 |

현재 작업본에 이전 타입 검사 성공을 그대로 재사용할 수 없었다. 이번 실행에서
`tests/assistant-native-metadata.test.ts`의 `{ nativeMetadata: undefined }`가
`exactOptionalPropertyTypes`와 충돌했다. fixture에서 optional method를 실제로
생략하는 최소 수정 후 `npm run typecheck`를 다시 통과했다. 아래 세 파일의
테스트는12개 통과·실패0·skip0이다.

- `tests/assistant-native-metadata.test.ts`
- `tests/assistant-v2-http.test.ts`
- `tests/assistant-v2-client.test.ts`

새 metadata 테스트는 합성 service/client 검사이며 실제 PostgreSQL·새 운영
endpoint·수집/Trace 통합을 증명하지 않는다. 이번 점검에서 운영 배포나 원격
서비스 재시작은 수행하지 않았다. 운영 전환 상태는 직전 증거
`assistant-native-promotion-verification.json`(2026-11-13T14:41:36.863Z)에 근거한다.

이후 보고는 **수용률 / 직전 대비 실제 변화 / 미연결 기능 / 다음 완료 조건**을
함께 적는다. 커밋·테스트 개수나 부분 구현에 사후 점수를 주지 않는다. 같은 검사를
새 변경·실패 없이 반복한 것을 진전으로 세지 않는다. 다음 완료 조건은 현재 인가된
보호 Run metadata를 실제 Track 원장과 Trace까지 연결해 대조하는 것이다.
전체 ETA는 산정 불가·신뢰도 낮음이며, 첫 전체 업무 결과와 desktop 계약이 확보될
때 재산정한다. 수용15/21·71.4%의 분모/가중치와 원래 goal 범위는 유지한다.

아래는 이전 시점의 기록이다.

## 23:42 KST 실행 후속

이후 실제 goal 작업에서 Assistant 후보 f79a5b1을 운영 반영했다. 복원본 검사의
WAL 보조 파일 접근 문제를 재현·수정하고, 같은 복원본의 정확한 DDL/행 검사를
통과했다. 기존 업무 행·보고서의 최신 baseline을 새로 확인한 뒤 전환했다.
새 백업이나 후보 앱 기동을 관찰 timeout만으로 반복하지 않았다.

운영 기동 후에는 Docker가 후보 OomKillDisable만 false→null로 반환해 검증이
실패했다. HostConfig 전체 hash·clone verifier로 다른 변화가 없음을 대조했고,
e6ceacf에서 후보 전용의 기존 정규화 계약을 사용하도록 수정했다. 회귀는 수정 전
실패·수정 후33개 통과, 두 CI 플랫폼 성공을 확인했다. 실행 중인 후보/renderer/
budget/avatar는 재시작 없이 같은 PID로 adopt했다. 운영 DB의4개 새 빈 테이블,
9개 schema object·기존 업무 행/시작 delta·보고서·선택 파일68개와 다른12개
서비스를 대조했다. 현재 역할과 실제 운영 환경으로 native 서명 GET3개도200이다.
원본 앱은 보존 이름으로 중지 상태다. DB·인증을 복원하거나 전체 업무를 실행한
것은 아니다. 실제 power reboot/crash 복구·새 인증 GUI도 미검증이다.

이는 AT-14의 **운영 Assistant 전환 조건 폐쇄**다. protected metadata 조회와
실제 WorkCoordinator/Projects/Note·desktop/Track 전체 흐름이 남아 상위15/21·
71.4%는 유지한다. 수치가 같아도 이번에는 새 운영 상태가 확보됐음을 분리해
기록한다. 전체 ETA는 산정 불가·신뢰도 낮음이며 다음 예측 근거는 첫 지속 업무와
desktop 계약이다. [운영 증거](assistant-native-promotion-verification.json),
[현재 수용 기준표](goal-status.md)를 따른다.

## 22:51 KST 실제 상태 재확인

이번 사용자의 진척 정체 점검에 대해 HEAD `a59e89b`의21개 요구 행을 직접 집계했다.
완료15·부분6, 중복/누락0으로 **산술상15/21·71.4%는 맞다.** 그러나 동일 가중치의
큰 요구를 모두 닫을 때만 증가하는 수치여서 개발 작업량이나 핵심 업무의 사용
가능성을 대표하지 못한다. 전체 개발 완료율을71.4%라고 보고해서는 안 된다.
14→15의 마지막 증가는 새 제품 기능 완료가 아닌 AT-18 판정 정정이다.

원격 실제 상태를 새로 조회했다. 기존13개 component의 process와 canonical
설정 계약은 불변이다. Assistant는 이전 image `92ee2a2b…`를 실행 중이고 native
후보 image `cb3df22a…` container는 시작하지 않은 상태다. 로컬 listener의 PID도
기존 API8080=15940/API8081=12356/Track14345=34464/gate3100=33564/Web3001=55184로
대조했다. listener 존재는 해당 기능의 전체 성공 증거로 사용하지 않는다.

새로 확보된 전환 준비는 실제 두 DB의 암호화 백업·별도 복원 검증(Work45,719,552byte,
Runtime5,203,533,824byte)과 복원본의 전체 후보 앱 기동/health200이다. 백업은 DB별
일관성이며 두 DB의 원자적 동시 snapshot은 아니다. 뒤이은 복원본 DB 검사에서
`ERR_SQLITE_ERROR`/`unable to open database file`이 발생했다. 검사 코드에는 읽기
전용 mount에 결과 파일을 쓰려는 별도 문제도 있어 수정이 필요하나, 관측된 SQLite
오류의 원인으로 확정하지 않는다. **전체 preview 실패, 운영 전환 미완료**로 기록한다.
cleanup의 Docker log 읽기도 exit1이었고, 멈춘 앱 container가 남아 별도 소유권/원본
비참조 검사를 거쳐 제거했다. 실패 증거·복원 volume은 유지했다. 원본 DB/서비스를
되돌리거나 새 모델 요청을 보내지 않았다.

따라서 실제 정체도 있다. 운영 준비·보존 검증이 길어지는 동안 전체 사용자 업무의
새 성공이 나오지 않았다. 다음 검사는 보존된 복원본의 실패 경계를 해결하는 것으로
한정하고, 완료한 대용량 백업·후보 기동을 관찰 실패만으로 반복하지 않는다.
상위 수용15/21은 유지한다. 실제 잔여 기능/실기와 다음 폐쇄 조건은
[현재 단계 표](goal-status.md#2026-11-13-2251-kst-재점검)에 분리했다.
전체 ETA는 산정 불가·신뢰도 낮음이며 첫 지속 업무와 desktop 계약이 다음 예측 근거다.
이번 감사로 goal을 완료·축소하거나 운영 Assistant를 전환하지 않는다.

아래는 이전 시점의 감사 기록이다.

최초 감사 기준: 2026-11-13 KST, HEAD `19a8924a14ed06609acbc76fcd666fe6982f6fc5`.
Track 운영 코드 기준은 `a3bb446b9f32939ec7a6e15237e6f6d4ac6f1003`이다.
원래 수용 조건은 [제품 기획](product-plan.md), 그룹 확장은
[그룹 UI 계획](mission-ui-plan.md)의 AT-12-G01~06을 따른다.

**수용 항목 충족률을 14/21·66.7%에서 15/21·71.4%로 정정한다.**
21개 상위 요구의 동일 가중치와 분모를 유지한다. 부분 항목에는 임의의 점수를
주지 않았다. AT-18의 기존 보류 조건을 바로잡아 1개를 재분류한 결과다.
이 비율은 개발 작업량, 사용자에게 유용한 정도, 운영 준비도나 남은 시간의
추정치가 아니다. 전체 교차 앱 업무 수용(AT-14)은 여전히 미검증이다.

## 감사 이후 실제 운영 진전

2026-11-13 21:46 KST 후속에서는 원본 백업의 격리 복원본 검증을 거쳐
migration026·현재 역할 binding·동결 전용 API/worker·공개 서명 경계를 운영
연결했다. 기존 일반 API와 Track의 native 수집은 유지됐고, 보호 Session의
일반 bearer 조회는404다. 기존19Run/810event와 기존 행을 보존했다. 생성된 새
Session journal과 새 worker의 빈 catalog도 별도로 대조했다. 실제 모델/Run은0이다.

Persona `f79a5b1` 후보 이미지를 서버에서 빌드하고, 그 compiled host loader와
gateway가 Linux→공개 HTTPS→현재 native 인가 경계의 capability/actor/Session을
모두200으로 확인했다. 실제 현재 binding을 사용한 읽기 검사이며, 운영 Assistant
전환이나 WorkCoordinator 실행으로 세지 않는다. 해당 소스의 최신 CI 네 job은
성공했고, 앞선 같은 소스의 Playwright 단계 실패는 원인 미확정으로 보존했다.

이전의 “전용 API/worker가 운영 미가동”이던 하위 단계가 닫혔다. 상위 AT-14는
Assistant 운영 전환·protected metadata 조회·전체 업무가 남아 부분 상태다.
**수용15/21·71.4%는 유지**하며 전체 개발 완료율이나 남은 시간 비율로 환산하지
않는다. 전체 일정은 여전히 산정 불가·신뢰도 낮음이며, 첫 실제 WorkCoordinator
업무와 desktop 경로가 다음 재산정 근거다.
[운영 증거](demian-dedicated-service-verification.json)와 [현재 기준표](goal-status.md)를
우선하며 아래19:45/21:11의 미가동 표현은 당시 감사 기록이다.

## 사용자 재질문에 따른 후속 점검

재대조 기준: 2026-11-13 19:45 KST, HEAD `17f6b4a`와 아래 원본 요구/구현/
검증 기록. 감사 전 HEAD의 CI `43410225238`은 성공이다. 이번 점검은 진척 집계와
판정의 감사이며 운영 명령·업무·모델 실행이나 전체 회귀 재실행이 아니다.

**상위 수용 집계 15/21은 유지하지만 이를 제품 개발 완료율로 보고하는 것은
부적절하다.** 동일 가중치라는 계산 규칙은 일관돼도, 식별·SNB 같은 요구와
Assistant부터 desktop까지의 전체 업무가 각각 1점이어서 실제 남은 작업량이나
핵심 사용 가능성을 대표하지 않는다. 현재 전체 업무의 성공 기록은 없다.

- `565dffc`의 11월12일03:14부터 `bed992e`의 11월13일18:10까지 약39시간
  14/21이었다. 부분 구현/실기/운영 진전이 그 사이 없었다는 뜻은 아니다.
- 15/21로 오른 것은 AT-18의 불필요한 보류를 해제한 **판정 정정**이다.
  그 시점에 사용자 핵심 업무가 새로 완성된 것으로 표현하지 않는다.
- 이후 Projects 원본 결과 계약이 실제 운영 앱에19:11 KST 배포됐고,
  기존 Assistant 서명 소비자는19:13, Track 소비자는19:16에 확인됐다.
  AT-14의 전제 완료다. 생산 업무/Note/Run을 생성하거나 전체 업무를 통과한
  증거는 아니다 (`projects-results-verification.json`).
- 재개/재시도는 단순 테스트 대기가 아니라 원본 계약·실행 기능이 미지원이다
  (`RunControls.tsx`, `packages/commands/`). Desktop 연결도 독립 앱/bridge 위치와
  API부터 미확정이다 (`integration-contracts.md`). 이를 모두 “실기만 남음”으로
  묶으면 실제 잔여 작업을 과소평가한다.
- 최신 상태와 초기 기록의 혼동도 남아 있었다. `product-plan.md` 10.1의
  “현재 달성 상태” 아래 11월11일 잔여 목록은 초기 기록으로 명시하고 최신
  단일 원본을 연결했다. 과거 검증 JSON은 당시 상태로 유지한다.
- 보류 기준도 좁혔다. AT-12의 특정 Entra 재로그인·스크린샷 export·추가 기기
  재접속 자체와 AT-15의 여러 클라이언트 동시 접속은 원래 요구의 독립 필수
  조건이 아니다. 기존 합성 GUI/운영 API 증거를 재사용하고 원래 사용자 동작을
  확인한다. 실제 peer 대표선의 포인터 선택은 이전 시도가 viewport 제약으로
  성공하지 못했으므로 별도 확인이 남는다. 이 사실은 제품 결함 확정과 구별한다.
- AT-06/20의 무인증 Basic401과 인증 root/context200을 함께 대조했다. 실제
  브라우저의 동일 선택이 미검증이라는 판정은 유지하지만, 무인증401만으로
  새 인증 프로토콜 구현이 반드시 필요하다고 단정하지 않는다. 기존 공개 Entra
  정책을 완화하거나 Basic 우회를 허용한다는 뜻은 아니다.

| 부분 요구 | 현재 확보한 단계 | 실제 기능·연동 부족 | 아직 필요한 수용 증거 |
| --- | --- | --- | --- |
| AT-06 | Session URL·원본 웹 반영·인증 HTTP200 | 사용자 브라우저 인증/선택 경로는 미확인. 새 인증 구현 필요까지 확정하지 않음 | 허용 인증으로 동일 Session/Task를 선택하는 실제 이동 |
| AT-09 | 취소 UI·원본 cancelled·receipt | 원본 재개/재시도 계약 및 지원. capability 안내만으로 기능 충족 처리하지 않음 | 해당 명령의 실제 수락/결과·중복 방지. 원래 기능 범위 유지 |
| AT-12 | 그룹/관계/깊이/네 보기/저장 구현·운영 반영, 실제 협업 QA | 이번 대조에서 새 기능 결함을 확정하지 않음 | 배포된 네 보기 범위·저장 복원의 사용자 동작, peer 대표선 포인터 선택. 특정 재로그인·스크린샷 자체는 추가 게이트가 아님 |
| AT-14 | 실제 gateway 위임 QA, Projects 결과 계약 운영 반영 | 운영 Assistant/native 실행 설정·현재 인가·protected Run 관측 연결, desktop 경로 미확정 | 지속되는 실제 WorkCoordinator 업무·결과/Note·desktop 접속·Track 검토의 전체 흐름 |
| AT-15 | 여러 프로젝트·Windows/Linux 전송과 별도 처리 QA | 동일 운영 대시보드의 장치 통합 여부는 아직 입증되지 않음 | 여러 장치 세션이 같이 보이는 첫 진입, 필터 해제 후 선택/상태 보존. 여러 클라이언트 동시 접속은 추가 요구가 아님 |
| AT-20 | Projects 운영 요약, Demian 원본 웹의 인증 HTTP 문맥 조회 | HTTP200과 사용자 브라우저 접근을 구별. 새 인증 구현 필요까지 확정하지 않음 | 원본 인증 GUI·같은 선택 이동·원본 공개 웹의 Track 장애 격리 |

기존 완료 15개는 각 기록의 owner/QA 범위를 유지한 누적 수용 판정이다. 현재
운영 전체 사용자/플랫폼의 재인증이나 모든 원본 archive 재검증을 수행한 판정으로
확대하지 않는다. 이번 후속 점검만으로 완료 개수를 올릴 새 근거는 없다.

이후 보고는 동일 분모의 수용 충족률과 별도로 **이번에 닫은 하위 조건 / 실제
기능·연동 부족 / 미검증 조건 / 다음 판정 검사**를 명시한다. 하위 항목에 사후
점수를 배분해 새 개발 완료율을 만들지 않는다. 외부 요인과 실제 기능 부족을
구분하며, 원본 전체 업무와 desktop 미확정 때문에 전체 완료 예상은 산정 불가,
신뢰도 낮음이다. 운영 실행/인가 연결과 첫 전체 업무 실기가 다음 예측 갱신 근거다.

## 최신 소스와 운영의 대조

2026-11-13 21:11 KST 재점검. Git HEAD/작업 상태, 현재 로컬 listener/PID·생성
시점, Track release pointer, Demian active record, 별도 검증 결과를 대조했다.
서비스 변경·새 모델 요청·운영 업무 쓰기는 하지 않았다. 기존 완료15개는 앞서
기록한 증거 범위를 유지하며 이번 조회로 모든 운영 동작을 재검증한 것이 아니다.

| 대상 | 현재 소스·확보한 검증 | 운영 반영·사용자 경로 판정 |
| --- | --- | --- |
| Track | `6f187eb`: 전용 서명 프록시와 기존 browser gate 분리, 관련 loopback 검사8개 통과 기록 | 운영 pointer는 `a3bb446` release, PID34464/14345. 새 프록시의 운영 적용은 미완료 |
| Demian | `c439341`: 배포 전용 worker 접수/복구 범위, 취소 권한의 동일 transaction 검사, 전용 API entry, 실제 역할 toolScope 문맥 보존과 구버전 worker 배제 | 기존 API PID15940/8080·bundle SHA `11bd7cd3…` 유지. 새 전용 API8081 listener 없음. migration026·새 API/worker의 운영 전환 미완료 |
| Persona/Assistant | `f79a5b1`: prepared 역할 문맥 보존과 API capability 확인. 관련122개 검사 통과 기록 | 후보 소스. 현재 운영 Assistant가 이 후보를 실행한다고 확인한 근거 없음. 최신 후보의 CI/배포를 이전 후보의 성공으로 대신하지 않음 |
| 실제 의존성 검사 | 격리 PostgreSQL 회귀123개 통과/실패0/skip0, 21:00 종료. 실제 provider 모델 요청0, QA container/network 정리 기록 | 현재 소스의 일부 경계 검증. 운영 전체 업무·실제 모델 호출 성공을 뜻하지 않음 |
| 운영 전환 준비 | 최신 원본 백업을 별도 DB에 복원해45테이블 지문 대조. private 구성 준비 | 원본 복원/worker 활성화 아님. 새 migration 적용과 지속 서비스 구성·현재 인가 검증은 별도 |

123개 검사 근거는 로컬
`.runtime/dedicated-work-service/verification/result-819fe2d5-372d-4c33-bee1-0d6cf28a17f5.json`이다.
이 결과는 소스 commit 직전의 관련 변경을 검사한 기록이며, commit 뒤 새로운
전체 CI를 실행한 것으로 표현하지 않는다. 이전의 완료된 Run을 worker가 중지돼도
조회/취소할 수 있어야 하는 회귀를 발견·수정한 뒤의 최종 결과를 사용했다.

이번 재점검에서 확인한 보고 문제는 다음과 같다.

- 계산식 `15/21`은 맞지만, 이를 작업량이나 사용 가능한 제품의 완료율로
  전달하면 잘못된 판단을 유도한다. 남은6개가 작업량의28.6%라는 근거는 없다.
- 이미 진행된 소스/검증을 최신 기준표에 제때 반영하지 못했다. 기준표의 HEAD
  `17f6b4a`와 Persona `b6504e5` 표현을 현재 소스 기준으로 갱신했다.
- 전체 업무가 미완료인 것은 단지 보수적인 점수 처리 때문만은 아니다.
  운영 실행/metadata 인가 연결, 재개/재시도 기능, desktop 경로가 실제로 남았다.
- 14→15 변화는 AT-18의 판정 정정이다. 새 기능을 운영 배포해 얻은 진척과
  구별한다. 이후의 소스·테스트 증가는 AT-14의 전제 진전으로 기록한다.

다음 보고는 충족률 외에 각 잔여 요구의 **구현 / 운영 반영 / 사용자 수용**
단계를 함께 제시한다. `부분`에 임의의50%/90%를 주거나 작은 하위 작업을 늘려
개발 완료율을 만들지 않는다. AT-14의 다음 관찰 지점은 새 실행 경계의 운영
가동·현재 역할로 서명 조회/실행 확인 → protected metadata 인가 연결 → 지속
WorkCoordinator/Projects/Note 업무와 desktop/Track 검토다. 이 과정에서 실제
완료된 사용자 조건만 상위 판정에 반영하며, 선행 코드 준비만으로 닫지 않는다.

**수용 충족률15/21·71.4%(동일 가중치, 부분0)는 유지한다. 전체 개발 완료율은
산정하지 못하며, 전체 완료 시점도 산정 불가·신뢰도 낮음이다.** 첫 운영 통합
업무의 성공/실패와 남은 desktop 경로가 다음 일정 예측을 갱신할 근거다.

## 보고가 실제 진전을 보여 주지 못한 이유

이하 내용은 최초 감사 기록이다. AT-12의 특정 로그인/스크린샷 게이트와
AT-15의 동시 조회 표현은 위 후속 점검의 좁혀진 판정을 우선한다.

- `565dffce`(2026-11-12 03:14:07 KST)에 이미 14/21이 기록됐다. 감사 시작
  2026-11-13 17:27 KST까지 약 38시간 동안 같은 수치가 유지됐다.
- 부분 항목에 새 구현·실제 실행·배포 증거가 쌓여도 모든 하위 조건을 닫기
  전까지 분자가 바뀌지 않았다. 이를 전체 개발 진척으로 반복 전달했다.
- AT-18에 원래 요구에 없는 전체 업무·desktop·운영 SDK 전환 조건을 섞었다.
  이 잔여 작업은 AT-14/15의 실제 통합과 운영 범위에서 추적해야 한다.
- 최신 실기와 오래된 상태가 섞였다. 실제 child/peer를 미검증으로 적은 그룹
  계획, 원본 웹 적용 전 Docker 장애로 보류했다고 적은 AT-20 등이 해당한다.
  과거 검증 JSON의 한계는 당시 기록으로 보존하고 최신 후속 기록을 연결한다.

## 부분 항목에 누적된 실제 진전과 남은 조건

| 요구 | 확보한 근거 | 현재 판정과 다음 수용 검사 |
| --- | --- | --- |
| AT-06 앱 간 이동 | Session URL·미지원 Run 안내, 원본 공개 웹 교체 | 부분. 원본 Demian 공개 경로는 기존 Basic gate다. 허용된 인증으로 동일 Session/Task가 선택되는 브라우저 이동은 미검증 |
| AT-09 실행 제어 | 공개 UI 취소→native cancelled·receipt, 중복·unknown·철회 방어 | 부분. 재개/재시도의 원본 계약과 실제 흐름은 미지원. capability에 맞게 숨기는 기능과 실제 제어 지원을 구분 |
| AT-12 그룹·깊이 탐색 | typed edge·중첩 그룹·상세·접기·복귀·네 보기 범위·저장, 실제 child/병렬 합류/peer, 동결 운영 배포 | 부분. 최신 운영 revision에서 네 보기 공통 범위와 저장/복원의 인증 GUI 대조가 남음. 병렬 대표선 마우스 선택은 통과했고 peer 사례의 마우스/pixel은 미검증. 전체 desktop 업무를 이 renderer의 추가 게이트로 삼지 않음 |
| AT-14 교차 앱 업무 | Assistant 실제 실행 읽기, gateway→native Run1·attempt1·전송1·8event·응답/receipt DB 대조 | 부분. QA 위임은 WorkCoordinator/Projects 결과 연결·desktop 접속·Track 검토를 통과한 전체 업무가 아님. 운영 실행 authority와 protected Run metadata 인가도 별도 연결 필요 |
| AT-15 전체 대시보드 | 여러 저장소/workspace·필터와 실제 Windows→Linux 메시지/처리 Run | 부분. 같은 기본 대시보드의 여러 장치 동시 조회·필터 해제 후 선택/상태 보존을 실제로 대조해야 함. 별도 QA source의 Linux Run만으로 완료 처리하지 않음 |
| AT-18 관계 구분 | 원본 invocation/cowork·managed-child·peer ID/receipt, 명시 관계·인가·고유 Run 집계, 실제 child·병렬·Linux 처리 QA | **검증 완료로 정정(인가된 QA 범위).** 운영 SDK/worker 전환과 전체 업무는 별도. protected Assistant 위임 Run을 일반 bearer로 노출한 것으로 간주하지 않음 |
| AT-20 두 앱의 문맥 요약 | Projects 운영 화면·장애 격리, Demian 분리 웹 실제 Run·복구, 원본 공개 웹의 context200/연결됨/동일 Session·wrong actor403 | 부분. 원본 웹은 이미 교체됐다. 기존 Basic gate 아래 HTTP 확인을 인증 브라우저 GUI·같은 선택 이동·원본 공개 웹의 장애 격리 검증으로 확대해야 함 |

주요 증거:
[병렬/합류](native-parallel-flow-verification.json),
[실제 peer 처리](native-peer-processing-verification.json),
[managed child](native-managed-child-verification.json),
[저장 보기 후속](saved-flow-views-verification.json),
[모델 요청과 운영 배포](model-request-trace-verification.json),
[Assistant 실제 위임](assistant-native-delegation-verification.json),
[Demian 원본 웹 교체](demian-public-web-promotion-verification.json).

## 기존 완료 14개 재대조

다음은 기존 증거와 현재 코드/상태표를 대조한 결과다. 이번 감사에서 원본 업무를
재실행하거나 운영 서비스의 모든 회귀 검사를 새로 수행한 결과는 아니다.
기존의 단일 owner·명시 QA 등 보장 범위를 유지하며 전체 사용자·운영 업무로
확대하지 않는다. 이전 실기의 원본 private DB archive를 이번에 모두 재개봉하지는
않았으므로 실기 결과에는 저장소의 검증 기록에 의존하는 범위가 있다.

| 요구 | 유지한 판정의 근거와 한계 |
| --- | --- |
| AT-01 식별 | `tests/core.test.ts`의 ID·중복·gap·재시작과 기존 실제 원장 기록. 단위 검사를 전체 외부 시스템 증명으로 확대하지 않음 |
| AT-02 상태 | `recovery-http.test.ts`·`source-availability.test.ts`, 실제 native 성공/취소·수집 실패 시 원장 보존/노출 차단 |
| AT-03 복구 | HTTP 단절·cursor/gap·중복 검사, 실제 native cursor17 재접속. PC 전체 재부팅과 구별 |
| AT-04 Trail | `native-files-verification.json`·`track-browser-verification.json`: 실제 파일/산출물·hash·누락·철회, 전체 파일 시스템 수집은 아님 |
| AT-05 Trace | `implementation-qa.md`·`native-flow-verification.json`: 실제 도구·native event·없는 호출 ID unknown. 모든 모델 요청의 비용/토큰 측정은 아님 |
| AT-07 조회 인가 | `projects-live-verification.json`·`native-binding-verification.json`: 현재 owner의 Project 철회/복구·교집합·다른 actor 거부. 추가 사용자 연결은 별도 |
| AT-08 화면 | `ui-state-verification.json`·`track-browser-verification.json`: 네 화면/빈/503/단절/철회/만료·favicon·키보드. 실제 조직 membership 철회와 구별 |
| AT-10 승인 | `native-approval*-verification.json`: allow_once/session·deny·expiry·revocation·파일/receipt. 현재 owner·명시 QA 범위 |
| AT-11 배정 | `native-task-assignment-verification.json`: 실제 Task·기존 Session2·Run2·input hash/수락/성공. 자동 subagent 조직화나 Task 수용 완료가 아님 |
| AT-13 보존 | `live-restore-verification.json`: 별도 실제 복원 DB/API·232Run/17,456event·cursor/receipt digest. 실제 pending/binding0은 fixture 보완, 운영 DB 전환 아님 |
| AT-16 SNB | `implementation-qa.md`: 960px pointer/keyboard/복원·390px drawer/Escape/focus. 기존 실제 CUA 기록 재사용 |
| AT-17 Entra | `track-browser-verification.json`·`track-server-verification.json`: Track 본인 동의/로그인/SSE/logout/재로그인·Basic/위조 차단. 현재 새 GUI 실기는 로그인 입력 대기 |
| AT-19 binding | `native-binding-verification.json`: 실제 Task A→B/revision/CAS/재시작·Run 성공과 Task todo 구별·철회 |
| AT-21 실제 관측 | `native-observation-verification.json`·모델 요청 운영 후속: 동일 실제 Run/17event/cursor와 재시작·원본 대조 |

AT-18은 현재 `session-relations.ts`의 조회 전후 원본 인가·grant 재검증,
`session-relations-flow.ts`의 명시 유형/참조 구분,
`flow-groups.ts`의 source-qualified 고유 Run 집계와 실제 QA 기록을 함께 확인했다.
현재 코드의 관계 API/client/flow/web·그룹 집계 기존 검사 40개를 재실행해
40개 통과·실패0·skip0을 확인했다(약 10.5초). 운영 동작을 새로 실행한 검사는 아니다.
Track `a3bb446`의 Windows/Ubuntu CI는 회귀 보조 근거이며 실제 교차 앱 수용을
대신하지 않는다. 테스트 개수를 진행률의 분자로 사용하지 않는다.

## 앞으로의 보고와 실행 순서

현재 수치와 행별 판정의 단일 원본은 [goal-status.md](goal-status.md) 상단이다.
과거 수치는 이력으로 표시한다. 이후 보고에는 수용 충족률과 함께 **직전 대비
새로 확인된 하위 단계, 아직 사용자 경로를 막는 조건, 다음 검사**를 명시한다.
새 하위 항목을 만들더라도 기존 상위 항목의 가중치나 분모를 바꾸지 않는다.

남은 임계 경로는 현재 identity/source·실행 authority/metadata 인가 연결 →
실제 WorkCoordinator/Projects 결과 연결 → desktop 접속과 Track 검토다.
원본 Demian 인증 이동·문맥 요약 GUI, 그룹 운영 GUI, 다중 장치 대시보드 검사는
각 요구의 잔여 조건으로 분리한다. 완료된 관계 renderer를 다시 전체 업무와
묶어 보류하지 않는다.

전체 완료 예상은 산정 불가, 일정 신뢰도 낮음이다. 아직 전체 업무의 첫 성공
실기가 없고 desktop 연결 경로와 운영 실행 구성이 미완료여서 날짜를 추정할
근거가 부족하다. 다음 재산정은 위 잔여 검사 중 실제로 닫힌 조건이 생겼을 때다.
이번 감사는 전체 goal 완료나 중단이 아니며 제품/서비스 배포를 변경하지 않는다.
