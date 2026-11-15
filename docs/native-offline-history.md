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

## 운영 반영

전용 API를 Native `5a6ed54`의 별도 동결 release로 전환했다. 현재 PID는 83456,
manifest는 `a819b888bdff3b14245506200011f1cc49ba4eeff12b65b6f5c6f7f3b4935cde`다.
Track05ea9b9의 Windows·Ubuntu CI43666756255가 모두 성공으로 종료된 뒤 반영했다.
운영 metadata/evidence는 직접 API와 공개 tunnel에서 각각200·8개 이벤트였다.

전환 전 독립 검토에서 잠금 해제 간격·복구 bytes 고정·잠금 파일 소유권·완료
기록 시점·process 변수 가림 문제를 수정했다. 실제 persistence callback의 수정 전
실패·수정 후 starting/ready 저장과 다른 writer의 변경 후 CAS 거절을 확인했다.
두 잠금은 후보 기동·검증·복구 창 전체에 유지했다. 종료 후 잠금 파일 부재와
현재 PID·13개 설정 파일을 대조했다. 기존 startup helper 자체의 일반적 경쟁
조건을 전역 수정했다고 주장하지 않는다.

전후 DB 대조에서는 worker clock 허용도 끄고 정상 위임 nonce 증가만 허용했다.
모든 business row·DDL·sequence·보안 catalog와 다른 listener를 보존했다.
worker 기동·새 Run·모델 호출·DB 복원·schema/인증 변경은0이다.

동일한 승인 Persona320 이미지의 읽기 전용 구성에서도 실제 producer port의
attempt/metadata/evidence 조회가 성공했다. SQLite 쓰기는0이며 원본 Assistant는
보존했다. 지연은 각각1514/2654/3082ms였고 8개 이벤트·모델 선택1·usage4·lineage2·
artifact1을 확인했다. 이 결과는 HTTP reader와 Track 전체 요청 경계를 대체하지 않는다.
[운영 근거](native-offline-history-operating.json)에 범위를 고정했다.

## 남은 작업

승인된 Persona HTTP reader와 Track의 실제 상세 Trace·Entra 화면·그룹 탐색을
확인해야 한다. Persona의 이전 예외 승인을 새
source/image 승인으로 확대하지 않는다. 원본 Demian GUI의 별도 인증 확인과
AT-06·09·12·14·15·20의 기존 실기 조건도 남는다.
