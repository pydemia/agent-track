# Demian API 재연결과 원본 보존

2026-11-12 후속: 아래 보존·복구 검사 후 원본 API8080만 고정 bundle로
재가동했다. Track은 같은 source의19Run·810event를 중복 없이 다시 인가해
표시한다. worker는 중단 상태이며 원본 Web 문맥 요약·협업 runtime·자동 시작
연결은 후속이다. API 가동을 전체 Demian 운영 복구로 계산하지 않는다.

## 확인한 시작 경계

Demian 담당 세션과 원본 시작 코드를 대조했다. 기존 `start.ps1`은 DB·API/
Web·worker·도메인을, `start.mjs`는 API와 Web을 함께 가동한다. API-only 진단에
이 도우미를 사용하지 않는다. 기존 Web 포트3000은 사용 중이다.

Backend는 기존 trusted bearer의 고정 local owner이며 Cerbos·별도 Track reader
principal을 구성하지 않았다. DB role도 superuser다. 새 metadata GET이 읽기
전용이라는 사실로 credential 전체를 읽기 전용이라고 설명하지 않는다.

공개 Web3001·HTTP Basic 게이트3100·tunnel이 이미 실행 중이다. API8080을
가동하면 이 경로의 연결과 쓰기 중계도 복구될 수 있다. Track·Trail의 Entra
인증과 다른 기존 경계다. 이번 canary는 이 경로를 가동하지 않았다.

## 실제 읽기 전용 canary

API bundle `11bd7cd308a6f11b2a25a71dc3fca9afff750de99bee8b10d75cb98a8d22ed66`을
별도 고정 파일로 복사하고 `127.0.0.1:18080`에서만 실행했다. native manifest8개
source bytes를 전후 대조했다. 이 source는 `297678ea` 위의 미커밋 작업 트리이며
HEAD만으로 bundle을 재현할 수 없다.

API의 PostgreSQL 연결에 `default_transaction_read_only=on`을 강제했다.
work-runtime·peer·assistant-peer·deployment 설정은 전달하지 않았으며 migration·
seed·worker·discovery를 시작하지 않았다. 실제 Track `DemianClient`로 검사했다.

| 검사 | 결과 |
| --- | --- |
| Ready | 200 |
| 기존 성공 Run | `82f7e1fd-8fe2-4da1-8307-99f3e016f48c`, 동일 Session |
| 기존 SSE 재조회 | 연속 sequence1..17,17event |
| managed-child GET | `available`,0건 |
| peer-processing GET | `unconfigured`,0건 |
| token 없는 관계 GET | 401 |
| 위임 header를 넣은 관계 GET | 403 |
| 시작 전·후 / 조회 후 원장 | public45개 테이블의 count·전체 row SHA-256 일치 |
| 스키마 | columns·constraints·indexes·views·grants SHA-256 일치 |
| 종료 | 새 PID의 executable·entry·creation time 확인 후 해당 API만 종료 |

기존 service·secrets·worker·Track 설정 bytes와 native source/bundle을 유지했다.
8080·18080은 종료 상태이며 신규 source 등록·원장 재수집·Task/Run 생성은0이다.
비밀값·메시지·도구 인자·출력 본문을 이 문서에 기록하지 않는다.

## DB 백업·격리 복원과 실행 파일 고정

현재 원장의 읽기 전용 transaction snapshot으로 role 정의와 custom DB dump를
스트리밍 AES-256-GCM으로 암호화했다. 키는 Windows DPAPI CurrentUser로 보호하고
평문 DB를 디스크에 쓰지 않았다. 저장된 envelope·키·ciphertext에서 인증 복호화와
변조 거부를 검사했다. 별도 프로세스에서도 같은 백업을 다시 복원했다.

같은 PostgreSQL17.11 image의 새로운 컨테이너에만 복원했다. network 없음·외부
port 없음·root filesystem 읽기 전용·DB는 새 tmpfs로 제한하고 원본 볼륨을
마운트하지 않았다. 원본45개 테이블의 전체 row와 sequence1개의 값·정의·
`is_called`, role1개의 속성·비밀번호 해시를 대조했다. 함수40개·trigger37개를
포함한 schema dump도 대조했다. 원본 DB·설정·컨테이너 시작 시각은 그대로였고
이번에 만든 복원 컨테이너만 identity를 확인해 제거했다.

