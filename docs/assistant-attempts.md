# 보호된 과거 시도 조회

현재 단계는 source 구현·격리 검사다. 운영 Assistant/Track, credential·권한,
기존 native 이벤트 원장을 변경하지 않았다.

재시도하면 같은 논리 역할의 현재 ref가 새 시도로 바뀐다. 현재 ref만 순회하던
reader에서는 이전 Run의 인가가 사라져 Trail·Map·상세 조회에서 숨겨졌다.
이제 역할에 보존된 과거 시도를 실제 correlation ID로 선택해 읽는다.

v2 reader는 port를 제공할 때만 `roleAttemptsSupported:true`를 반환한다.
`GET /executions/:executionId/roles/:roleId/attempts`는 역할별 보존 history와
현재 요청을 합한 최대33개를 반환한다. history 자체가32개로 제한돼 있어 페이지를
잘라 전체인 것처럼 표시하지 않는다. 초기 pending 역할에는 시도를 만들지 않는다.

시도 metadata는 실제 correlation·ordinal·로컬 runtime task ID·coordinator 상태,
검증한 producer의 Demian Run 참조와 명시한 successor intent만 포함한다.
본문·결과·Skill 내용·권한 hash·SDK thread/turn ID는 포함하지 않는다.
`command.provenance=coordinator-intent`는 소유자가 준비한 관계이며 Native 접수나
실행 성공을 뜻하지 않는다. 예전 history에 plan이 없으면 `command:null`이다.

시도별 `/attempts/:attemptId/native`와 `/native-evidence`는 그 ref를 고정한다.
현재 시도가 바뀌어도 과거 요청을 현재 Run으로 바꿔 읽지 않는다. await 전후에
소유자·역할·원문 출처와 정확한 ref/producer를 재검사한다. 현재 작업의 진척만
바뀌면 같은 과거 시도를 읽을 수 있고, 지정 ref나 권한이 바뀌면 거절한다.
읽기에는 `runtime.observe`를 사용하며 dispatch·취소·journal 쓰기를 하지 않는다.

Track은 새 capability가 있으면 시도별 경로로 모든 알려진 참조를 읽어 기존
보호 수집 창에 넣는다. source·actor·현재 Projects와 원본 Run tuple을 대조하고,
후속 조회에도 같은 시도가 남아 있는지 확인한다. 이전 이벤트의 정규화·digest를
바꾸지 않는다. Source별 최근 업무50개·Run64개·이벤트250개 창과 부분 여부는
유지한다. 이 창을 전체 제공자 이력이나 무제한 검색으로 해석하지 않는다.

capability가 없으면 현재 역할 경로를 사용하고 Source 설명에 과거 시도 미지원을
표시한다. 지원한다고 선언한 port가 없거나 페이지가 손상되면 옛 경로로 숨겨
되돌아가지 않는다. capability가 조회 도중 바뀌어도 그 응답을 공개하지 않는다.
기존 reader credential의 `controls:false`는 유지한다.

Main 전체 검사1,041개 중1,031개 통과·실패0·skip10이었다. skip은 기존 POSIX 전용
Windows9개와 선택 Persona source 연동1개다. 실제 Persona reader/schema와 Main
client의 선택 연동은 별도로3개 모두 통과했다. 실제 HTTP·Track·SQLite 검사에서는
재시도 후 원본 Run 인가·이벤트 원장 보존, 과거 evidence 재검사와 잘못된 history의
옛 경로로 되돌아가지 않는 거절을 확인했다. Source 범위 설명 후속 변경도 관련21개 통과·선택1개
skip 및 타입 검사로 확인했다. Persona 관련238개·타입·format 검사는 통과했다.
실제 모델·운영 DB·사용자 화면 검사는 아니다.

소비자 Track을 먼저 갱신하고 새 capability가 없는 기존 Persona와의 현재 역할
조회가 유지되는지 확인한 뒤, Persona reader를 갱신해야 한다. 새 필드를 모르는
이전 strict client에 새 capability를 먼저 보내면 조회를 거절할 수 있다. 이미
동결한17e5ff0/9f45e6c/f9f78ac 후보는 이번 시도 조회 source가 아니다.

후속 Flow source는 Native 출처와 `assistantSourceId/executionId/logicalRoleId`를 함께
고정한 역할 시도 그룹을 만든다. 같은 Projects Task와 workspace의 실제 관측 Run만
포함하며 각각의 Run 안에는 기존 호출·도구·승인 그룹을 유지한다. Assistant 실행과
작업 패키지가 있는 화면에서는 그 아래에 역할 시도 그룹을 배치한다. 그룹을 접거나
펼치고 안으로 들어가도 각 Run의 전체 Trail/Trace를 탐색할 수 있다.

Map·Assistant·선택 Run 흐름은 명시한 command의 predecessor가 실제 관측된 경우에만
`재시도 요청`/`재개 요청` edge를 만든다. 점선과 상세의 coordinator-intent·명령 ID로
요청 의도를 구분하고 Native 접수·Run 성공·업무 수용을 추정하지 않는다. 오래된 history에
명령이 없으면 역할 그룹 소속만 표현한다. 선행 시도가 창 밖에 있으면 없는 Run을 만들지
않고 관측되지 않았음을 상세와 부분 범위에 표시한다. 노드를 선택하면 시도 ID·순번·역할·
명령과 원본 Run 정보를 확인할 수 있다. 본문·prompt·SDK ID·새 권한 값은 추가하지 않는다.

시도 metadata는 Run의 조회 snapshot에만 추가하고 이벤트 원장에 가상 이벤트를 넣지
않는다. 재투영은 기존 파생 관계·상세를 재검사해 중복을 제거하며 권한 철회·stale·모호한
ID에는 그 관계를 유지하지 않는다. 화면의 표시 이름과 ID가 다르거나 workspace가
unknown이어도 구조화된 scope로 그룹을 검증한다. 다른 역할/출처의 같은 UUID가 같은
역할의 선행 시도를 덮어쓰지 않는다. 그룹의 저장·복원은 기존 Flow view 경로를 재사용한다.

이 후속도 운영 반영·인증된 현재 PC의 화면 수용 검사를 마친 것은 아니다. 원본17e5ff0/
9f45e6c/f9f78ac 후보를 이번 source로 바꿨다고 표시하지 않는다. owner 제어 broker/UI·
복구와 실제 제공자 실행 검증은 별도 미완료다. reader 변경1aa421c의 CI43518004721은
Windows·Ubuntu의 실제 모든 검사 단계를 통과했다. 이는 후속 Flow revision의 CI가 아니다.

Flow 후속의 전체 회귀 검사는1,056개 중1,046개 통과·실패0·앞서 명시한 skip10이었다.
그 뒤 독립 리뷰에서 서로 다른 Native 출처의 역할 그룹이 중첩되는 문제와 선택 Run의
충돌 관측이 필터에서 사라지는 문제를 각각 실제 실패로 재현해 수정했다. 최종 관련64개·
타입·별도 web build가 통과했다. 이전 전체 검사를 마지막 두 수정의 전체 회귀 통과로
바꿔 기록하지 않는다. [최종 파일별 근거와 한계](assistant-attempt-flow-verification.json)를 따른다.

전체 수용15/21·71.4%(상위 동일 가중치·부분0)를 유지한다. 전체 완료 ETA는
산정 불가·신뢰도 낮음이다. 조회 소스 구현을 AT-09/12/14 전체 완료로 세지 않는다.
