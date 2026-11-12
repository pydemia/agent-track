# 업무·세션·Agent 흐름 개편

기준: 2026-11-12 KST. 사용자는 Demian의 주요 미션을 cross-platform,
cross-session으로 Task와 subagent를 조직하고 최종 목표를 수행하는 시스템으로
정의했다. 개별 로그 목록을 네 탭에서 반복하는 구성을 대체한다.

## 화면별 책임

산출물도 Session → Run의 중첩 그룹 안에서 탐색한다. 결과 실선과 첨부 귀속
점선을 구분하고 node/edge 상세에 identity·종류·관측 범위를 표시한다. 개요에서는
그룹 요약으로, 내부 흐름/상세 깊이에서는 개별 산출물로 전환한다. 여러 Task의
화면 묶음은 명시적인 사용자 구성으로 유지하며 artifact 파일 이름이나 기록 순서로
Task 묶음·의존 관계를 만들지 않는다. 세부 계약은 `artifact-flow-integration.md` 참고.

최신 관계 그룹: 원본 세션별 읽기 계약을 바탕으로 peer 연결 → 대화 → 메시지/
처리 영수증을 중첩 문맥 그룹으로 탐색한다. 실제 Run은 기존 Session/Run 그룹에
남기고 경계를 넘는 관계선으로 연결한다. 부모 Run ID가 없는 managed-child의
부모 호출 참조는 미확인 상태로 그룹 밖에 둔다. 같은 대화의 여러 영수증은
소속선을 중복 생성하지 않는다. 합성 QA의3Run·7그룹으로 내부 탐색·breadcrumb·
키보드·390px·계정 변경 제거를 검증했다. 실제 관계 실행으로 계산하지 않는다.
구체 계약·제약은 `session-relations-integration.md`에 기록한다.

| 화면 | 답할 질문 | 기본 표현 | 상세와 연결 |
| --- | --- | --- | --- |
| Track | 어느 업무에 누가 참여하고 무엇이 결정을 기다리는가? | Projects 업무 원본 + 동일 업무에 명시 연결된 고유 Run·세션·장치 요약 | 연결된 Run 선택, 협업 Map, 현재 실행 제어·승인 |
| Trail | 무엇이 요청되고 바뀌고 인계되었는가? | 도구 요청·종료를 묶은 경과, 승인·실행 전이·산출물·파일 근거 | 원본 sequence, 파일/산출물 metadata, Trace 이동 |
| Trace | 실행 안에서 어떤 호출과 도구가 어떻게 진행되었는가? | Run→호출→도구/승인 node+edge, native lineage와 결과 보강 | 호출·thread·turn·시도, 요청/시작/종료·결과, 원본 근거 |
| Map | 같은 목표를 위한 업무·세션·위임·협업이 어떻게 연결되는가? | 업무→연결 Run, Workspace/Session 소속, 명시된 위임·peer·의존 관계 | node 상세, 관계 종류·방향·출처·근거, 관련 Run 이동 |

목표 계층·Task dependency·peer를 수집하지 못한 상태를 빈 완료 그래프로
위장하지 않는다. 현재 Run의 성공은 Task 수용이나 목표 달성을 뜻하지 않는다.
장치 표시는 등록된 source metadata이며 provider 이름으로 OS를 추정하지 않는다.

## 관계와 식별

- Task는 Projects source+Project+Task ID가 같을 때만 묶는다. 제목·저장소·시간이
  비슷하다는 이유로 같은 업무나 같은 목표로 합치지 않는다.
- Run/Session/Invocation은 source-qualified ID로 구별한다. 고유 Run 수와 호출,
  cowork member, native item, peer connection 수를 섞지 않는다.
- 업무 연결과 소속은 점선, 명시된 실행 관계는 실선, 기록 순서는 별도 색·설명을
  사용한다. 기록 순서는 실행 인과·Task dependency를 보장하지 않는다.
- 관리형 child는 부모와 자식 Run의 명시 참조로 세션을 넘어 연결한다. 부모의
  Task binding을 자식에게 자동 복사하지 않는다. 접근 가능한 원본 참조만 표시한다.
- Native item과 call ID의 정확한 일치로 도구를 연결한다. lineage 관측만으로
  호출이 성공·완료됐다고 승격하지 않는다. 시도/호출이 모호하면 충돌로 보존한다.

## UI 공급원과 구현

