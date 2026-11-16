# 읽기 경계 계측

AT-14의 실제 반복 조회에서 snapshot 성공 뒤 events404가 발생하고 Native
상세가 나타났다 사라지는 경계를 구분하기 위한 계측이다. 계측 추가 자체를
조회 안정성 해결이나 요구 수용으로 계산하지 않는다.

`GET /api/read-diagnostics`는 기존 Track 루트 인증을 사용한다. 현재 사용자와
출처 membership·identity에 맞는 최근 작업만 반환하며 원본 권한을 새로
조회하거나 명령·모델 요청을 실행하지 않는다. POST와 query는 허용하지 않는다.
이 기록은 Run·Task 접근을 인가하는 근거가 아니다.

프로세스 메모리의 최근128개 작업과 작업당64개 고정 단계만 보관한다. 요청
출처(snapshot/events/evidence/SSE/Assistant/Projects/background), 진단용 무작위
ID와 parent/join ID, 대기 시간, 원래 deadline의 남은 예산, RPC·저장 시간,
상태 코드·deadline 도달·grant 상태·관측 개수를 기록한다. URL·인자·DTO·
사용자명·credential·error 본문이나 stack을 응답에 넣지 않는다. 종료된 작업은
늦게 끝나는 RPC가 관측 결과를 덮지 않는다. 프로세스 재시작 시 기록은 없어진다.

최초 전체 검사는1,267개 중1,256개 통과·실패0·기존 환경별 제외11개다.
이후 로컬 저장 단계와 관측 개수 보완·실제 HTTP 진단 확인을 추가했고,
최종 관련51개와 typecheck가 통과했다. 독립 소스 검토에서 권한 누출·
민감값 보관·무제한 진단 저장·업무 오류 은폐는 발견하지 못했다. 누락된
`native.persist` 타이밍 지적을 반영했다.

초기 단위 검사에서는 새 fixture의 필수 config 누락을 수정했다. 기존 Native
fixture의 임시 포트가 Fetch의 차단 포트에 배정되는 실패도 두 번 발생했다.
이 PC의 동적 TCP 범위는1024부터13977개여서 해당 포트가 배정될 수 있다.
일회용 listener 할당에서만 차단 포트를 제외하도록 보완했고, 실제 HTTP
요청의 기대값·인증·timeout·재시도 정책은 유지했다. 규칙은
[Fetch의 port blocking](https://fetch.spec.whatwg.org/#port-blocking)을 따른다.
이 fixture 실패는 운영 Trace404의 원인으로 간주하지 않는다.

계측 후보의 CI·동결 배포와 실제 단일 운영 reader 관측은 후속 단계다.
원본 이벤트8개·역사 binding r3·현재 Taskr5/in_review와 원본 DB·인증·
writer 비활성은 보존한다. 다음 판정은 실패 표본의 RPC/queue/lease 경계를
확인하고 원인 수정 후 반복 조회·인증 화면을 검증한 뒤 한다.
