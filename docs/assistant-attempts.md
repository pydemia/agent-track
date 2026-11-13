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

다음 UI 연결은 같은 `assistantSourceId/executionId/logicalRoleId` 아래에 시도들을
묶고, 실제로 관측한 Run을 자식 node로 둔다. intent가 있을 때만 이전 시도와
재시도/재개 요청 edge를 연결하고 접수·실행·업무 수용 상태를 구분한다. 오래된
history에 관계가 없으면 시간순으로 의존성을 추정하지 않는다. 이 Flow·group·
제어 broker/UI와 운영 검증은 아직 남아 있다.

전체 수용15/21·71.4%(상위 동일 가중치·부분0)를 유지한다. 전체 완료 ETA는
산정 불가·신뢰도 낮음이다. 조회 소스 구현을 AT-09/12/14 전체 완료로 세지 않는다.
