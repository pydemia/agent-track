# Demian 배포 전용 worker의 접수·복구 경계

AT-14 운영 실행 연결의 전제 수정이다. 검증한 source의 네 파일만 패치로
보존하며 기존 Demian API·worker·계정 설정에는 아직 배포하지 않았다.

## 수정한 문제

`deploymentServicesFile`이 있고 일반 `configPath`가 없는 worker는 기존에도
배포 전용 상태만 게시했다. 그러나 실행 접수와 만료 복구에는 전체 대기열을
사용했고, `providerAuthRoot`가 있으면 일반 로그인 작업도 가져갈 수 있었다.
Assistant용 worker를 운영 원본 DB에 연결하기 전에 이 경계를 닫아야 한다.

- 모드는 생성 때 고정한다. 배포 전용 worker의 Run 접수는 현재 같은 worker의
  Session binding과 정확한 Run authority가 있는 대상으로 제한한다.
- 기존 capability·만료·prepared Codex·peer·QA 검사를 함께 적용한다. 배포 테이블이
  없으면 일반 Run으로 넘어가지 않는다.
- 만료 복구는 Run 소유 worker·현재 binding·Run authority·선택한 QA 범위의
  교집합이다. lease 삭제에도 lease 소유 worker를 확인한다. 변경할 Run이0개여도
  다른 만료 lease를 삭제하지 않는다.
- 일반 로그인 대기열은 시작하지 않는다. 일반 config를 가진 worker의 기존
  접수/복구 동작은 유지한다. 새 migration은 없다.

## 검증과 적용

[provenance.json](provenance.json)의 baseline·파일 SHA-256을 먼저 대조하고
별도 checkout에서 `git apply --check native.patch`를 사용한다. 새 테스트 파일은
baseline에 없으며 그 외 기존 파일이 다르면 수동 통합·재검증이 필요하다.
이 패치는 광범위한 원본 WIP 전체를 채택하거나 새 runtime 계정 권한을 부여하지 않는다.

별도 tmpfs PostgreSQL에서 실제 migration·claim·복구와 기존 회귀69개를 실행해
69통과·실패0·skip0을 확인했다. 여기에 lifecycle25개가 포함되며 중복 합산하지
않는다. worker/db 타입 검사와 worker bundle build도 통과했다.
[검증 범위와 초기 실패](../../docs/deployment-worker-intake-verification.json)를 따른다.

운영 적용에는 현재 native API/실행 신원 분리, source/worker release와 장기
provider 계정 설정, 최신 DB·설정 backup 및 복구 경계를 별도로 확인해야 한다.
현재의 단일 trusted API 관리자 신원을 위임 service principal로 그대로 지정하면
기존 Track 조회에도 위임 서명이 요구된다. 설정만 켜는 것으로 통합하지 않는다.
이 변경은 전체 WorkCoordinator/Projects/Note/desktop 업무 성공의 증거가 아니다.
