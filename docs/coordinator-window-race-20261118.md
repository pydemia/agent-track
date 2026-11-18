# 보호 실행 명령 확인과 수집의 경합 수정

2026-11-18. 운영 API047b4d6/webc52b49d에서 QA writer 활성화 후 확인했다.
새 명령 POST 전 GET에서403/authority_changed와200/coordinator_unavailable가
나왔다. 같은 시점 원본 QA는 failed r58·시도1, 원본 완료 업무는 그대로였다.

## 원인과 변경

원본 Assistant detail은200이었고 retry 가능한 역할·현재 Task·Run 연결도 일치했다.
명령 확인의 current()는 매번 refreshProjectGrants()를 호출했다. 이 함수는
Projects 권한뿐 아니라 보호된 Native 수집도 실행하며, 수집 중에는 기존 metadata
grant를 닫는다. 별도의 백그라운드 수집도 detail 조회와 최종 target 확인 사이에
끼어들 수 있었다. 실제 권한 철회와 구별하지 못하고 명령 가능 여부가 흔들렸다.

HTTP 명령 경계에서 선택한 Native 출처의 기존 bounded admission을 획득한 뒤
Assistant 큐에 들어간다. 가용성·검토·dispatch·같은 ID 영수증 조회까지 그 요청의
창을 유지한다. current()의 중복 수집을 제거했다. detail()의 원본 producer,
Projects/Task 권한 재확인, config/identity stamp, 명령 직전 fence, 기한은 유지한다.
grant 수명이나 timeout을 늘리지 않았고 자동 POST 재전송을 추가하지 않았다.

## 검증

- 수정 전: 수집이 detail 도중 창을 닫는 HTTP 회귀에서 retry가 빈 배열로 나와 실패.
- 수정 후: 같은 회귀의 가용성·검토·전송1회·같은 ID 영수증 복구 통과.
- 실제 collector와 HTTP reader를 쓰는 합성 upstream 검사에서 큐에 들어간 수집이
  명령 요청의 조회 창이 끝날 때까지 기다리고, 끝난 뒤 정상 수집하는 것을 확인.
- coordinator API·명령 원장·보호 collector·Assistant 권한·writer client 관련152개 통과,
  실패0·skip0. 실제 권한 철회·credential rotation·기한·응답 유실 검사 포함.
- `npm run typecheck` 통과. 위 결과는 Windows/Node24.21.0 로컬 검사다.

실제 서비스 수정 반영과 QA retry/resume·영수증 복구는 별도 후속 검증이다.
이 문서만으로 AT-09를 완료 처리하지 않는다. writer는 승인된 단일 QA Execution에
한해13:58:02~15:58:02 KST이며 프로젝트 전체 grant나 원본 완료 업무 replay는 없다.
개인 runtime에 저장한 진단에는 operation ID·상태·시간·단계만 사용했고 비밀값은
출력하지 않았다.
