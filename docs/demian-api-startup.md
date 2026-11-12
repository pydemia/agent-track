# Demian API 전용 로그온 시작

기준: 2026-11-12 KST. 원본 API-only 복구의 후속이다. API8080은 기존 frozen
bundle과 격리 runtime-home·owner token·PostgreSQL 설정을 유지한다. 기존 Web,
Basic gate, worker, Docker, provider OAuth와 optional runtime은 이 launcher의
시작 대상이 아니다. Track·Trail의 기본 인증은 Entra ID를 유지한다.

## 구성과 재사용

`scripts/Install-DemianApiStartup.ps1 -PrepareOnly`는 private state root에 코드
해시로 구분한 고정 operator와 profile을 준비하고 현재 API를 읽기 전용으로
대조한다. 현재 실제 API PID15940을 새로 띄우지 않고 재사용한 결과를 확인했다.

profile은 실행 계정 SID, Node executable/hash, API entry/hash, operator 6개
파일의 hash와 원래 service/secrets JSON의 hash를 고정한다. Operator와 profile에
비밀값을 저장하지 않는다. 원래 secrets 파일은 hash·형식 검증을 위해 읽고,
child를 만들 때 원래 값을 환경에 전달한다. Node·credential·설정이 바뀌면
자동으로 새 설정을 신뢰하지 않고 재검토할 수 있도록 중단한다.

`deploy/demian/Start-Api.ps1`은 현재 계정과 고정 파일을 확인한 뒤 OS의
FileShare.None 잠금을 유지하며 `start-api.mjs`를 실행한다. 디스크에 남은 lock
파일만으로 실행 중이라 판단하지 않는다. OS 공유 잠금은 종료·중단 때 해제된다.

- 기록된 PID·exe·생성 시각·정확한 단일 entry command와 loopback listener를
  대조한다. DB 검사·HTTP readiness 뒤에도 현재 process/listener를 다시 확인한다.
- 같은 API가 있으면 재사용한다. 다른 listener나 아직 listen하지 않은 동일 API가
  있으면 그대로 보존하고 중단한다. PID가 재사용됐더라도 그 프로세스를 종료하지 않는다.
- 포트가 비었을 때만 원래 DB의 container ID·image·volume·127.0.0.1:11931을
  확인하고 최대 60초 기다린다. Docker를 시작·재시작하거나 volume을 복원하지 않는다.
- 새 API는 원래 runtime-home과 allowlist한 환경으로 실행한다. Host의 worker·
  peer·deployment·NODE_OPTIONS를 상속하지 않는다. 전역 HOME·OAuth를 변경하지 않는다.
- 새 child의 준비·현재 profile·listener를 재확인하고 process record 게시가
  성공할 때까지 보유한 ChildProcess handle로 정리 책임을 유지한다.

## 중단에 견디는 process record

`write-api-record.ps1`은 stable sharing lock 아래 예상 SHA-256을 대조하고,
같은 volume의 새 파일을 flush한 다음 File.Replace로 게시한다. 이전 완전한
record는 해당 시도의 private payload 옆에 보존한다. 기존 active 파일을 제자리에서
truncate하지 않는다. 중단 후 남은 staged 파일을 활성 record로 채택하지 않는다.

이 CAS lock은 이 API record writer 사이의 동시 변경을 직렬화한다. 파일을
수동으로 바꾸는 외부 도구는 같은 lock을 사용해야 하며 임의 수정과의 원자적
충돌 해결을 보장하지 않는다. private state와 operator에 쓰기 권한이 있는
사용자를 별도의 보안 경계로 격리하는 기능도 아니다.

## 로그온 작업과 한계

검증한 준비 profile을 `-RegisterPrepared`로 등록한다. 현재 사용자 SID의
Interactive/Limited 로그온 작업이며 사용자명·패스워드 로그인을 만들거나 암호를
저장하지 않는다. IgnoreNew와 파일 공유 잠금으로 중복 시작을 막는다. Docker가
늦게 준비되면 실패 후 1분 간격 최대 3회 재시도한다. 원본 API를 정기 재시작하는
감시자는 아니며 재부팅 자체를 이 단계의 검증으로 대신하지 않는다.

현재 user logon task를 등록하고 실제 실행 결과0·기존 PID15940 재사용을 확인했다.
등록 전후 전체 DB/보안 catalog·설정 8개·process 신원과 container의 image·mount·
시작 시각을 대조했다. `demian-api-startup-verification.json`에 기록한다. 분리
Windows fixture의 cold-start와 실제 native DB에 대한 cold-start를 구분한다.
원본 API를 종료해서 재기동하거나 PC를 재부팅하는 시험은 수행하지 않는다.

회귀 검사는 공백 유무가 다른 exe/entry, PID 재사용/외부 listener, 준비 후 권한
확인 중 listener 교체, 실패 시 신규 child 정리, writer 강제 종료 전후의 완전한
JSON·재시도, 원래 DB identity와 credential/config 변경 거부를 포함한다.
Worker/managed-child/peer·교차 앱 실행과 원본 Web 문맥 요약은 후속이며 전체
goal은 동일 가중치 14/21(66.7%)을 유지한다. 완료 예상 산정 불가·신뢰도 낮음이다.
