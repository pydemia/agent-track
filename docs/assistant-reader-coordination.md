# 보호 실행 reader 지연과 동시 갱신 수정

2026-11-15 실제 완료 업무의 Run을 대상으로 격리 통합 검사를 통과했다.
후속에서는 Track API06dd8c7을 운영 전환했다. Assistant는 교체하지 않았으므로
격리 상세 조회를 운영 성공으로 해석하지 않는다. 상위 수용 판정은15/21로 유지한다.
[운영 근거](assistant-reader-coordination-operating.json)에 구별했다.

## 원인과 변경

원본 reader의 explicit attempt 조회는 같은 coordinator ref를 얻는 과정에서
현재 Projects 권한 조회를 반복했다. Persona4a9ad42는 로컬의 엄격한 attempt
snapshot에서 ref만 얻고, 실제 Native 조회의 전후 Projects 권한 확인은 유지한다.
로컬 ref는 독립된 접근 권한이나 새 HTTP API가 아니다. historical/no-attempt
경로·writer 설정·권한 부여·DB schema는 변경하지 않는다.

Track은 현재 Task 접근 확인 후 initial metadata와 필수 attempt discovery를
함께 읽는다. discovery 성공과 정확히 일치하는 ref가 있어야 응답을 사용하며,
둘 다 종료하기 전에 actor 대기열을 해제하지 않는다. 최종 Native·현재 Projects
확인과 기존10초 authority deadline은 유지한다.

추가로 실제 SSE와 snapshot을 겹치면 수집기가 먼저 로컬 Run grant를 삭제하고,
상세 조회 뒤의 대기열에서 이미 만료된 요청 scope를 사용해404가 발생했다.
선택한 출처의 상세 조회가 끝날 때까지 수집 변경과 새 수집 scope 생성을
미루도록 수정했다. 기존 갱신을 먼저 기다리고, 대기 중인 갱신은 후속 조회보다
먼저 처리한다. 상세 조회 오류에도 gate를 해제하며 현재 owner·Project·credential·
설정 검사는 그대로 수행한다. 다른 출처의 identity 오류는 정상 Run을 막지 않는다.

## 검증 범위

- 수정 전 동시 갱신 회귀 실패, 수정 후 관련31개 통과.
- 전체1,241개 중1,231통과·실패0·기존skip10. 타입 검사와 별도 웹 build 통과.
- 독립 검토에서 발견한 다른 출처 오류 전파를 수정하고 API 회귀 추가.
- Persona4a9ad42 관련327개 통과·실패/skip0, server build·타입·format 통과.
- 실제 기존 DB를 read-only로 연결한 producer와 실제 Projects·Native API를 사용.
  Track 저장소는 메모리이며 운영 설정·원장은 열거나 수정하지 않음.
- 전체 authority의 window6.9초, evidence4.9초. 별도 SSE 동시 갱신 검사는
  HTTP 전체14.4초에 connected 반환. 개별 authority10초와 HTTP 전체 시간은 다름.
- 실제 이벤트8·모델1·usage 관측4·lineage2·산출물1 확인. 서로 다른 usage 범위를
  합산하지 않음. 조회 전후 Track 이벤트 동일, 두 SQLite의 total_changes0.
- 임시 서버와 SSH tunnel 제거, 원래 Assistant 프로세스 보존, 새 모델 호출0.

## 배포 조건

Persona 후보는 source4a9ad4222a749f84c2fc20effab08a019f06872c,
image sha256:b68ece66fde236069699d36612760aeaa49c69b3e175d7b6177f979dfe8af9f0다.
이미지 생성과 격리 reader 검사는 통과했으며 운영 전환은 하지 않았다.
CI43670396041/43670391946은 모든 job이 step 시작 전에 실패했다. GitHub annotation은
계정 결제 실패 또는 spending limit을 명시했다. 로컬 검사를 CI 성공으로 대체하지 않는다.

이전 예외 승인은 source32176e9/image320474c에 한정된다. 새 이미지의 예외 배포는
별도 승인 범위다. 전환 시 현재 프로세스·설정·백업과 복구 대상을 다시 고정하고,
writer 비활성·새 모델 실행 금지·기존 DB 보존을 유지해야 한다. 실제 운영 상세 조회와
인증된 사용자 화면은 배포 후 확인할 조건으로 남는다.