[ui.pydemia.ai](https://ui.pydemia.ai)의 `pyd-flow-canvas`,
`pyd-flow-layout`, `pyd-flow-alignment` registry source를 실제 편입했다.
원본 checksum과 변경은 `vendor/pydemia-ui/provenance.json`에 기록한다.
React Flow 12.12.0과 추가 의존성20개의 라이선스 원문을 보존한다.
AgentTrail은 node/edge 탐색의 구조 reference이며 소스를 복사하지 않았다.

캔버스는 조회 전용으로 pan/zoom/minimap과 전체 맞춤을 제공한다. Node 선택은
상태·식별자·실행 근거·연결을, edge 선택은 출발·도착·종류·출처·sequence를
우측 상세에 표시한다. 같은 항목을 검색 가능한 버튼 목록으로 탐색할 수 있다.
좁은 화면에서는 상세가 아래로 이동한다. 새 이벤트/lineage로 topology가 바뀔
때만 자동 맞춤하며 상태 갱신·선택마다 사용자의 viewport를 초기화하지 않는다.

## 데이터 경계와 후속 개발

| 단계 | 현재 결과 | 남은 조건 |
| --- | --- | --- |
| 1. 실제 실행 해석 | native lineage 별도 인가 조회, source/run/item 정확한 결합, 기존 immutable 원장 보존 | 공개 UI·scope 철회·재접속 증거를 현재 revision에 연결 |
| 2. 실행 분석 | 호출/도구/승인 Flow, 경과 Trail, 업무별 세션 요약 | 도구 outcome·요청/실행 구간의 실제 원본 대조 |
| 3. 업무·협업 Map | 같은 Task의 여러 source/Session, 명시 Run 관계 closure, Projects 실제 Task dependency·선행 화살표·관계/현재 revision 상세·철회 시 URL 제거 | 실제 goal/cowork/managed-child/peer·artifact 관계 사례 |
| 4. 목표 수행 | 원본 업무 생성·내용 검토→기존 Session 배정→native acceptance→binding 복구, 실제 동일 Task·Session2·Run2 대조 | 자동 subagent 조직화, 검증/수용 근거 연결 |
| 5. 교차 앱 | Projects 원본 요약·Map 이동·단절 중 업무 편집/복구 실기. Demian 요약 BFF/UI·분리 native web에서 장애 중 실제 Run 성공·자동 복구·같은 Map 이동(QA 소유자 범위) | Docker DB/API/worker 복구 후 Demian 원본 web 적용, Assistant/desktop 계약, 두 번째 장치 |

Projects의 dependency는 native Link의 `depends_on`을 서명된 조회 계약으로 연결했다.
관계 소유 Project와 양쪽 업무의 현재 native/service 권한을 모두 확인하며, 원본
A→B 의존 관계는 화면에서 선행 B→의존 A로 표시한다. 실제 QA 관계1건·업무2·Session2·
기존 Run2의6node/5edge와 원본 ID·revision을 대조했고 업무 todo/r1·todo/r2를 유지했다.
미지원 계약·한도·권한 철회는 각각 구분한다. Demian의 해당 검증 Run에는 goal/cowork/managed-child/peer 이벤트가
없다. mock 관계 검사를 실제 subagent 조직화 성공으로 집계하지 않는다.
권한을 확장하거나 원본 producer WIP를 임의 배포하여 이 공백을 숨기지 않는다.

새 조회는 현재 Run/Session 접근을 전후 재확인하고, 업무 연결 Run은 최신 Projects
권한과 교차 검사한다. lineage/도구 원문·인수·출력·메시지는 journal에 추가하지
않는다. 부분 수집·한도·연결 실패·미지원은 각각 표시한다.

실제 Session2·Run2 지도에서 ID 정렬 때문에 소속 연결이 교차하는 증상을 확인했다.
Session→Run의 명시 소속을 행 순서에 반영하고, 도구는 기존 canonical sequence로
정렬한다. 이는 배치 변경이며 업무 dependency나 실행 인과를 추가하지 않는다.
Map·Trace의 조직화 지원 펼침에서는 현재 worker 전역 선언과 선택 provider의 도구
관리 방식을 구분한다. 실제 installed runtime의 외부 provider 분기와 공개 UI를
대조했으며 하위 실행의 존재·성공·대상 준비로 표시하지 않는다.

수용 기준은 AT-04/05/08/12/18/19에 연결한다. 기존 완료 조건을 느슨하게 바꾸거나
기능 추가 개수로 전체 진척률 분모를 바꾸지 않는다. 전체 현황은 `goal-status.md`가
기준이며, 실제 교차 앱 목표 수행은 아직 완료되지 않았다.

## Node group과 탐색 깊이

2026-11-12 사용자 보완: 개별 node·edge로 정리하기 어려운 업무 묶음을 group으로
표시하고, 묶음 내부의 flow를 단계적으로 깊게 탐색한다. AT-12의 그룹·계층·접힘
수용 조건으로 추가하며 기존 21개 기준과 실제 미완료 범위를 유지한다.

| 그룹 | 실제 소속 근거 | 경계와 내부 |
| --- | --- | --- |
| Project | Projects source + Project ID | 같은 원본 Project의 업무와 명시된 하위 묶음. 다른 Project와의 선행 관계는 경계 밖으로 연결 |
| 업무 묶음 | 원본 work package/명시적 업무 구성, 또는 사용자가 고른 화면 묶음 | native 묶음과 시각적 묶음을 구별. 후자는 업무·의존성·담당자·원본 상태를 변경하지 않음 |
| Task 실행 | 동일 source·Project·Task에 연결된 binding | 여러 Session·장치의 Run을 함께 탐색. 다른 Task의 실행을 제목·시간으로 합치지 않음 |
| Session | source-qualified 원본 Session ID와 Run 소속 | 실제 Run 및 그 내부 호출. 여러 Task가 공유하는 Session을 한 업무의 소유로 단정하지 않음 |
| Run | source-qualified 실제 Run | 호출·도구·승인·관측 단계. invocation/member를 독립 Run으로 세지 않음 |
| 호출·협업 | invocation parent 또는 native cowork group/member 참조 | 관리형 child Run·cowork member·peer를 구별. 시각적 group과 native cowork 객체는 별개 |

기본 그룹 기준은 업무 연결 또는 Session이며, 사용자는 묶음 기준과 탐색 깊이를
바꾼다. `묶음 개요`는 상위 그룹을 접어 경계 사이의 흐름을, `실행 구조`는
Task·Session·Run 관계를, `상세 근거`는 호출·도구·승인까지 펼친다. 같은 데이터와
같은 원본 ID를 유지하며 새 실행이나 완료를 합성하지 않는다.

그룹을 선택하면 이름·종류·소속 근거·현재 포함 항목·원본 출처·관측 범위를
표시한다. Task·Run·Session·호출 수와 상태 분포는 각각 계산하며, Run 성공만으로
그룹이나 목표 전체를 완료 색상으로 표시하지 않는다. 미확인·부분 조회·순환은
접힌 그룹에도 남긴다. `내부 흐름`은 해당 묶음을 펼쳐 초점을 이동하고 경로를
표시한다. `상위 묶음`·`전체 흐름`으로 문맥을 복원한다.

접기 전후에도 edge의 방향·종류·출처·원본 근거를 보존한다. 같은 경계 endpoints·
종류·출처인 관계만 대표선으로 묶고 원본 관계 수를 표시한다. 대표선을 선택하면
개별 관계·끝점·근거를 확인할 수 있다. 내부 관계는 사라진 것으로 처리하지 않고
그룹 상세의 내부 관계 수·순환과 펼침으로 접근한다. 시각적 포함을 의존성으로
변환하거나 다른 종류의 관계를 하나의 의미로 합치지 않는다.

화면 묶음은 현재 허용된 Task를 골라 이름을 붙이는 탐색 단위다. 첫 구현의
범위는 현재 화면 내 생성·해제·접기/펼치기이며, 재조회 때 존재하는 동일 ID의
묶음을 유지한다. 구성 업무의 접근이 사라지면 해당 화면 묶음과 이전 이름도
제거한다. 계정별 저장 보기·다음 접속 복원은 별도 원본 권한 재검증과 서버
저장이 필요한 후속이며, 현재 화면의 임시 상태를 저장 완료로 표현하지 않는다.

| 화면 | 그룹으로 정리할 내용 | 현재 구현과 후속 |
| --- | --- | --- |
| Track | 업무 묶음별 참여 Session·고유 Run·승인 대기와 다음 행동 요약 | 기존 Task별 실행 요약은 유지. 사용자 저장 묶음의 집계·Map 이동은 저장 보기 단계에서 연결 |
| Trail | 같은 업무 묶음의 변경·산출물·인계 경과를 Run별 lane으로 비교 | 현재 Run 경과와 파일/산출물 근거를 유지. 여러 Run의 시간을 하나의 인과 순서로 합치지 않는 그룹 범위 선택은 후속 |
| Trace | Run·호출·협업 범위 안의 도구/승인과 원본 sequence | 중첩 그룹·깊이·내부 탐색 구현. 실제 호출 참조가 없는 도구는 상위 호출 미상으로 유지 |
| Map | Project·Task 묶음과 여러 Session·Run의 선행/위임/협업 흐름 | 원본/명시 연결 그룹과 현재 화면 Task 묶음 구현. Goal·work package의 원본 계층은 해당 계약이 생긴 뒤 추가 |

`Project → 업무 묶음 → Task`와 `Run → 호출 → 도구`는 소속을 탐색하는 예시다.
모든 실행을 이 고정 계층에 강제로 맞추지 않는다. 하나의 Session을 여러 Task가
공유하면 바깥에 남겨 명시 관계로 연결하며, 서로 다른 그룹에 중복 소속시켜 Run
수를 늘리지 않는다. 그룹 사이의 실제 dependency·위임은 포함 경계와 별도 edge다.

후속 저장 보기에서는 선택 그룹의 source-qualified ID와 현재 허용 멤버를
Track/Trail/Trace/Map 사이에 전달하고 각 화면 진입 때 재검사한다. 제목·접힘 상태를
URL에 넣거나 철회된 이름을 로컬 저장소에 남기는 방식으로 복원을 대신하지 않는다.
첫 구현의 현재 화면 묶음에 화면 간 영속 선택이 있는 것처럼 표시하지 않는다.

Pydemia의 기존 `pyd-flow-group` renderer와 parent-relative node 배치를 재사용한다.
상위 면·그룹 제목·여백으로 소속을 보이고, 원본/연결/화면 묶음의 근거를 명시한다.
독립 선택·접기·내부 탐색 때문에 필요한 경계는 유지하며 같은 굵기의 박스를
중첩하는 방식으로 깊이를 표현하지 않는다. 그룹 크기를 포함해 배치하고 자식이
부모 밖으로 벗어나거나 서로 겹치지 않도록 검증한다.

수용 검사: 실제 업무 두 개의 화면 묶음 생성·해제, nested group 접기/펼치기,
내부 초점·상위 복귀, 대표선 원본 근거, 순환·고립·공유 Session·서로 다른 source의
동일 ID, 상태 갱신 중 선택/접힘 유지, 권한 제거 시 그룹 이름·멤버 제거,
키보드 목록·그룹 버튼·390px 상세 이동을 확인한다. 구현·fixture·공개 실기를
구분하며 배포 후 현재 revision의 증거로만 완료를 판단한다.

Reference: [Pydemia FlowCanvas registry](https://ui.pydemia.ai/r/pyd-flow-canvas.json),
[React Flow Sub Flows](https://reactflow.dev/learn/layouting/sub-flows).

### Assistant 업무 실행의 중첩 그룹

Assistant 연결에서는 현재 Projects Task → 원본 WorkExecution → 실행 내
Work package → 역할로 탐색한다. 같은 Task의 Demian Run과 Assistant 실행은
Task 그룹에 함께 놓되, 고유 Run 수와 Assistant 실행 수를 별도로 센다.
Work package는 원본 소속이 같은 역할 두 개 이상인 경우에만 만든다. 여러
실행이 공유하는 thread·turn·runtime Task 참조는 바깥에 두고 참조선으로
연결한다. 이 참조를 Demian Session이나 실행 선후 관계로 바꾸지 않는다.

Track는 현재 업무 상태와 실행별 역할 요약, Trail은 원본 상태의 경과,
Trace는 역할·시간·sequence·오류와 연결 근거, Map은 Task 의존 관계와
실행 조직을 표시한다. 현재 Assistant 계약에는 도구 호출·산출물 본문이
없으므로 비어 있는 근거를 생성하지 않고 제공 범위를 명시한다.

묶음 개요 → 실행 구조 → 상세 근거의 세 깊이, 개별 접기/펼치기, 내부 초점,
breadcrumb·상위 복귀와 목록 탐색을 공통 사용한다. Task 여러 개의 화면
묶음은 내부 실행 그룹을 함께 포함한다. 대표선에서 각 원본 관계를 열며,
Projects 또는 원본 읽기 권한이 사라지면 이전 그룹 이름·멤버·상세도 제거한다.
화면 묶음의 서버 저장·다음 접속 복원은 여전히 후속 범위다.

로컬 synthetic 환경에서 두 Task/실행 두 개/역할 네 개/공유 thread와 실제
canonical producer·HTTP·SQLite Store 경계를 사용해 네 보기·중첩 탐색·
키보드 선택·390px·철회 후 제거를 확인했다. 운영 Assistant 교차 앱 검증과
구분하며 `assistant-workspace-verification.json`에 결과를 기록한다.

연결 상태 후속 검증: 각 보기의 `출처별 연결·수집 범위`에서 현재 인가·단절·
미지원 이유, 실제 수집 한도와 마지막 관측을 확인한다. 선택한 출처가 unavailable이면
빈 Trace를 필터 불일치로만 설명하지 않고 원본 미확인 이유를 표시한다. 실제 Demian
API 단절·재시작 후 원본 인가 미확인 상태에서 native Run19개는 보존하되 표시하지
않았으며, 별도 Projects 업무 Map2node/1edge와 관계 상세는 공개 브라우저에서
계속 동작했다. 현재 연결 정상이나 native 실행 재인가 성공으로 집계하지 않는다.
