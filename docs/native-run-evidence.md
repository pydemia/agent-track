# 보호된 Run의 별도 상세 관측

## 해결 대상

현재 보호된 prepared 실행은 `agent.invocation.started/completed`를 생성하지 않는다.
기존 metadata 원장은 모델 선택·사용량의 일부 필드만 보존하며 native thread/turn/item은
기존 정규 이벤트로 표시하지 않는다. 원장 수집 성공만으로 상세 Trace가 채워지지 않는 이유다.

이미 저장된 이벤트의 내용·digest·cursor를 변경하지 않고 별도 현재 인가 조회를 추가한다.
선택 모델, 범위별 usage, Run 시각, 검증된 산출물 메타데이터와 native 참조를 보여준다.
호출 생명주기·모델 요청·도구 결과·의존 관계는 실제 근거가 있는 경우에만 표시한다.

## 조회 경로와 권한

| 경계 | 경로 | 확인 사항 |
| --- | --- | --- |
| Native | `GET /api/v1/runs/:runId/evidence?after=0&limit=250` | 기존 서명·receipt·현재 actor/binding/정책/역할/키를 사용. 직렬화 후 다시 확인 |
| Assistant | `GET /api/integrations/track/v2/executions/:executionId/roles/:roleId/native-evidence` | 기존 전용 reader, 현재 owner/Execution/역할 참조와 gateway의 현재 문맥을 전후 대조 |
| Track | `GET /api/runs/:key/evidence` | 현재 사용자·source·Projects Task 인가 교집합. 마지막 서명 확인 후 Projects를 다시 조회 |

추가 credential·Graph scope·Entra 등록은 필요하지 않다. Native 일반 bearer의 lineage
접근 제한도 유지한다. 보호된 prepared lineage에는 별도 receipt-bound SQL을 사용한다.
현재 prepared deployment와 원래 writer authority hash가 일치하고 child provider 세대가
없는 동일 Run·조회 sequence만 허용한다. 일반 lineage reader의 범위를 넓히지 않는다.

SQL은 모델·usage의 허용 필드만 투영하고 numeric을 JSON driver 변환 전에 검사한다.
원본 임의 JSON·메시지 본문·도구 인자·결과 bytes는 반환하지 않는다. SDK 식별자는
원본 내부에서 출처 범위 hash로 바꾸며 브라우저 응답에는 사용자·principal·조직·서명 및
문맥 hash를 포함하지 않는다. 산출물은 실제 bytes/hash 확인을 통과한 메타데이터만 제공한다.

## 화면 표현

- 기존 Pydemia FlowCanvas·그룹 탐색·node/edge 상세를 재사용한다.
- Run 아래의 호출 ID는 생명주기가 없으면 `호출 참조 · 생명주기 미관측`으로 표시한다.
- Native turn·item을 별도 참조 node로 표시하고 명시된 참조 edge와 원본 sequence를 연결한다.
- 모델 선택은 Run 상세에 표시한다. 모델 요청 node를 만들지 않는다.
- Usage는 scope/source/invocation별 마지막 관측을 표시한다. 중복 보고나 최근 요청·전체 session 범위를 합산하지 않는다.
- Queue/wall은 Run에 저장된 시각 차이다. 제공자 연산 시간이나 실제 effort로 표시하지 않는다.
- 사용자·Run·출처 범위 변경과 실패/인가 거절 시 이전 상세 관측을 지운다. 브라우저 메모리만 사용한다.
- 250개씩 최대 1,000개를 조회한다. 범위 밖 이력은 불완전 상태로 표시한다.

## 검증과 남은 단계

Track의 HTTP reader→현재 Projects 권한→브라우저용 projection을 검사했고 상세 조회
전후 SQLite 이벤트 원장이 같은 것을 확인했다. 마지막 서명 확인 중 Projects 권한을
철회하는 회귀 사례는 수정 전 노출을 재현했고 수정 후 응답을 숨긴다. 잘못된 int64
문자열의 검증 예외도 재현·수정했다.

새 Native SQL은 운영과 분리한 임시 PostgreSQL 17.11에서 실행했다. prepared 두 모드의
서명된 evidence 응답에 lineage가 포함되고 정책 철회 후 숨겨지는 것을 확인했다.
일반 bearer 우회·잘못된 원본 tuple·child generation·unsafe numeric·pagination도 검사한다.
원본 Native와 Assistant 운영 프로세스는 이번 단계에서 교체하지 않았다.

| 범위 | 실제 결과 |
| --- | --- |
| Track 전체 로컬 검사 | 1,031개 중 1,022 통과·실패 0·POSIX 전용 9개 Windows 미지원 skip |
| Track 타입·별도 출력 build | 통과. 기존 운영 `dist/web` 보존. 번들 크기·XYFlow directive 경고는 남음 |
| Persona 관련 검사 | 208 통과·실패/skip 0. 입력 검증 추가 후 관련 11개도 재확인 |
| Native 임시 PostgreSQL | 58개 중 57 통과·실패 0·별도 Assistant root를 요구하는 1개 미실행 |
| Native 타입 검사 | 통과 |
| UI | projection·HTML 생성 검사. 실제 브라우저 렌더링·그룹 선택 동작 미검증 |

