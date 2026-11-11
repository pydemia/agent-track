# 업무·세션·Agent 흐름 개편

기준: 2026-11-12 KST. 사용자는 Demian의 주요 미션을 cross-platform,
cross-session으로 Task와 subagent를 조직하고 최종 목표를 수행하는 시스템으로
정의했다. 개별 로그 목록을 네 탭에서 반복하는 구성을 대체한다.

## 화면별 책임

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
| 3. 업무·협업 Map | 같은 Task의 여러 source/Session, 명시 Run 관계 closure, unknown·한도 표시 | 실제 goal/cowork/managed-child/peer 사례, native Task Link 읽기 계약 |
| 4. 목표 수행 | 원본 업무 생성·내용 검토→기존 Session 배정→native acceptance→binding 복구, 실제 동일 Task·Session2·Run2 대조 | 자동 subagent 조직화, 검증/수용 근거 연결 |
| 5. 교차 앱 | 현재 PC Demian과 Projects 관측 | Assistant/desktop 계약, 두 번째 장치, 원본 앱 요약·인증 조회·장애 격리 |

Projects의 dependency는 native Link에 존재하지만 현재 Track의 서명된 integration
응답에는 없다. Demian의 해당 검증 Run에는 goal/cowork/managed-child/peer 이벤트가
없다. mock 관계 검사를 실제 subagent 조직화 성공으로 집계하지 않는다.
권한을 확장하거나 원본 producer WIP를 임의 배포하여 이 공백을 숨기지 않는다.

새 조회는 현재 Run/Session 접근을 전후 재확인하고, 업무 연결 Run은 최신 Projects
권한과 교차 검사한다. lineage/도구 원문·인수·출력·메시지는 journal에 추가하지
않는다. 부분 수집·한도·연결 실패·미지원은 각각 표시한다.

수용 기준은 AT-04/05/08/12/18/19에 연결한다. 기존 완료 조건을 느슨하게 바꾸거나
기능 추가 개수로 전체 진척률 분모를 바꾸지 않는다. 전체 현황은 `goal-status.md`가
기준이며, 실제 교차 앱 목표 수행은 아직 완료되지 않았다.
