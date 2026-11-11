# 기존 업무의 Demian 실행 배정 검증

기준: 2026-11-12 KST. 단일 Entra 소유자, 명시 QA Project1개와 기존 Session2개에
한정한 기능이다. 기존 읽기 principal과 생성 전용 principal은 분리되어 있다.
새 Session·credential 생성, 권한 정책 변경, 원본 Task 상태 변경은 포함하지 않는다.

## 실제 원본과 공개 화면

공개 `track.pydemia.ai`의 원본 업무 목록에서 QA Task
`a061ce29-f674-4449-86c3-2902b16713c5`의 내용을 명시적으로 검토했다. 본문·수용 조건·
revision1·시험 필요 여부와 선택한 Session의 provider/model/agent/mode/ask 정책,
실제 전달 프롬프트를 표시한 뒤 실행 배정을 제출했다. 일반 목록은 본문을 읽지 않는다.

| Session | 접수한 Run | 원본/투영 상태 | binding | cursor/highWater |
| --- | --- | --- | --- | --- |
| f94f9b29-8c01-4b05-80d5-b0da85ba1153 | 402a66bc-df81-4c70-82a5-6507d65cf0d6 | succeeded | bound | 147/147 |
| 6e26fd8b-76ff-43ec-8b55-1c42fd86da94 | 865dd2b3-e362-4f60-9b7b-728ff1c8aeca | succeeded | bound | 135/135 |

두 Run 모두 실제 codex-native 실행 시작·성공을 확인했다. 원본 request-status와
정확한 input hash, 출력의 QA marker/Task ID는 일치했다. 출력·본문·추가 지시를
Track 배정 원장에 저장하지 않았다. verifier는 읽기 전용이며 새 실행·재전송하지 않는다.
기계 판독 근거는 `native-task-assignment-verification.json`이다.
제품 재시작 뒤 같은 두 receipt·Run/binding·cursor를 읽기 전용으로 다시 대조했고
새 native mutation은 없었다. 공개 인증 probe는 새 GET3/POST2 경로의401과 기존
Basic/위조 identity 거부, operator hop의 favicon 형식·bytes/hash 일치를 확인했다.

Task 원문·수용 조건·revision1·todo는 보존됐다. Run 성공은 업무 완료·수용이 아니다.
이 사례는 하나의 업무를 서로 다른 기존 Session에서 수행한 증거이며 실제 child/peer
또는 서로 다른 장치에서 수행한 증거는 아니다.

공개 UI에서 접수·Run 연결 후 초안이 비워졌고, 새 미제출 초안을 입력한 뒤 배정 상태를
새로고침해 초안 보존을 확인했다. Session 미선택 시 실행 버튼은 비활성이다.390px·Tab
탐색에서 preview로 초점 이동을 확인했고, drawer를 닫은 안정된 화면의 body/viewport는
375px로 일치했다. Map에서도 node/inspector가 화면 폭 안에 배치됐다. viewport override는
원래 크기로 복원했다.

원본 reader에서 이 QA Project만 일시 제외한7→6 probe 중 자동 갱신이 본문·초안·
두 Run ID·배정 panel을 제거했다. 다른 principal과 원본 데이터는 변경하지 않았고,
같은 operation으로7개 Project 범위를 복원했다. 다시 불러오기·다시 연결 후 공개
Map의 Task1·Session2·Run2·Workspace1, node6개/edge6개와 Task 연결2개를 대조했다.
업무 node에 원본 ID·revision·두 연결, edge에 방향·task-binding·Projects 출처를 표시했다.

## 실패·복구 경계

현재 변경의 `npm test` 193개, `npm run typecheck`, `npm run build`가 통과했다.
아래 검사는 native 쓰기를 의도적으로 실패시킨 운영 실기와 구분한다.

- 실제 SQLite receipt transaction과 임시 파일 DB 재시작/online backup에서 unknown
  보존·동일 UUID 재수신·서로 다른 UUID의 Session 중복 전송 차단을 대조했다.
- 실제 HTTP mock 서버에서 native `Idempotency-Key`, 원본 Task GET만 사용, 유실 응답
  request-status 조회, binding SQLite trigger 장애 후 accepted/pending→bound 복구를
  대조했다. native Run 재전송은 없었다.
- Task revision 변경, 전송 직전 철회, source identity 변경, 기한 경과·busy/archived Session,
  POST4xx/응답 손상·transport 오류를 구분했다. 알 수 없는 접수는 자동 재시도하지 않는다.
- receipt UI는 늦은 unknown이 accepted를 덮지 않으며 현재 인가 조회에서 제거된 행을
  복원하지 않는다. Session 정책 지문이 바뀌면 기존 동의로 제출할 수 없다.
- JSONB가 input object key를 바꿔 반환하는 경우의 hash 우려는 원본 parse가 canonical
  순서를 복원함을 반례 테스트로 확인했다. 해당 우려를 실제 버그 수정으로 기록하지 않는다.

검증 화면은 `track-task-two-session-map.jpg`·`track-task-two-session-map-mobile.jpg`다.
전체 goal 완료는 아니며 현재 분모21개 중14개(66.7%), 동일 가중치다. 실제 subagent
조직·dependency·다른 장치·Assistant/desktop·원본 앱 요약 연동은 별도 남아 있다.
