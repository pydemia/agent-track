# Worker 중단 후 상세 Trace 조회 복구

2026-11-15 KST 점검. 전체 수용 조건은 동일 가중치 15/21(71.4%, 부분 0)이다.
전체 완료 예상은 상세 Trace의 운영 연동과 교차 앱 실기에 의존해 산정 불가이며
신뢰도는 낮다. 이 조사는 별도 상위 요구 완료로 집계하지 않는다.

## 실제 장애와 복구

- Track API와 기존 web/gate, Assistant는 가동 중이었으나 기존 Demian API의
  8080과 전용 API의 8081 listener 및 기록된 worker가 종료된 상태였다.
- PostgreSQL은 가동 중이었다. 종료 원인을 입증할 로그는 확보하지 못했다.
  PostgreSQL의 재시작 시각만으로 API 종료 원인을 단정하지 않는다.
- 기존 검증 launcher로 원본 API PID 37260/8080, 전용 조회 API PID 59900/8081을
  복구했다. worker는 시작하지 않았고 새 Run·모델 호출·DB/인증 설정 변경은 없다.
- API 복구 후 서명된 capability·계정·Session 조회는 200이지만 같은 실제 Run의
  metadata/evidence는 직접 API·gate·공개 tunnel 모두 403이었다. Cloudflare나
  로그인 문제로 분류하지 않는다.

## 원인과 수정

고정된 binding·policy·receipt·현재 actor는 유효했다. 다만
`currentPreparedDeployment`가 기존 이력 조회에서도 live inspector를 사용하여
배포 서비스의 90초 heartbeat를 요구했다. heartbeat가 만료된 실제 DB에서
live authority는 불가, history authority는 유효였고 두 settings hash와 저장된
Run pin은 일치했다.

기존 실행 조회·취소는 history inspector를 사용하도록 바꿨다. 현재 서비스
비활성화·authority/설정/소유권 변경은 계속 차단한다. capability와 신규 실행은
명시적으로 live inspector를 사용한다. 독립 리뷰에서 capability의 기본 인자
변경이 readiness를 오표시할 수 있음을 지적했고 이 호출도 수정했다.

소스는 Demian `5a6ed5422c335cb5c03c2f45f5f338b83df98175`이며
`codex/agent-track-worker-intake`에 pydemia 명의로 게시했다.
[고정 patch와 출처](../integrations/demian-offline-history/provenance.json)를 따른다.

## 검증 범위

- 수정 전: 별도 PostgreSQL에서 heartbeat 만료 후 상세 GET 403을 metadata
  역할 유무 두 경우 모두 재현했다.
- 수정 후: Native evidence/metadata/server 통합 60개 통과, 실패·skip 0.
  실제 Assistant signer·gateway 및 successor ACK 복구 검사를 포함한다.
  API와 DB workspace 타입 검사도 통과했다.
- 첫 수정 후 검사에서 서비스 비활성화 fixture가 DB 제약조건을 위반했다.
  `enabled=false`와 `current_authority_id=NULL`을 함께 적용하고 복원하도록
  수정한 뒤 다시 전체 관련 검사를 통과했다. 이 실패를 통과로 소급하지 않는다.
- 실제 DB를 사용하는 별도 임시 API에서 기존 Run
  `60cca68d-95d1-4d99-963a-c2554e0df347`의 metadata/evidence 모두 200.
  첫 페이지 8개 이벤트·모델 선택 1·usage 관측 4·lineage 2·artifact 1,
  다음 페이지 없음이다. usage의 범위를 합산한 수치는 아니다.
- 임시 API 조회 시간은 각각 46/53ms였다. 이는 로컬 API 경계 측정이며
  Assistant/Projects/공개 tunnel을 포함한 Track 전체 지연으로 사용하지 않는다.
- 서명 없는 조회는 403, offline 신규 실행 capability는 false였다.
  새 Run·모델 호출 0. 모든 기존 business row·DDL·sequence·보안 catalog와
  운영 listener를 보존했다. 서명 nonce의 정상 증가만 별도로 검증했다.
- 임시 API·읽기 전용 probe 컨테이너·격리 PostgreSQL과 임시 credential 파일은
  각각 소유 ID로 정리했다. 운영 Assistant와 중지된 승인 후보는 보존했다.

## 남은 작업

현재 운영 전용 API는 아직 이전 `2c113bb`다. 새 API를 별도 동결 후보로 만들고
복구 가능한 API 전환을 검증한 뒤, 승인된 Persona reader와 Track의 실제 상세
Trace·Entra 화면·그룹 탐색을 확인해야 한다. Persona의 이전 예외 승인을 새
source/image 승인으로 확대하지 않는다. 원본 Demian GUI의 별도 인증 확인과
AT-06·09·12·14·15·20의 기존 실기 조건도 남는다.
