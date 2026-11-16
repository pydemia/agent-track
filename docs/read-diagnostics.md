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

계측8d2ec50의 Windows·Ubuntu CI43847477050이 통과했고 API를 동결 배포했다.
웹은186ff8d를 유지한다. 운영 전환dab2df08-9d36-4e6a-81fd-f1d4445ec1b7에서
설정47개·다른 프로세스18개·웹18개 파일과 Track 이력 보존을 확인했다.
원본 이벤트8개 metadata SHA는
`dc8f4af8af4009f653280130f6fba752cd4237197ecfb790867b22a1b6c18f15`로
유지되고 역사 binding은r3다. writer를 활성화하거나 새 모델 실행을 만들지 않았다.

2026-11-16T10:28:36Z부터 화면 자동 조회를 멈추고 같은 운영 reader에서 순차
조회했다. 기존 background 수집은 유지했다. snapshot200/5,411ms·events200/
7,170ms/8개 뒤 evidence404/10,409ms가 발생했다. 내부 native-evidence 작업은
대기열0·입장 예산10,000ms였지만10,004ms에503/deadlineReached로 끝났다.
첫 roleAttempts는1,835.54ms, 첫 nativeEvidence는6,229.99ms였고
8,405.14ms에 시작한 최종 nativeEvidence는 원래 deadline에 끝나지 않았다.
현재 권한을 확인하지 못한 producer 상태가 disconnected로 바뀌어 후속 Run
가시성 확인에서404가 반환됐다. 이 표본의 직접 원인은 대기열이 아니라 원격
조회 임계 경로의 시간 초과다. 어느 원격 내부 단계가 느린지는 이 계측만으로
더 나누지 않는다.

이어 실제 Edge Trace 자동 갱신 중57.8초 동안20회 진단만 읽었다. 새 원본
조회 부하는 추가하지 않았다. 내부 상세 성공도6,479ms·9,903ms로 원래10초
한도에 가까웠다. 순간 성공은 반복 안정성 수용이 아니다.

후속 소스는 현재 Task를 확인한 정확한 현재 Run에 한해 첫 evidence와 역할
시도 discovery를 병렬화한다. 전체 조회 창에서 선행 상세는 최대1개이며,
discovery의 정확한 attempt·Run tuple 대조와 최종 signed evidence·역할·
Projects·credential fence를 유지한다. 실패한 discovery도 병렬 읽기가 끝난 뒤
큐를 해제한다. 역사 Run은 현재 Run 경로를 빌리지 않는다. 기존10초·lease·
인증·재시도는 늘리지 않았다. 회귀1개가 수정 전 실패·수정 후 통과했고,
Task 거부·실패 시 정리·기존 철회/회전/역사 조회를 포함한 관련114개와 타입
검사가 통과했다. 후속 전체 검사도1,271개 중1,260개 통과·실패0·기존
환경별 제외11개다. 이 수정05c1833의 Windows·Ubuntu CI43850572530이
통과했고 운영 전환2914b2d7-6bce-411b-8a48-71473583d9a9를 완료했다.
API05c1833·웹186ff8d, 설정47개·다른 프로세스18개·웹18개 파일·이력과
원본8events metadata SHA·역사 binding r3 보존을 다시 확인했다.

수정 후10:45:36Z~10:46:37Z의 고정3회 순차 조회는 snapshot/events/evidence
총9개가200이고 각 상세는connected/8events였다. 상세 HTTP 시간은
6,946/4,749/6,751ms이며 첫 evidence와 discovery의 시작 차이는4~6ms다.
Edge에서도8events·선택 모델·usage2범위·산출물1개·4nodes/3edges/3groups와
Run 그룹 내부·native-lineage inspector의seq4,5를 확인했다. 원본에는 호출
생명주기 이벤트가 없으므로 이 참조를 실제 호출 시작/종료로 확대하지 않는다.

그러나 공통 묶음 범위를 선택하던10:49:27Z의 SSE metadata 수집이 다시
10초에 실패했다. 대기열0·예산10초에서 첫 metadata3,451.47ms, 마지막
metadata6,289.15ms가 걸렸고9,984.76ms에 시작한 최종 Projects 확인이 끝나지
않았다. 이 작업의 parent/join ID로 같은 실패를 기다린 events·evidence·
background 요청을 연결했다. 후속 snapshot에서도 원래 Run이 숨겨졌다.
공통 그룹 범위가 해제된 현상과 일치하나 독립된 그룹 UI 결함은 확정하지 않는다.
10:53/10:54의 추가 SSE 수집도 원래 deadline에 실패했다. 이 확대 표본을
앞선3회 성공이나 짧은 자동 갱신 표본으로 덮지 않는다.

따라서 첫 상세의 불필요한 직렬 대기는 줄였지만 전체 반복 안정성은 미완료다.
현재 실제 근거는[운영 계측 기록](read-diagnostics-operating.json)에 보존한다.
남은 경계는 생산자의 Native metadata RPC 내부 처리 비용이며, 원본 권한과
최종 재확인·현재10초 제한을 유지한 채 비용을 줄일 방법을 조사한다.
전체 상위 수용은15/21·71.4%(동일 가중치·부분0), AT-06/09/12/14/15/20은
미완료다. 전체 필수 하위 결과 분모는 아직 미확정이라 전체 표시 진척률과
완료 ETA는 산정하지 않는다. reader 전환🟩·상세/그룹 안정성🟨·명령/복구🟨·
다중 장치/원본 이동🟨이며, 재산정은 같은 실제 업무의 반복 수용 후다.

원본 이벤트8개·역사 binding r3·현재 Taskr5/in_review와 원본 DB·인증·
writer 비활성은 보존한다. 다음 판정은 실패 표본의 RPC/queue/lease 경계를
확인하고 원인 수정 후 반복 조회·인증 화면을 검증한 뒤 한다.
