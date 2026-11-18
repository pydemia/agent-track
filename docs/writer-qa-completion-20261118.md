# Agent Track 명령 복구·QA 완료 보고 — 2026-11-18

기존 상위 수용 조건 21개를 모두 확인했습니다. 마지막 AT-09는 같은 QA Execution에서 원본 미접수 확정 → 재시도 → 실제 Run 취소 → 재개 → 결과 게시까지 검증했습니다. 이는 기존 21개 조건의 수용 판정이며 향후 제품 로드맵 전체의 개발 비율을 뜻하지 않습니다.

## 진척이 멈췄던 이유와 수정

초기 QA는 Windows ACL 조회가 멈춰 실패했습니다. ACL·계정 권한을 바꾸지 않고 조회 구현을 수정했습니다. 이어 Track metadata 수집과 명령 확인의 경합, Persona가 UI의 사전 조회로 채워진 10초 readiness cache에 의존하는 문제가 드러났습니다. 명령 경로가 현재 runtime을 직접 검사하도록 수정했습니다.

응답이 유실된 요청은 원본 조회 404만으로 실패라고 판단할 수 없어 미확정 상태로 유지했습니다. 별도 v2 영수증 API를 추가해 원래 ID·descriptor·권한·만료를 재검증하고, 원본 transaction에서 영구 미접수 기록을 저장한 경우에만 종료하도록 했습니다. 같은 ID의 늦은 실행도 차단합니다. UI에는 ‘원본 미접수 확인’과 원본 증거가 표시됩니다.

## 실제 실행 결과

| 단계 | 검증 결과 |
| --- | --- |
| 기존 요청 0a6d0d63 | 원래 revision58·만료 시각 유지, 원본 not_accepted 확정; 실행 재전송 0회 |
| retry d6728cd3 | dispatch 1회, 응답을 버린 뒤 같은 ID GET으로 attempt2 접수 기록 복구 |
| 후속 Run c25136af | 실제 실행 시작 후 같은 QA 취소, Native 취소 confirmed |
| resume 88c59159 | dispatch 1회, 같은 ID GET으로 attempt3 접수 기록 복구 |
| 최종 Run 9694d7d5 | succeeded, answer.txt 5,581B 검증 및 최종 QA marker 확인 |
| 같은 WorkExecution a1d1af60 | completed r269; 추가 WorkExecution 생성 0회 |
| 같은 Projects Task 9ca7a13d | in_review r6; 사람의 결과 승인으로 간주하지 않음 |
| Note | 게시·색인·본문 검증 완료 |

[실제 QA 결과 Note](https://note.pydemia.ai/#/w/personal-note-production/page/2a1f45e8-53c6-4759-8d64-894f4b7cb6a5)

## 배포와 보존

Track API·web77b8d54를 함께 동결 배포했습니다. 관련53검사·typecheck·분리 web build와 Windows/Ubuntu CI가 통과했습니다. Persona04bbbd9/image6b3a1591은 승인된 CI 예외로 배포했고, 관련332검사·reader60검사·전체 build 및 실제 컴파일752파일의 변경 범위를 대조했습니다. Persona의 현재 source CI 전체 통과로 표현하지 않습니다.

실제 DB 복사본으로 새 테이블 1개와 PK 인덱스까지 정확히 2개 schema object만 증가했음을 확인했습니다. 기존 typed rows·보고서·설정·보호 구성13개와 boot adoption을 검증했습니다. 최초 예상 DDL 누락과 systemd override 우선순위 오류는 운영 전환 전에 차단·복구했으며 실패 기록도 보존했습니다.

원래 완료 업무 f8a9e44f는 completed r72·Task r5/in_review이고 이벤트8건의 해시는 그대로입니다. 이 업무를 다시 실행하지 않았습니다. 기본 Entra 인증을 유지했습니다. Edge 창을 다시 열었고, 실제 화면 검증은 별도 headless Edge로 수행했습니다.

writer는 **15:55:39 KST에 provider=false·Track users=[]로 종료**했습니다. 원래15:58:02 만료를 연장하지 않았고 project 전체 권한은 주지 않았습니다. 늦은 grant 변경 helper와 미완료 intent가 있으면 구버전 시작을 거절하도록 잠금·latch를 적용했습니다. 구버전 복귀에서도 최신 DB와 미접수 기록을 유지하며 writer 차단을 다시 확인합니다.

## 사후 복구 기록

새 영수증·결과를 포함하는 Work/runtime 암호화 백업과 별도 공간 복원 검증을 진행 중입니다. 배포 전 백업과 사후 결과의 시점을 구별하며, 원본 DB를 복원하거나 과거 데이터로 되돌리지 않습니다.

[수용 조건 기준표](goal-status.md) · [개발계획](development-plan.md) · [검증 원본](writer-command-completion-verification-20261118.json)
