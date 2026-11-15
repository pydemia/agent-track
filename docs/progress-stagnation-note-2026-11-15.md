# Agent Track 진척 정체 원인 — 2026년 11월 15일 후속

이 문서는 [11월 14일 원인 기록](https://note.pydemia.ai/#/w/personal-note-production/page/20f30102-e3ea-4290-86a4-c8268c1827ca)의 후속이다. 실제 운영 확인과 현재 실패를 구분한다. 전체 goal은 계속 진행 중이다.

## 현재 판단

전체 수용 집계는 **15/21·71.4%**다. 상위 요구를 동일 가중치로 세고 부분 충족은0으로 계산한다. 이 수치를 개발 작업량·운영 준비도·남은 시간의 추정치로 사용하지 않는다. 기존 완료15개도 각 기록의 누적 증거이며 이번에 모두 다시 검사한 결과는 아니다.

진척 정체는 표시 문제만으로 설명되지 않는다. 실제 업무의 실행·Projects 결과·Note 참조와 Track 기본 관측은 연결했지만, 사용자가 요구한 상세 Trace를 배포된 화면에서 안정적으로 읽는 조건은 아직 닫히지 않았다. 개별 API·reader의 성공을 여러 서비스가 이어진 전체 요청의 성공과 구분해야 했다.

## 이번에 실제로 해결한 문제

재개 시점에 원본 Demian API/전용 API와 worker가 종료돼 있었다. PostgreSQL과 기존 web/gate·Track·Assistant는 가동 중이었다. 정확한 종료 원인은 확인하지 못했다. 기존 검증 launcher로 두 API의 조회 경로를 복구했고 worker는 시작하지 않았다.

API 복구 후 특정 Run의 metadata/evidence는 API 직접 호출에서도403이었다. 현재 binding·policy·actor·receipt는 유효했으나, 과거 이력 조회가 배포 서비스의90초 heartbeat를 요구했다. worker가 멈춘 사실을 권한 철회와 혼동한 결함이었다.

이를 수정한 Native5a6ed54를 별도 동결 release로 운영 전환했다. 현재 권한·서비스 비활성화·설정/authority 고정값 검사는 유지하고, 신규 실행 readiness는 계속 live worker를 요구한다. 관련 PostgreSQL 검사60개가 모두 통과했고, 기존 실제 Run의 metadata/evidence는 API 직접 경로와 공개 tunnel에서 모두200이었다. 원장·DDL·sequence·보안 catalog·인증 설정과 다른 서비스 프로세스를 보존했다. 새 Run·모델 호출·schema 변경·DB 복원은0이었다.

## 아직 상세 Trace가 완료되지 않은 이유

동일한 승인 Assistant 이미지의 읽기 전용 producer와 실제 HTTP reader도 성공했다. 실제 Run에서 이벤트8개·모델 선택1건·usage 관측4건·lineage2건·artifact1건을 확인했다. usage 관측의 서로 다른 범위를 합산한 수치는 아니다. 인증 없는 요청은401이었다.

그러나 같은 reader를 현재 Track 코드·실제 Projects 권한 검사와 연결한 격리 전체 요청은10초 deadline을 넘었다. 실제 측정에서 역할 시도 조회1313ms, 첫 native metadata HTTP5690ms 뒤 최종 재검사가 제한 시간에 걸렸다. 같은 현재 역할과 Projects 입력을 HTTP reader와 coordinator가 중복해서 확인하는 구조가 남아 있었다.

운영 Assistant는 이 실패를 성공으로 간주해 교체하지 않았다. 시험 서버·SSH 연결·임시 컨테이너는 정리했고 SQLite 쓰기0과 기존 Assistant 보존을 확인했다. timeout 증가나 철회 검사 생략으로 해결하지 않는다.

## 다음 구현과 수용 확인

현재 수정 범위는 coordinator가 이미 검증하는 선택 attempt의 로컬 identity를 reader에 전달하여 중복 원격 조회를 줄이는 것이다. 실제 Native 조회 전후의 Projects/Note 접근, 현재 membership·binding·서명키·reader credential 철회 검사는 유지한다. 과거 시도가 현재 시도와 바뀌어도 같은 Run의 고정된 식별자를 확인해야 한다.

수정 후에는 같은 실제 Task/Execution/Run의 전체 Track 요청과 동시 SSE 갱신, Edge의 Entra 로그인 화면에서 상세 Trace·그룹 내부/외부 탐색을 확인한다. 개별 reader 성공이나 합성 fixture를 이 수용 조건 대신 사용하지 않는다. 원본 Demian GUI의 인증 확인과 AT-06·09·12·14·15·20의 나머지 실기도 남아 있다.

전체 완료 예상은 아직 산정할 근거가 부족하고 신뢰도는 낮다. 다음 재산정 시점은 수정된 reader가 같은 실제 업무의 전체 Track 요청과 운영 화면을 통과한 뒤다. 기존 목표나21개 분모를 줄여 완료로 처리하지 않는다.
