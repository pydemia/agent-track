# Agent Track 일반 Native Trace 복구와 보호 업무 잔여 — 2026-11-17

일반 Demian 실행의 Trace 근거 조회가 무관한 보호 Assistant 수집 실패에 묶이던
문제를 수정하고 운영에 반영했다. Edge의 기존 Entra 계정에서 실제 Run의 모델
요청·lineage·산출물과 그룹, 모델 요청 edge의 상세를 확인했다. 보호 Assistant
업무의 반복 가용성과 조직화 지원 조회 실패는 해결되지 않았다.

## 관측한 문제와 수정

일반 Native Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c`의 모델 요청 조회는
수정 전 15,005ms에 timeout이었다. 원본 Run과 무관한 보호 Assistant source까지
권한 갱신과 snapshot 투영에 포함돼, 일반 실행의 개별 근거도 실패했다.

현재 Store가 보유한 Run의 source와 현재 사용자 접근을 대조해 일반 Native
조회만 범위를 줄였다. 현재 Projects grant view는 함께 유지한다. 보호·미확인
source와 일반 대시보드는 기존 전체 검사를 유지한다. 파일·조직화·모델 요청·
lineage·산출물·관리형 세션 관계의 각 조회에서 현재 권한과 원본을 다시 확인한다.
권한 철회·원본 거부·사용자 변경을 오래된 cache나 연결선으로 덮지 않는다.

[주요 수정 bd78238](https://github.com/pydemia/agent-track/commit/bd78238551a502da863a2dbddc01a8417d471d2d)에서
시작했고, 초기 양 OS CI의 file-api 회귀를 확인했다. 정적 config 목록 대신
현재 신뢰하는 Projects view를 유지하도록
[최종 수정 e3581c7](https://github.com/pydemia/agent-track/commit/e3581c735629eaca45d3ea66028f86ffa2807011)에서
보완했다. 초기 CI 실패를 최종 성공과 구별한다.

## 실제 운영 API와 화면

현재 API는 `e3581c735629eaca45d3ea66028f86ffa2807011`, 웹은 기존 동결
`474676f66f276fafd00c9325e3bfcfb2f30bd78b`다. 전환 operation은
`f331b930-ed6e-4c30-8245-5227e6d6dd03`이다.

| 실제 조회 | 상태 | 소요 | 관측 |
| --- | --- | --- | --- |
| 모델 요청 | connected | 302ms | 1개 |
| lineage | connected | 253ms | 2개 |
| 관리형 child 관계 | connected | 202ms | 0개 |
| 조직화 지원 | disconnected | 229ms | 해결 안 됨 |
| 산출물 | connected | 233ms | 1개 |
| 파일 근거 | connected | 201ms | 조회 연결 |

HTTP 200만으로 조직화 지원을 성공 처리하지 않는다. 모델 요청은 시작 1건만
관측했고 종료는 미확인이다. 요청 모델 `gpt-6.1-sol`은 실제 응답 모델의 증거가
아니다. Run 성공 종료와 모델 요청 종료·Task 수용도 서로 다른 상태다.

11월17일 01:12 KST Edge에서 `pydemia@pydemia.ai` 로그인과 같은 Run의 정규
이벤트 17건, lineage 2개, Run 그룹 안의 Run·모델 요청·산출물 3nodes/2edges를
확인했다. 모델 요청 관계를 선택하면 출발 Run, 도착 모델 요청, 관계 종류
`model-request`, source `demian-local`, 근거 seq4가 표시됐다. 화면의 조직화 지원
조회 실패도 함께 확인했다. 저장한 viewport 캡처는 상단 로그인·Trace 문맥이며,
화면 아래 edge inspector의 시각적 캡처로 주장하지 않는다. 상세는 접근성 트리와
실제 선택 상태로 확인했다.

## 검사와 보존

관련 로컬 검사 17개와 타입 검사가 통과했다.
[최종 source CI 43894599208](https://github.com/pydemia/agent-track/actions/runs/43894599208)는
Windows 1,281개 중 1,270개 통과·실패0·환경 제외11개, Ubuntu 1,281개 중
1,256개 통과·실패0·환경 제외25개다. 현재 Project 철회와 원본 거부, 보호 source
분리, 대시보드의 다른 출처 유지, 경로별 원본 재확인을 회귀 검사했다.

독립 정적 검토는 `69a2e06→bd78238`에서 필수 수정 지적0개였다. 최종 `e3581c7`의
Projects view 호환성 변경은 부모가 검토하고 CI로 확인했다. 독립 검토가 최종
revision 전체를 실행 검증했다고 주장하지 않는다.

동결 전환 후 웹18개 파일·MIME/hash, 설정47개와 다른 프로세스18개, Track 전체
이력·저장 보기1개·SQLite 무결성, 원본 Native46개 테이블 보존을 확인했다.
원본 보호 Run의 이벤트8개 전체 metadata SHA와 역사 binding r3·cursor8도 유지됐다.
무인증·위조 인증은401, 공개 Track/Trail은 로그인302를 유지한다. 원본 업무 DB나
인증 복원·새 provider Run·credential·worker 시작은 수행하지 않았고 writer는 비활성이다.

## 진척률이 그대로인 이유와 다음 경계

상위 수용은 **15/21·71.4%, 직전 대비0%p**다. 동일 가중치·부분0을 유지하며
필수 하위 결과의 전체 분모는 아직 미확정이다. 일반 Trace 복구는 실제 진전이지만
AT-06/09/12/14/15/20 전체 완료를 대신하지 않는다.

앞선 일반 문맥 부하 제거 뒤 보호 업무를 실제 순차 API로 재측정했다. 기존
UI/background client가 켜진 상태여서 조용한 격리 성능 검사로 해석하지 않는다.
1차에는 snapshot·events·evidence가 성공했고 원본8events를 확인했다. 2차에는
snapshot이 disconnected로 Run을 숨겼고 evidence는15,015ms에 timeout이었다.
해당 보호 수집 trace는 queue0·입장 예산10초에서 Projects 확인 약1.08초,
첫 nativeMetadata 약4.66초 뒤 두 번째 원본 확인이 deadline에 끝나지 않았다.
AT-14의 반복 안정성을 수용하지 않는다. 이 재측정은 일반 Trace 수정 전 APIcd73f09에서
수행했으며, 일반 Trace 성공을 보호 업무의 사후 성공으로 바꿔 기록하지 않는다.

운영 Persona는 승인된 source4a9ad42/imageb68ece66이다. 더 빠른 사설 Projects GET
transport 후보 source90e0825/image33e19141은 별도 후보이며 CI가 결제/한도 때문에
실행 전 실패했다. 기존 예외 승인을 새 후보에 확대하지 않는다. 정확한 후보의
승인과 별도 운영 전환·원본 보존·동일 보호 업무의 반복 검증이 남는다.

peer QA API와 credential은11월13일 제거됐고 현재 실제 보관본만 확인했다.
보관본을 현재 인가된 다중 장치 연결로 대신하지 않는다. 원본 Demian Session 인증,
실제 peer 경계, 명령·복구의 운영 수용, 보호 업무 반복 안정성도 남는다.
전체 완료 ETA는 현재 산정할 수 없다.

[기계 판독 검증 기록](https://github.com/pydemia/agent-track/blob/main/docs/ordinary-evidence-scoped-reads-verification.json)과
[전체 수용표](https://github.com/pydemia/agent-track/blob/main/docs/goal-status.md)에 연결한다.
