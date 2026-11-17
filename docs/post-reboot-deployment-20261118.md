# 서버 재기동 후 배포·진척 재점검 — 2026-11-18 KST

서버 연결 복구 후 승인된 두 변경을 운영에 반영했다. Persona는 source52cd99c / imageea4a4d31,
Track은 API047b4d6를 유지하고 webc52b49d로 전환했다. 보호 업무의 반복 API 조회15개가
모두200이었고 Persona 반영 후90초30개, Track 웹 반영 후5분100개 SSE 표본 모두
connected·동일 Run 표시를 유지했다. 이 결과는 이번 관측 구간의 안정성 증거다.
과거503의 원인은 미확정이며 계측 추가나 재기동을 원인 수정으로 단정하지 않는다.

| 항목 | 이번에 완료한 결과 | 남은 한계 |
| --- | --- | --- |
| Persona | Linux 전체 build·타입 검사,1,349개 중1,340통과/실패0/제외9. 배포 이미지의 컴파일752파일이 검사 산출물과 일치. 운영 전환·현재 데이터·기동 adoption 확인 | CI44001892036은 결제/한도로 시작 전 실패. 승인된 예외 배포이며 CI 성공으로 바꾸지 않음 |
| Track | 전체1,285개 중1,274통과/실패0/제외11, Windows/Ubuntu CI 성공. 현재 운영 DB backup·동결 후보/이전 버전 cold QA, 검토된 전환 도구의 commit·보존 확인 | 합성 Edge의 단절/복구/철회 검사는 실제 Entra GUI 수용과 구별 |
| 보호 업무 | 같은 Execution·이벤트8개·metadata hash·역사 binding r3 보존. 실제 모델1개·usage4개·lineage seq4,5·산출물1개·timing2개 재조회 | 원본이 제공하지 않는 step/tool ID는 unknown으로 유지. Task는 현재r5/in_review이며 완료로 승격하지 않음 |
| 사용자 화면 | 이전 실기에서 동일 업무의4nodes/3edges/3groups와 Native edge 상세를 확인. 이번 선택 복구 로직은 컴파일된 격리 UI로 검증 | 현재 Edge 창 활성화가 두 차례 실패해 최신 운영 선택/Trace 실기 대기. 제품 로그인 실패로 판정하지 않음 |

진척이 제자리로 보인 데에는 서로 다른 이유가 있었다.15/21·71.4%는 상위 요구 전체를
수용한 비율이라 부분 구현·성능 수정·배포가 수치에 반영되지 않았다. 실제로 보호 업무가
간헐적으로 끊겨 통합 수용을 올릴 수도 없었다. 이어 Linux 서버 SSH와 두 Tunnel이 끊겨
승인된 이미지 결과 확인·배포가 멈췄다. 과거 상태를 현재처럼 적은 보고 오류도 바로잡았다.
이번 서버 재기동 후 연결과 두 배포는 완료했고 API/SSE 안정성 하위 조건은 통과했다.
상위 수용15/21을 유지하되 완료한 하위 조건을 별도로 기록한다.

재기동 뒤 이전 빌드 PID/start tick과 결과가 없음을 확인하고 새 작업으로 빌드했다.
관측 timeout만으로 기존 빌드를 중복 실행하지 않았다. 이전 서버 단절·빌드 종료 원인은
확정하지 않았다. 운영 전 Work45,719,552B·Runtime5,203,685,376B를 읽기 전용으로
암호화 backup하고 해독·byte SHA·row·integrity를 검증했다. 첫 시도는 여러900초 단계에
총 제한도900초여서 복원 관측 중 끝났다. 새 시도는 총 제한을3,600초로 맞췄으며 각 단계
제한과 Native API timeout은 유지했다. 정상 암호화 backup은 보존하고 실패 사본·QA
평문 볼륨은 소유권과 참조를 확인한 뒤 정리했다. 운영 DB·credential을 복원하지 않았다.

Persona의 다른13개 구성 요소와 Work33/Runtime65테이블 DDL, 발행 pin을 보존했다.
Runtime의 알려진 시작 시 Task revision3개·UI event6개는 전체 payload와 역산을 대조했다.
Track 설정47개·다른 프로세스14개·기존 이력과 Native PostgreSQL46테이블을 보존했다.
복구 경로 사전 검사와 사본의 이전 binary 기동을 실제 운영 rollback 실기로 부르지 않는다.
운영 AgentTrail, 원본 Demian 인증·runtime·DB는 변경하지 않았고 writer·worker를 새로
활성화하지 않았다. 새 모델 실행·원본 업무 명령도0건이다. 기본 Entra 인증은 유지했다.

남은 상위 요구는 AT-06/09/12/14/15/20이다. 다음 작업은 같은 보호 업무의 실제 화면
선택·그룹/Trace 재검토, 기존 명령 capability·routing 확인, peer 대표선 선택과 여러 장치
기본 목록/필터 해제, 원본 Demian Session·문맥 이동 및 장애 격리다. 별도 desktop 앱,
불필요한 재로그인·추가 실행을 새 수용 조건으로 만들지 않는다. 실제 명령과 같은 ID 복구는
쓰기 권한 범위와 제공자 계약이 갖춰진 경로에서 검증해야 하며 이미지 배포 승인으로
권한을 확대하지 않는다. 전체 완료 시점은 아직 산정할 수 없다.

[정확한 배포·반복 검증 근거](https://github.com/pydemia/agent-track/blob/main/docs/post-reboot-deployment-verification-20261118.json),
[현재 수용표](https://github.com/pydemia/agent-track/blob/main/docs/goal-status.md),
[Persona draft PR24](https://github.com/pydemia/persona/pull/24)를 함께 따른다.
[직전 Note](https://note.pydemia.ai/#/w/personal-note-production/page/4037a1c3-f092-41d5-90fc-545a92d091f0)의
본문·hash·기록은 유지하며 이 후속 보고를 별도 페이지로 발행한다.
