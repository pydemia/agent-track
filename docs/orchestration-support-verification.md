# Provider 조직화 지원과 관계 행 정렬

기준: 2026-11-12 KST. 기존 업무 배정 변경 `565dffc` 이후의 읽기 전용 변경이다.
전체 goal은 동일 가중치14/21(66.7%)이며 실제 subagent/peer·다른 장치 검증은 남아 있다.

## 실제 원본·화면

선택한 QA Run의 현재 Session/Run 접근을 전후 확인하고 native runtime capability와
provider connection의 허용 metadata만 읽는다. `GET /api/runs/:key/orchestration`은
최신 Project·source identity·Session provider/mode/정책을 다시 검사한다. 응답에는
credential·provider endpoint·auth job·메시지·입출력·child target 목록이 없다.

원본 worker의 Goal/Cowork/Managed child 전역 선언은 모두 true지만 선택 profile
`codex-native`의 유형은 `codex-app-server`다. 실제 worker가 읽는 runtime 모듈에
외부 도구 관리 분기와 관리형 child target의 early empty return이 존재함을 hash와
함께 확인했다. `native-orchestration-verification.json`은 이 결과를 기록한다.
capability의 활성 선언을 실제 위임 가능·하위 실행 성공으로 승격하지 않는다.

공개 Entra Map·Trace에서 '이 실행의 조직화 지원'을 펼쳐 provider 유형·Session
mode·전역 선언과 외부 실행기 관리 안내를 확인했다.390px에서 body/viewport375px,
support client/scroll345px로 일치했고 임시 viewport를 복원했다. 검증 이미지는
`track-orchestration-support.jpg`, `track-orchestration-mobile.jpg`다.

같은 Task의 두 Session·두 Run 지도에서 opaque ID 순서가 서로 반대여서 소속
선이 교차했다. 명시된 Session→Run 관계로 두 열의 행을 맞췄다. 실제 공개 DOM의
Session/Run4d684e78은 y70,1d411f84는 y248로 일치했다. Task·Workspace와 관계 수는
그대로이며 새 dependency·child 관계를 만들지 않았다. `track-task-aligned-map.jpg`
에 선택 업무와 관계를 표시했다.

## 검사와 한계

현재 변경에서 테스트204개·typecheck·build가 통과했다. 조회 중 생성된 report
timestamp를 요청 전 시각과 비교해 잘못 unknown으로 처리하는 문제를 HTTP 회귀
검사로 재현하고, 응답 파싱 시점에 freshness를 검사해 해결했다. 정상·stale·미지
provider·중복 identity·형식/크기·credential 재조회와 권한 철회/정책 변경을 구분했다.
native HTTP401/403은 SourceError로 보존하고 현재 UI에서 private metadata를 제거한다.

행 정렬 검사는 Session/Run ID 역순에서도 lane이 일치하고, 도구의9→10 순서와
입력 불변·반복 결정성을 대조한다. 원본 runtime/source 설정·provider 인증·정책은
변경하지 않았고 새 실제 Run도 시작하지 않았다. 현재 worker의 지원 보고는 과거
Run 당시의 설정이나 특정 worker/장치에서의 실행 가능성을 보장하지 않는다.
