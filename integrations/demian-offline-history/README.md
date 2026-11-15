# Worker 중단 후 보호 실행 이력 조회

`native.patch`는 Demian `2c113bb34fe120345d9e617524c8d41df2bbd4c6`에
`git apply --unidiff-zero`로 적용한다. 정확한 대상 tree와 파일별 해시는
[provenance.json](provenance.json)에 고정했다.

배포 서비스 heartbeat 만료는 신규 실행 readiness를 해제하지만 현재 권한이
유효한 과거 Run의 상세·metadata·evidence·취소를 철회하지 않는다. 기존 history
inspector로 현재 서비스 활성화·authority·membership·Session 설정과 저장된
Run settings hash를 검증한다. capability와 신규 admission은 live 검사를 유지한다.
DB schema·원장·인증 정보·일반 사용자 실행 계약은 바꾸지 않는다.

격리 PostgreSQL 60개 검사와 기존 실제 Run의 임시 API 조회를 구분한다.
임시 API의 실제 증거 조회 성공은 운영 API/Assistant/Track 전체 전환 성공을
뜻하지 않는다. 운영 상태는 [조사 기록](../../docs/native-offline-history.md)을 따른다.
