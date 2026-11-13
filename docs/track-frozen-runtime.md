# Track API·웹 동시 전환

## 목적과 경계

계정별 저장 Flow 보기에는 새 API가 필요하다. 개발 checkout의 `dist/web`를
교체하는 대신 API source·실행 dependency·웹 자산을 같은 release 디렉터리에
동결하고, 해당 디렉터리를 working directory로 사용한다. 기존 API의
`dist/web` 상대 경로는 유지한다. 개발용 build는 `npm run build:check`로 분리한다.

이 작업은 Track product의 loopback14345만 전환한다. 운영 Trail, native Demian
API·웹·DB, 원본 worker와 다른 board/SSH bridge는 재시작하지 않는다. 실제
Projects Task metadata를 읽어 Track 소유의 저장 보기만 생성·조회·revision 충돌·
삭제를 확인하며, 원본 Task·Run 생성이나 모델 실행은 요청하지 않는다.

## 배포 단위

`deploy/track/runtime-release.mjs`는 private `track-runtime.json`의
`releaseDir`·manifest SHA-256을 검증한다. Node executable/version, package
version과 dependency closure, 전체 허용 파일 목록·bytes·link 경계를 확인한다.
유효하지 않은 pointer는 개발 checkout으로 대체하지 않고 시작을 거부한다.
pointer가 아직 없는 기존 설치에만 legacy 경로를 적용한다.

`scripts/Start-Track.ps1 -ProductOnly`는 검증한 release에서 API를 시작하고
실제 CIM identity·listener·runtime receipt를 기록한다. 실패한 자식은 시작할 때
보관한 native handle로 종료한다. `Restart-Track.ps1`도 같은 소유 handle 종료
adapter를 사용한다. bridge 재시작은 product 전환에 포함하지 않는다.

Release는 이 운영 계정이 관리하는 private 파일이다. 파일 hash는 검증 시점의
일치를 확인하며, 같은 OS 계정의 파일 변경이나 Node 환경 override를 차단하는
별도 보안 경계를 제공하지 않는다.

## 상태 보존과 전환 순서

1. 원래 설정 bytes·프로세스 generation·보호 파일·native PostgreSQL 전체 논리
   상태를 기록한다. Track SQLite는 read-only 고정 transaction의 온라인 backup을
   만들고 schema·모든 행·sequence·integrity를 대조한다.
2. 후보와 복구 버전을 각각 별도 backup 복사본으로 cold start한다. HTTP 웹 파일
   bytes/MIME, 기존 테이블·schema, 새 저장 보기 endpoint를 확인하고 자식/포트를
   정리한다. 실제 원본 source나 model은 호출하지 않는다.
3. 고정 source/evidence hash를 포함한 operation input을 만들고 read-only
   preflight를 통과한다. PowerShell driver가 기존 시작 mutex를 같은 프로세스에서
   보관하고 create-only driver identity를 기록한다.
4. 기존 설정에서 명령 사용자 배열 네 종류만 일시적으로 비운다. 미종료 receipt가
   없음을 연속 확인한 뒤 기존 API의 정확한 generation·127.0.0.1 listener를
   확인하고 retained handle로 종료한다.
5. candidate pointer를 create-only 게시하고 product만 시작한다. 웹 전체 bytes/MIME,
   새 endpoint와 보존 상태를 확인한 뒤 원래 설정 bytes를 복원한다.
6. 실제 허용 Task 두 개에 대한 저장 보기 API를 확인한다. 오래된 revision은409,
   임시 보기 삭제 후에는 목록 부재를 확인한다. 성공 marker를 create-only 기록한다.

기존 이벤트·binding history·완료 receipt는 typed bytes로 보존한다. Run/Session
식별자는 고정이며 관측 status와 정상적인 cursor 증가는 허용한다. discovery
message cursor도 int64 단조 증가만 허용한다. 현재 binding 변경은 새 이력의
마지막 payload와 일치해야 한다. 새 schema는 저장 보기 테이블·자동 index만
허용하며 기존 sequence의 감소를 거부한다. 원본 DB를 backup으로 덮어쓰지 않는다.

## 실패와 복구

driver는 후보 실패 시 준비한 복구 release로 pointer를 변경하고 product만
시작한다. 원래 프로세스가 아직 정확히 살아 있으면 유지한다. 알 수 없는
listener나 다른 generation은 종료하지 않는다. 복구 검증 실패와 무관하게
원래 설정 복원을 별도로 시도한다. 성공 marker가 이미 기록됐으면 후속 출력
유실 때문에 정상 후보를 되돌리지 않는다.

동일 operation의 driver는 재실행하지 않는다. 실행 결과 대기/출력 timeout은
실패 판정이 아니므로 실행 handle과 private journal·committed marker를 먼저
확인한다. OS crash·전원 장애의 자동 재개는 구현하지 않았으며, 이 경우 실제
config/pointer/receipt/listener와 journal을 대조해 소유 상태를 확인해야 한다.

## 현재 검증 범위

실제 backup과 두 release의 격리 cold start는 완료했다. 기존11테이블·18웹 파일을
각각 확인했고 후보에만 저장 보기 테이블·index가 추가됐다. 원본 설정·39보호파일·
18프로세스와 native45테이블을 보존했다. activation plan·이력 손상·cursor·binding·
pending 의미 회귀24검사를 통과했다. 배포 driver의 실제 운영 전환과 Entra GUI는
아직 수행 전이다. production 결과는 별도 증거 파일에서 revision과 함께 기록한다.
