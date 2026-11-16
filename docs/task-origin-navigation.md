# Agent Track 원본 업무 이동·운영 검증 — 2026-11-16

## 이번에 확인한 진전

Track API와 웹을 `474676f66f276fafd00c9325e3bfcfb2f30bd78b`로 함께 전환했다.
Edge의 기존 Entra 계정에서 새로고침 후 LIVE 연결을 확인했고, Map의 업무 node를
선택해 상세의 **원본 업무 열기**를 눌렀다. 새 Projects 화면이 같은 Project와
Task `00418966-a605-411d-89ee-51344526ec42`를 선택했고, 제목
`Agent Track QA · Run 재연결 검증 B`와 revision1을 확인했다.
원본 업무 편집·상태 변경·새 모델 실행은 수행하지 않았다.

기존 화면에는 Run의 원본 Session 링크만 있었고 업무의 원본 이동 링크가 없었다.
Projects의 등록된 `uiBaseUrl`도 snapshot 생성 중 제거되고 있었다. UI 링크만
추가하면 운영에서는 계속 ‘링크 미지원’이 표시되는 상태여서 API 투영도 수정했다.

업무 목록·Task Map·그룹 내부·Run 흐름의 업무 inspector에서 기존 원본 링크
표현을 재사용한다. 현재 연결된 Projects 출처와 해당 Project 권한이 확인되어야
링크를 제공한다. 등록된 HTTP(S) UI 주소만 사용하며 사용자 정보·query·fragment가
있는 주소는 제외한다. API·터널 주소로 대신 연결하지 않는다. 다른 출처의 UI 주소는
계속 snapshot에서 제외한다. 목적지 앱의 인증·인가가 최종 접근을 판정한다.
실제 GUI 수용은 위 Map 업무 inspector→Projects 경로에 한정한다.

## 검증과 운영 보존

- 관련24개·타입 검사 통과. 로컬 전체1,280개 중1,269개 통과·실패0·환경 제외11개.
- [Windows·Ubuntu CI](https://github.com/pydemia/agent-track/actions/runs/43875527794) 모두 성공.
- 후보와 복구 버전을 백업 사본에서 기동하고 웹18개 파일의 MIME·바이트,
  스키마·이력 보존과 프로세스 종료를 확인했다. 이 검사는 실제 업무 실행 검증과 구별한다.
- 운영 전환 `7c1576fc-2a9d-4775-b13d-678df3c1eb75` 완료. API·웹 revision 일치,
  원래 설정 복원, 다른18개 프로세스·설정47개·Track 이력·원본 Native DB 보존 확인.
- 보호 Run의 원본8events 전체 metadata SHA·역사 binding r3·cursor/highWater8 보존 확인.
  운영 DB는 복원하지 않았고 기존 저장 보기1개도 유지했다.
- 익명·위조 proxy 요청401, 공개 Track·Trail 로그인302 유지. 운영 snapshot의
  등록된 Projects 주소와 정확한 Task 링크도 별도로 확인했다.

## 왜 전체 진척률은 그대로인가

상위 수용은 **15/21·71.4%**를 유지한다. 이번에는 AT-06 원본 앱 이동의 실제
Task 경로를 진전시켰지만, 나머지 필수 결과까지 완료된 것은 아니다.

Demian 원본 Session 링크는 실제 클릭 후 오류 화면이었다. 익명 HTTP 검사도
루트와 같은 Session 경로에서 Basic401이었다. 기존 원본 인증은 변경하지 않았고
해당 Session의 브라우저 선택 성공은 수용하지 않았다. Track Entra 로그인 성공과
원본 Demian 로그인 성공을 같은 결과로 계산하지 않는다.

Projects에서는 Task 선택이 성공해도 **실행 기록을 불러오지 못했습니다**라는
오류가 남았다. 이 이동 성공으로 Projects 실행 문맥 전체를 수용하지 않는다.

보호 Assistant 업무는 반복 원본 확인의 공개 Projects 왕복 때문에10초 deadline을
넘기는 문제가 남는다. Persona source90e0825/image33e19141의 사설 GET transport
후보는 준비됐지만 새 후보에 대한 CI 예외 승인은 아직 대기 중이다. 이전에 승인된
source4a9ad42/imageb68ece66을 계속 운영하며 승인을 확대 해석하지 않았다.
peer 대표선의 실제 조회 경계와 명령·복구·다중 장치 등도 미완료다.

다음 순서는 해당 후보의 승인 범위 확인 후 보호 업무의 반복 관측을 재검증하고,
원본 앱 인증·peer 실제 경계·명령 수용을 각각 확인하는 것이다. 전체 ETA는
외부 조건과 실제 검증 범위가 남아 산정하지 않는다.

[운영·검사 근거](task-origin-navigation-verification.json)와
[전체 수용표](goal-status.md)를 함께 따른다.
