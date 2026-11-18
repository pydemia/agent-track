# Assistant writer 전환 준비 — 2026-11-18 KST

현재 운영 Persona52cd99c/imageea4a4d31에는 명령 처리 구현이 있지만 writer
config 환경 항목이 없다. Track의 writer credential·principal·허용 사용자도
없다. 보호 업무는 completed Execution r72와 Task r5/in_review다. 현재
인가된 전체 Assistant 목록은 실행1건·후속 page없음이며 재시도/재개 대상은
0건이다. 기존 완료 업무를 양성 명령 검증 대상으로 사용하지 않는다.
private forward의 무인증 writer capability GET은503으로, 현재 비활성
서비스에 도달했다는 근거이며 writer 인증 성공을 뜻하지 않는다.

## 구현·검증한 범위

`deploy/assistant/native_clone.py`에 같은 이미지의 명시적 writer 설정만
추가하는 순수 생성·검증 함수를 구현했다. 기존 이미지/source stamp를
그대로 요구하며 환경 항목1개와 별도 readonly/NoCopy volume1개만 허용한다.
기존 설정과 중복·부모/자식 경로의 mount shadowing·volume 재사용은 거절한다.
새 mount를 분리한 뒤 기존 image clone 검증으로 나머지 모든 값을 대조한다.

새8개 검사는 구현 전 함수 부재로 실패했고 구현 후 통과했다. 기존 native
전환·복구 검사를 포함한 Python61개도 통과했다. 이 검사는 합성 데이터이며
실제 writer grant·서비스 인증·provider 실행을 확인한 결과가 아니다.

실제 운영 컨테이너의 Docker inspect를 읽기 전용으로 입력해 새 요청을
구성했다. 현재 이미지/source와 기존13mount를 보존하고 원본 입력을 변경하지
않음을 확인했다. 반환된 민감 요청은 출력하거나 저장하지 않았다.

별도 Docker QA에서는 현재 이미지를 쓰는 network=none·readonly root의
비기동 기준/후보 컨테이너를 생성했다. 새 mount가 실제 daemon의 Mode=z·
RW=false·NoCopy로 나타나고 전체 clone 검증을 통과했다. 앱은 시작하지
않았으며 운영 state·credential을 mount하지 않았다. 소유권·미기동을 확인한
두 컨테이너와 새 volume1개를 정리했고 운영 PID·설정·mount·network 보존을
재확인했다. 이 결과를 전체 앱 기동이나 운영 writer 활성화로 부르지 않는다.

## 다음 운영 구성안

| 구성 | 구체적 범위 | 현재 상태 |
| --- | --- | --- |
| 대상 업무 | 별도 `Agent Track 명령 복구 QA` 업무의 실행1건. 완료된 기존 보호 업무·사용자 산출물은 제외 | 새 테스트 실행·현재 역할·attempt·Task 연결을 먼저 확정해야 함 |
| writer principal | `agent-track-command` audience의 reader와 다른 전용 principal | 미생성 |
| provider grant | 기존 불변 owner·현재 Entra 사용자, `projectIds: []`, 확정된 테스트 `executionIds`1개, revision1, 활성화 시점부터2시간 | 범위·기한이 있는 별도 실행 권한이며 이전 image-only 승인 범위와 구별 |
| 파일·전달 | 별도 writer volume의 `grant.json`·`writer.key`, 기존 private forward, Track의 전용 credential 파일 | volume·secret 미생성. reader/proxy credential 재사용 금지 |
| Track 설정 | Assistant v2 source에 `assistantCommandCredentialFile`·`assistantCommandPrincipalId`·단일 `assistantCommandUsers`를 함께 지정 | 현재 세 항목 모두 미설정 |
| 전송·복구 | 검토 고정→명시적 단일 전송→같은 operationId GET 복구. intent 저장·Demian 접수·후속 Run·실행 결과를 구별 | 합성 HTTP/SQLite 근거는 기존 구현에 있음. 실제 provider/owner 검증은 미수행 |
| 종료 | 새 전송 허용 사용자 제거, 테스트 grant 비활성화. 기존 receipt·미확정 원장을 보존 | 운영 절차와 현재 권한으로 계획·검증 필요. 기록 삭제나 새 ID 재전송으로 복구하지 않음 |

grant의 기술적 범위는 한 Execution과2시간이다. 서버 grant 계약 자체에
명령 횟수 한도 필드는 없으며, 실행 횟수 제한을 grant가 강제한다고 표현하지
않는다. 테스트의 전송 횟수·후속 Run과 모델 호출은 실제 원장으로 대조한다.
일반 원본 Demian API8080의 command-context404와 writer 권한은 별도의
제공자 경계이며 이 변경으로 원본 runtime·DB·인증을 바꾸지 않는다.

현재 변경은 배포 준비 구현이다. 새 service credential·grant·테스트 업무를
만들거나 writer·worker를 활성화하지 않았으며 운영 명령 전송은0건이다.
새 테스트 실행·허용된 runtime 경로와 writer 범위가 확정돼야 실제 전환·
명령 검증을 진행할 수 있다. 상위 수용15/21과 AT-09 부분 판정을 유지한다.

[구현·실제 Docker 검사 근거](assistant-writer-clone-verification.json),
[기존 명령·권한 경계](command-boundary-after-reboot-20261118.json),
[조정자 명령 계약](coordinator-command-controls.md)을 따른다.
