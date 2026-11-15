# Assistant 전체 앱의 사본 기동·롤백 검증 — 2026-11-15

이 문서는 [직전 조회 수정·배포 기록](https://note.pydemia.ai/#/w/personal-note-production/page/d855e98b-3197-4440-bbd9-b2b7fc44e886)의 후속이다.

새 Assistant source4a9ad42/image b68ece66과 이전 운영 image de1b1f1e를 같은
격리 사본에서 차례로 기동했다. 양쪽의 health와 기존 reader 인증은200,
익명 요청은401을 반환했다. 새 이미지에서 역할 시도 이력 지원을 확인했다.
이는 [앞선 실제 reader 연동](assistant-reader-coordination.md)에 더한 전체
앱의 사본 검증이며 운영 Assistant 전환이나 사용자 화면 수용 완료는 아니다.
[실행 근거](assistant-reader-app-preview.json)에 이미지·작업 ID·검사 코드 해시를 고정했다.

## 입력과 보존 경계

11월14일에 생성·검증했던 암호화 백업을 새 소유 볼륨으로 복원했다. 기존
평문 preview 볼륨이 사라진 사실을 확인한 뒤, 남아 있는 암호화 백업을 사용했다.
현재 운영 DB의 새 백업을 만들거나 운영 볼륨에 복원하지 않았다. 따라서 현재
운영 데이터와의 동등성을 주장하지 않는다.

Work45.7MB·Runtime5.2GB의 복원본은 암호문·평문 해시와 백업 원장의 typed
measurement, 고정한 이전 기준의 schema·행별 typed hash·SQLite 무결성 검사를
통과했다. 실행 대기/진행 중 Task·Execution·Report·Import는0이었다.

전체 앱은 기존 설정·인증·마운트를 읽기 전용으로 유지하고 `/state`만 이 사본으로
바꿨다. 새 credential이나 권한을 추가하지 않았다. 네트워크는none, 공개 port는0이며
원본 state와 worker cgroup을 연결하지 않았다. 이벤트 검사 helper는 사본 state와
검사 코드만 읽기 전용으로 연결했다. 이 helper에는 설정·credential을 연결하지 않았다.

## 새 이미지와 이전 이미지에서 확인한 결과

| 검사 | 새 이미지 | 이전 이미지 |
| --- | --- | --- |
| 실제 앱 health | 200 | 200 |
| 기존 machine reader / 익명 | 200 / 401 | 200 / 401 |
| reader 제어 활성화 | false | false |
| 신규 schema | source와 일치하는 빈 테이블3개 | 추가 변경0, 새 테이블 보존 |
| Work 업무 행 변경 | 0 | 0 |
| Runtime 시작 처리 | 기존 Task3개 revision·시각, 이벤트6개 | 같은 제한의 후속 시작 처리 |
| 시작 이벤트 전체 payload | 6개 일치 | 6개 일치 |

Runtime 변경은 Task3개의 revision·updatedAt과 연속된 message.saved/task.updated
6개, 해당 sequence 증가에 한정했다. 이를 역산한 해시가 모든 기존 행·메시지·이벤트
prefix와 일치해야 통과한다. lease4개 테이블은 운영 조정 상태로 별도 구분했다.
새 명령 테이블과 successor plan은 비어 있다. writer를 켜거나 모델을 호출하지 않았다.

payload는 앱을 중지한 사본에서 각 이미지의 실제 serializer를 불러와 모든 필드를
비교했다. 예상 이벤트 수0/6을 호출자가 명시하며 개수와 전체 일치 수를 모두 확인한다.
각 이미지 안에서는 하나의 현재 시각을 사용했다. 두 이미지의 관련 serializer source는
동일하다. 원래 이벤트 생성 시각의 외부 권한 상태를 재현했다는 뜻은 아니다.

서비스 연결 정보가 없다는 초기 검사 가정은 실제 사본에 맞지 않았다. 최종 검사는
실제 taskContextAvailable 함수에 외부 gate를 모두 허용해도 문맥을 사용할 수 없음을
확인하고, 허용/거부 두 callback의 전체 message/task 결과가 같은지 대조한다.
실제 앱 함수의 반환 동작을 확인한 것이며 원천 문맥이 불가한 이유를 독립 감사한
결과는 아니다. 외부 정책이나 운영 인가를 변경하지 않았다.

## 검증 절차에서 수정한 결함과 종료 상태

초기 helper의 chown/chmod 순서가 제한된 capability와 맞지 않아 복원 전에 중단됐다.
순서를 수정한 뒤에는 SQLite 객체의 null prototype과 JSON 객체를 strict 비교한
검사 코드가 실패했다. 데이터는 동일했으며 JSON 표현으로 맞춘 전체 비교는 통과하고
실제 값 변경은 거절되는 회귀 사례를 확인했다. 두 실패를 앱 결함이나 성공으로 세지 않는다.

첫 전체 기동 작업은 payload 검사의 잘못된 연결 정보 가정으로 종료됐다. 해당 작업의
중지·정리와 사본 검증 결과를 고정한 뒤, 후속 작업에서 같은 사본의 전체 해시를 다시
대조하고 payload 검사와 이전 이미지 기동을 이어갔다. 실패한 복원이나 새 기동을
무조건 반복하지 않았다.

최종 두 작업의 소유 컨테이너는 각각5개씩 정리됐고 pending ID·name은0이다.
사본 볼륨은 감사용으로 남겼다. 보호 대상13개 프로세스와 계약은 이전 기준과 일치하며,
운영 Assistant와 비활성 배포 후보는 그대로다. 운영 볼륨을 삭제하지 않았다.

## 남은 수용 조건

새 이미지에 대한 CI 예외 승인 요청은 답변 대기 상태다. 기존 Persona CI의 step 시작 전
실패를 성공으로 바꾸거나 이전 이미지의 승인을 새 이미지로 확대하지 않는다.
운영 Assistant 전환, 현재 실제 업무의 상세 Trace와 동시 SSE, 인증된 사용자 화면은
별도 검증해야 한다. Edge에는 Track의 Entra 로그인 화면을 다시 열었으며 사용자
Authenticator 승인을 기다린다.

전체 수용은15/21·71.4%, 상위 동일 가중치·부분0을 유지한다. 새 사본 검증을 상위
요구의 운영 수용으로 계산하지 않는다. 전체 ETA는 산정하지 않는다.