Raw schema dump는 `device_connections`의 CHECK 하나에서 AND의 괄호 표기가
달랐다. PostgreSQL 파서의 재표현 차이로, 이름별 `pg_get_constraintdef(oid,true)`
정의는 일치했다. 전체91개 CHECK를 이 정의로 대조하고 다른 DDL bytes는 그대로
비교해 통과했다. 원래 raw 불일치를 숨기거나 모든 CHECK를 제외하지 않았다.

초기 메모리 사전 검사와 raw 비교 실패는 검증 JSON에 남겼다. 스트리밍 primitive
6개·CHECK 대조2개 검사도 통과했다. 복구 키의 다른 Windows 계정/장치 사용과
디스크 전체 무결성은 증명하지 않았다. 외부 workspace·provider runtime 파일은
이 DB 백업에 포함하지 않으며 원본 DB에 복원하지 않았다.

API bundle은444개 입력 파일을 별도 보존하고 두 번 재빌드해 같은 bytes를
확인했다. 위 canary에서 사용한 bundle과도 일치한다. 원본 dirty checkout이나
기존 시작 파일은 수정하지 않았다. worker/runtime을 추가로 활성화할 때는
해당 실행 파일·설정·상태 보존을 별도로 검증해야 한다.

## API-only 운영 재연결 결과

기존 `127.0.0.1:8080`에서 고정 bundle만 별도로 실행했다. 원래의 격리된
runtime-home·trusted owner·credential·DB·workspace·CORS를 child 프로세스에
유지했다. 원본 시작 파일·service/worker/domain/Track 설정과 기존 listener의
PID·시작 시각은 전후 대조했다. worker·migration·seed·선택 runtime은 시작하지
않았다. Track·Trail의 기본 Entra 인증은 유지하며 Demian의 기존 공개 Basic
경계와 구분한다. API 자동 시작은 아직 연결하지 않았다.

가동 전후 테이블·sequence와 별도로 모든 role/멤버십·role/database 설정,
schema·함수·trigger·constraint·policy·type·ACL 등의 catalog digest도 대조했다.
물리 통계는 제외했다. 실행 파일·entry·시작 시각·listener 소유권과 검증 receipt를
보존한 뒤 active pointer를 생성했다. 실패 시에는 방금 생성한 ChildProcess
handle만 종료하며 오래된 원본 PID 파일을 사용하지 않는다.

Track 운영 BFF에서19개의 고유 Run·810event, 기존17event의 native cursor/
high-water17을 확인했다. Track의 목록 paging ordinal은 별도 값이며 native
SSE sequence로 해석하지 않는다. 실제 브라우저 decoder로 관리형 child0건·
peer 미구성0건을 대조했다. 기존 Assistant37event·현재 Projects 검토 상태,
공개 익명 API401·Track/Trail Entra redirect·자산6개도 유지했다.

정상 Entra 소유자 화면에서 기존212event·lineage9·도구3개(실패 보고1개)의
6node/7edge·중첩 그룹2개를 확인했다. 그룹 내부 진입·breadcrumb·도구 상세·
typed edge의 출처와 seq를 대조했다. 도구 요청→종료와 실제 실행 시작 미제공을
구별했다. worker가 없으므로 조직화 지원 조회 실패는 숨기지 않았다.

## 남은 단계

1. 원본 소유자의 가동 경로에 고정 API entry·정확한 프로세스 소유권을 반영한다.
2. worker·runtime 파일/설정·외부 workspace 보존과 실행 부수 효과를 별도로
   확인한 뒤 원본 worker·문맥 요약 Web 적용을 진행한다.
3. 실제 managed-child/peer·교차 앱 업무와 두 번째 장치를 대조한다.

이번 재가동의 복귀 기준은 가동 전의 API 미가동이다. 오래된 PID 파일은 다른 프로세스를
가리킬 수 있으므로 사용하지 않는다. 새로 소유한 프로세스의 정확한 identity만
종료하며 기존 Web·DB·worker·tunnel·원장과 schema를 되돌리거나 삭제하지 않는다.
Docker 디스크 수리·초기화는 이 절차의 범위가 아니다.

canary와 API-only 제품 대조는 실제 기존 Run·새 계약의 인가된 빈 응답을 확인한 증거다.
실제 managed-child/peer 생성·교차 앱·두 번째 장치 수용을 충족하지 않으므로
전체 goal은14/21(66.7%,동일 가중치), 예상 산정 불가·신뢰도 낮음으로 유지한다.
