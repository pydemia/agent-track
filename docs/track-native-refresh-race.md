# 보호된 Run 상세 조회와 동시 갱신 경합

2026-11-14, 실제 Entra Edge 로그인 후 같은 WorkCoordinator 업무의 Map을 여는 과정에서 대시보드 전체가 비워졌다. 로그인 계정과 API 정상 상태를 먼저 확인했고, 이어 선택한 Run의 evidence 요청이 접근 변경으로 처리되는 증상을 관측했다.

## 확인한 원인

`AssistantNativeCollector.collect()`는 현재 권한 조회를 시작할 때 기존 grant를 숨긴다. SSE 갱신이 evidence 읽기와 겹치면 evidence의 마지막 동기 snapshot 확인이 이 임시 상태를 읽어 `run_not_found` 404를 반환했다. 웹은 이 응답을 접근 철회로 처리해 이전의 비공개 데이터와 선택을 지웠다.

실제 HTTP reader·Sources·SQLite·Track API를 사용하는 회귀 사례에서 수정 전 404를 재현했다. 갱신 중 기존 grant를 표시하도록 바꾸지 않고, evidence가 진행 중인 갱신의 확정 결과를 기다려 before/final snapshot을 읽도록 수정했다. 새로운 갱신이 시작되면 현재 작업을 다시 확인하며, 대기는 10초 이내로 제한한다. 확인이 끝나지 않으면 503이며 이전 snapshot을 반환하지 않는다.

## 권한 변경과 페이지 일관성

독립 리뷰에서 최종 갱신 대기 중 Assistant·Projects 설정을 바꾸고 같은 Run을 재인가하면 이전 페이지가 반환될 수 있는 경계를 찾았다. 별도 회귀 사례로 실제 이전 페이지 반환을 재현한 뒤, evidence 조회 당시의 전체 RequestScope 확인 함수를 최종 snapshot 이후에 다시 실행하도록 수정했다. credential 파일 경로뿐 아니라 같은 경로의 파일 내용·키 변경도 기존 bounded-file fingerprint로 확인한다. 확인 함수와 credential은 브라우저 응답이나 저장 원장에 포함하지 않는다.

현재 Project 철회, 역할·grant·source 철회, 설정 변경, 미완료 갱신과 이전 이벤트 원장 보존 검사를 포함한다. 실제 철회는 여전히 근거를 반환하지 않는다. 이 변경은 producer의 attempt 조회 지연이나 미지원 evidence endpoint를 지원으로 바꾸지 않는다.

## 검증 범위

- 수정 전 동시 갱신 404와 최종 대기 중 credential 경로 변경에 따른 이전 페이지 반환 재현
- 수정 후 동시 갱신 완료, 실제 Project 철회, 제한된 대기, Assistant 경로·동일 파일·Projects 경로 변경의 회귀 검사 통과
- 초기 전체 회귀 1,219통과·실패0·10skip; 이후 리뷰 수정의 관련 176개 검사 통과 및 추가 설정 변경 3개 검사 통과. 최신 전체 CI는 별도 확인 필요
- 실제 운영 reader를 사용하는 메모리 전용 canary에서 SSE와 evidence 요청 병행: evidence HTTP200·forbidden, 같은 Run 계속 표시, 기존 8 events 불변. 운영 Store·새 모델 실행 사용0
- TypeScript 검사 통과. 현재 변경은 backend이며 `27e00a8a` 이후 frontend source diff 없음

운영 반영 전에는 source CI, 동결 API release와 기존 검증된 web 자산, 현재 환경·DB·프로세스 보존을 확인한다. 반영 후 동일 Entra 계정의 Map·Trace·그룹 탐색과 새로고침을 확인한다. producer `32176e9`는 이번 변경으로 재배포하지 않는다.

전체 수용률은 15/21·71.4%(상위 동일 가중치·부분0)를 유지한다. 전체 완료 예상은 미산정·신뢰도 낮음이다. 이 경합 수정과 인증된 화면 확인을 전체 교차 앱 업무 완료로 확대하지 않는다.