새 Persona source `f9f78ac`의 [PR CI 43493618449](https://github.com/pydemia/persona/actions/runs/43493618449)는
네 job 모두 실행 step 없이 실패했다. GitHub app job의 annotation은 계정 결제 실패 또는
spending limit을 사유로 표시한다. 별도 push43493606606도 실패다. 이는 로컬 코드 검사
결과와 구분하며 CI 성공·운영 반영으로 계산하지 않는다. CI를 반복 실행하거나 결제 설정을
변경하지 않았다.

Track source17e5ff0의 CI43494168243은 Windows·Ubuntu의 실제 검사·build가 모두 성공했다.
Native 후보는19626file/5link, Track 후보는2034file/27package로 검증·동결했다.
Assistant 후보 image `056982e8`도 빌드됐고 network none·credential mount0 환경에서
컴파일된 evidence schema의 정상 window와 잘못된 cursor/private field/타 Run 산출물 거부를
확인했다. 이 검사는 운영 DB를 열지 않는다. 후보 준비를 Persona CI 성공이나 운영 반영으로
표시하지 않는다.

QA 컨테이너는 제거됐고 임시 환경 파일의 부재도 별도 최종 조회로 확인했다. 최초 정리
관찰 실패 기록은 그대로 보존한다. 운영 DB·실제 Task·Execution·Run·Note를 재생성하지 않았다.

현재 collector와 상세 lookup은 최근 업무 50개 조회 창을 사용한다. 창 밖 조회가 남아 있는
상태의 미발견은 권한 거절로 확정하지 않고 조회 불가로 표시한다. 전체 이력 탐색은 후속 과제다.
Native/Assistant/Track의 운영 반영과 같은 실제 업무의 화면 대조를 마쳐야 사용자 수용으로
판정할 수 있다. **상위 수용률은 15/21·71.4%(동일 가중치·부분 0)로 유지한다.**

Native source와 재현 가능한 patch는 [provenance](../integrations/demian-native-evidence/provenance.json)에
고정했다. 기존 source·이벤트 ABI와 운영 AgentTrail은 유지한다.

## 최신 제공자 준비 — 2026-11-14, 운영 전환 전

Track 소비자 API·웹은27e00a8로 운영 중이다. Native API는 아직db861e8,
전용 worker는c439341, Assistant는9382c9c이며 최신 제공자 후보와 구분한다.

최신 Native2c113bb의 core·worker 빌드와 API 두 번의 일치 빌드를 확인했다.
19,632개 파일·내부 link5개를 새 release로 동결했고 manifest SHA는
`924c187e85328d40a3a1dcc41fca6ff37676706b51e794b1cc0eddaab647c5e4`다.
공간 확보에는 사용 중이 아닌 이전9f45e6c 후보의 복제 의존성만 정리했다.
그 후보의 소스·실행 파일·manifest는 남아 있지만 의존성이 없으므로 동결 release로
실행할 수 없다. 운영·복귀 release는 그대로다.

원본 PostgreSQL의 읽기 전용 snapshot 백업을 별도 tmpfs DB에 복원했고45개 table의
typed row hash가 일치했다. 원본에서는 아직 미적용인027 migration을 사본에만 적용해
기존 행·schema·역할·멤버십·정책 보존을 대조했다. 새 table은 빈 `run_commands` 하나이며,
기존 `runs`에는 unique constraint와 index가 추가된다. 새 함수2개·trigger2개를 포함한
전체 schema 차이는 사본의 실제 catalog 정의로 고정했다.

최신 API와 이전 API를 같은 사본에서 차례로 기동했다. 두 API의 기존 capability·actor·
Session 조회는200, 서명 없는 bearer는403이었다. 최신 API는 기존 실제 완료 Run의
evidence를200으로 반환했고 이전 API는 해당 새 경로를403으로 거부했다. 복사본에는
원본에서 현재 관측한 worker의 `checked_at`만 같은 identity/hash 행에 반영했다.
새 worker를 실행하거나 현재 시각을 임의로 만들어 넣지 않았다. 실제 운영 검증으로
확대하지 않으며, 두 child 종료·port 해제와 clone DB·network 정리를 확인했다.

첫 검사기의 중복 process 기록과 detached child 수명 관리 오류는 앱 오류와 구분했다.
한 번 생성한 원본 백업을 재사용해 수정한 검사를 수행했다. 원본 DB 복원·DDL 적용,
업무 변경·모델 실행은 없었다. 정상 서명 조회의 nonce 추가와 실제 worker 시각 갱신은
기존 보존 정책으로 계속 대조한다.

Assistant32176e9도 새 후보 image
`320474cdd35c1cb7042ff89d61000a7f8d623612f345da1762b57bc1c77ce9f9`로 빌드했다.
177,898,740 bytes의 Git archive를 기존 SSH로 직접 전송하고 양쪽 SHA·source tree를
대조해 로컬 archive 생성은 피했다. network none·credential mount0에서 컴파일된
모듈12개 hash를 확인했고 기존 운영 container frame도 보존했다. 이 결과를 기존의
실행 전 실패한 Persona CI 성공이나 운영 배포로 표시하지 않는다.

Assistant는 Work DB의 명령 receipt·audit table2개와 로컬 runtime DB의 successor
plan table1개를 추가한다. writer가 꺼져 있어도 constructor DDL과 기존 background
recovery는 실행되므로 두 DB 사본에서 startup 행 변화를 검사해야 한다. 8열 receipt
writer 호환성은 기존9382c9c 전체 binary의 새 명령 journal 읽기 호환성과 다른 조건이다.
명령·writer는 계속 비활성 상태이며 새 권한을 만들지 않았다.

[최신 준비 근거](native-producer-preparation-verification.json)를 따른다. 원본 Native의
027 적용·API와 공개 gate 전환, Assistant의 두 DB 보존·코드 복귀 검증과 운영 반영,
현재 PC의 Entra 화면에서 같은 업무를 보는 단계가 남는다. 상위 수용률15/21·71.4%
(동일 가중치·부분0), 전체 ETA 산정 불가·신뢰도 낮음을 유지한다.
