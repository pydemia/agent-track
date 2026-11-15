# Agent Track 상세 Trace 수정·배포 현황 — 2026-11-15

이 문서는 [직전 진척 정체 기록](https://note.pydemia.ai/#/w/personal-note-production/page/e9943768-8cd1-4ff1-a9be-f76393920e00)의 후속이다. 개발 변경과 실제 운영 수용을 구분한다.

전체 수용 판정은15/21·71.4%를 유지한다. 상위 요구 동일 가중치·부분0 기준이며 개발 작업량이나 운영 준비도의 비율은 아니다. 남은 요구는AT-06·09·12·14·15·20이고, 전체 ETA를 산정할 근거는 아직 부족하다.

## 이번에 해결한 조회 문제

Persona reader가 explicit attempt의 ref를 얻기 위해 반복하던 원격 조회를 줄였다. 로컬 ref는 접근 권한으로 사용하지 않으며 실제 Native 조회 전후의 현재 Projects 권한 검사는 유지한다. Track은 필수 attempt discovery와 첫 metadata 조회를 병렬로 수행하고 모두 종료된 뒤에만 대기열을 해제한다.

실제 기존 업무의 전체 authority 조회는 window6.9초·evidence4.9초에 통과했다. 이후 SSE와 다른 snapshot 요청이 겹칠 때, 수집기가 로컬 grant를 먼저 지우고 대기 중에 요청 scope가 만료돼404가 발생하는 별도 결함도 재현했다. 선택한 출처의 상세 조회 종료 후 수집 갱신을 수행하도록 수정했다. timeout 확대나 권한 철회 검사 생략은 하지 않았다.

새 producer를 read-only로 연결한 실제 SSE 동시 조회는 HTTP 전체14.4초에 connected를 반환했다. 이벤트8개·선택 모델1·usage 관측4·lineage2·산출물1을 확인했고, 두 SQLite의 쓰기는0이었다. 서로 다른 usage 범위를 합산한 수치가 아니다. 시험 서버와 SSH tunnel을 정리하고 기존 Assistant를 보존했다.

Track 전체1,241개 중1,231통과·실패0·기존skip10, 관련31개·타입 검사·별도 웹 build를 확인했다. Track06dd8c7의 Ubuntu CI는 통과했고, Windows의 기존 PowerShell 프로세스 검사 timeout은 실패 job 한 번 재실행 후 통과했다. 이 결과를 Persona의 실패한 CI와 혼동하지 않는다.

## 운영 전환에서 확인한 사항

Track API 후보와 이전 release를 사본 DB에서 각각 기동해 모든 웹 자산의 bytes·형식과 기존 테이블 보존을 확인했다. 첫 배포 준비는 감사 문서의 공백을 포함한 크기가4MB 입력 제한을 넘어 전환 전에 거절됐다. 같은 내용을 compact JSON으로 보존해 기존 제한을 지켰다.

후속 전환은 보존 목록에 과거부터 들어 있던 별도 Codex 계정 인증 파일의 외부 변경을 감지해 이전 API와 원래 설정으로 자동 복구됐다. 그 파일을 쓰거나 복원하지 않고 Track 배포 관리 범위에서 분리했다. Track·Trail·Demian·Entra 설정 보존 검사는 유지한다. 이 거절을 새 Trace 코드의 결함이나 배포 성공으로 계산하지 않는다.

보존 범위의 독립 검토 후 Track API06dd8c7을 운영 반영했다. web27e00a8은 유지했다. 실제 업무2개의 저장 보기 생성·조회·revision 충돌 거부·정리를 확인했고, 기존 보호 Run과 이벤트8개도 유지했다. 웹 자산18개, 보호 파일47개, 다른 프로세스18개, SQLite integrity와 세 시도 전후의 Track/원본 Native DB 보존을 대조했다. 익명·위조 요청은401이고 공개 Track/Trail의 로그인 redirect도 유지됐다. worker는 중지 상태이며 새 모델 호출은 없다.

이는 Track API 전환의 완료다. 운영 Assistant는 이전 이미지여서 상세 evidence는 여전히forbidden이다. 실제 새 reader의 상세 조회 성공은 앞서 설명한 격리 통합 결과이며 운영 성공으로 바꾸지 않는다.

## 아직 수용 완료로 계산하지 않는 이유

새 Assistant 후보source4a9ad42/image b68ece66은 관련327개·server build·타입·format과 실제 read-only reader 검사를 통과했다. 기존 환경변수·볼륨·네트워크를 유지하는 비활성 후보도 준비했다. 새 모델 요청·권한 부여·writer 활성화는 없다.

그러나 Persona CI는 계정 결제 실패 또는 spending limit으로 모든 job의 step 시작 전에 실패했다. 이전 예외 승인은 다른 source/image에 한정되므로 새 후보에 대한 예외 승인을 요청했다. 답변 전에는 운영 Assistant를 교체하지 않는다.

Edge의 기존 Track 탭을 재검증하려 했으나 제어 연결 timeout과 운영체제 입력 접근 거부가 발생했다. 이전 Entra 로그인 성공 기록을 취소하거나 새 로그인 실패로 해석하지 않는다. 이번 운영 화면 재검증은 미완료다. 상세 Trace의 실제 운영 연결과 같은 업무의 사용자 화면, 남은 요구별 실기까지 확보한 뒤 수용 개수와 ETA를 다시 판단한다.
