# 진행률 판정 감사

기준: 2026-11-13 KST. 감사 대상 HEAD `19a8924a14ed06609acbc76fcd666fe6982f6fc5`.
Track 운영 코드 기준은 `a3bb446b9f32939ec7a6e15237e6f6d4ac6f1003`이다.
원래 수용 조건은 [제품 기획](product-plan.md), 그룹 확장은
[그룹 UI 계획](mission-ui-plan.md)의 AT-12-G01~06을 따른다.

**수용 항목 충족률을 14/21·66.7%에서 15/21·71.4%로 정정한다.**
21개 상위 요구의 동일 가중치와 분모를 유지한다. 부분 항목에는 임의의 점수를
주지 않았다. AT-18의 기존 보류 조건을 바로잡아 1개를 재분류한 결과다.
이 비율은 개발 작업량, 사용자에게 유용한 정도, 운영 준비도나 남은 시간의
추정치가 아니다. 전체 교차 앱 업무 수용(AT-14)은 여전히 미검증이다.

## 보고가 실제 진전을 보여 주지 못한 이유

- `565dffce`(2026-11-12 03:14:07 KST)에 이미 14/21이 기록됐다. 감사 시작
  2026-11-13 17:27 KST까지 약 38시간 동안 같은 수치가 유지됐다.
- 부분 항목에 새 구현·실제 실행·배포 증거가 쌓여도 모든 하위 조건을 닫기
  전까지 분자가 바뀌지 않았다. 이를 전체 개발 진척으로 반복 전달했다.
- AT-18에 원래 요구에 없는 전체 업무·desktop·운영 SDK 전환 조건을 섞었다.
  이 잔여 작업은 AT-14/15의 실제 통합과 운영 범위에서 추적해야 한다.
- 최신 실기와 오래된 상태가 섞였다. 실제 child/peer를 미검증으로 적은 그룹
  계획, 원본 웹 적용 전 Docker 장애로 보류했다고 적은 AT-20 등이 해당한다.
  과거 검증 JSON의 한계는 당시 기록으로 보존하고 최신 후속 기록을 연결한다.

## 부분 항목에 누적된 실제 진전과 남은 조건

| 요구 | 확보한 근거 | 현재 판정과 다음 수용 검사 |
| --- | --- | --- |
| AT-06 앱 간 이동 | Session URL·미지원 Run 안내, 원본 공개 웹 교체 | 부분. 원본 Demian 공개 경로는 기존 Basic gate다. 허용된 인증으로 동일 Session/Task가 선택되는 브라우저 이동은 미검증 |
| AT-09 실행 제어 | 공개 UI 취소→native cancelled·receipt, 중복·unknown·철회 방어 | 부분. 재개/재시도의 원본 계약과 실제 흐름은 미지원. capability에 맞게 숨기는 기능과 실제 제어 지원을 구분 |
| AT-12 그룹·깊이 탐색 | typed edge·중첩 그룹·상세·접기·복귀·네 보기 범위·저장, 실제 child/병렬 합류/peer, 동결 운영 배포 | 부분. 최신 운영 revision에서 네 보기 공통 범위와 저장/복원의 인증 GUI 대조가 남음. 병렬 대표선 마우스 선택은 통과했고 peer 사례의 마우스/pixel은 미검증. 전체 desktop 업무를 이 renderer의 추가 게이트로 삼지 않음 |
| AT-14 교차 앱 업무 | Assistant 실제 실행 읽기, gateway→native Run1·attempt1·전송1·8event·응답/receipt DB 대조 | 부분. QA 위임은 WorkCoordinator/Projects 결과 연결·desktop 접속·Track 검토를 통과한 전체 업무가 아님. 운영 실행 authority와 protected Run metadata 인가도 별도 연결 필요 |
| AT-15 전체 대시보드 | 여러 저장소/workspace·필터와 실제 Windows→Linux 메시지/처리 Run | 부분. 같은 기본 대시보드의 여러 장치 동시 조회·필터 해제 후 선택/상태 보존을 실제로 대조해야 함. 별도 QA source의 Linux Run만으로 완료 처리하지 않음 |
| AT-18 관계 구분 | 원본 invocation/cowork·managed-child·peer ID/receipt, 명시 관계·인가·고유 Run 집계, 실제 child·병렬·Linux 처리 QA | **검증 완료로 정정(인가된 QA 범위).** 운영 SDK/worker 전환과 전체 업무는 별도. protected Assistant 위임 Run을 일반 bearer로 노출한 것으로 간주하지 않음 |
| AT-20 두 앱의 문맥 요약 | Projects 운영 화면·장애 격리, Demian 분리 웹 실제 Run·복구, 원본 공개 웹의 context200/연결됨/동일 Session·wrong actor403 | 부분. 원본 웹은 이미 교체됐다. 기존 Basic gate 아래 HTTP 확인을 인증 브라우저 GUI·같은 선택 이동·원본 공개 웹의 장애 격리 검증으로 확대해야 함 |

주요 증거:
[병렬/합류](native-parallel-flow-verification.json),
[실제 peer 처리](native-peer-processing-verification.json),
[managed child](native-managed-child-verification.json),
[저장 보기 후속](saved-flow-views-verification.json),
[모델 요청과 운영 배포](model-request-trace-verification.json),
[Assistant 실제 위임](assistant-native-delegation-verification.json),
[Demian 원본 웹 교체](demian-public-web-promotion-verification.json).

## 기존 완료 14개 재대조

다음은 기존 증거와 현재 코드/상태표를 대조한 결과다. 이번 감사에서 원본 업무를
재실행하거나 운영 서비스의 모든 회귀 검사를 새로 수행한 결과는 아니다.
기존의 단일 owner·명시 QA 등 보장 범위를 유지하며 전체 사용자·운영 업무로
확대하지 않는다. 이전 실기의 원본 private DB archive를 이번에 모두 재개봉하지는
않았으므로 실기 결과에는 저장소의 검증 기록에 의존하는 범위가 있다.

| 요구 | 유지한 판정의 근거와 한계 |
| --- | --- |
| AT-01 식별 | `tests/core.test.ts`의 ID·중복·gap·재시작과 기존 실제 원장 기록. 단위 검사를 전체 외부 시스템 증명으로 확대하지 않음 |
| AT-02 상태 | `recovery-http.test.ts`·`source-availability.test.ts`, 실제 native 성공/취소·수집 실패 시 원장 보존/노출 차단 |
| AT-03 복구 | HTTP 단절·cursor/gap·중복 검사, 실제 native cursor17 재접속. PC 전체 재부팅과 구별 |
| AT-04 Trail | `native-files-verification.json`·`track-browser-verification.json`: 실제 파일/산출물·hash·누락·철회, 전체 파일 시스템 수집은 아님 |
| AT-05 Trace | `implementation-qa.md`·`native-flow-verification.json`: 실제 도구·native event·없는 호출 ID unknown. 모든 모델 요청의 비용/토큰 측정은 아님 |
| AT-07 조회 인가 | `projects-live-verification.json`·`native-binding-verification.json`: 현재 owner의 Project 철회/복구·교집합·다른 actor 거부. 추가 사용자 연결은 별도 |
| AT-08 화면 | `ui-state-verification.json`·`track-browser-verification.json`: 네 화면/빈/503/단절/철회/만료·favicon·키보드. 실제 조직 membership 철회와 구별 |
| AT-10 승인 | `native-approval*-verification.json`: allow_once/session·deny·expiry·revocation·파일/receipt. 현재 owner·명시 QA 범위 |
| AT-11 배정 | `native-task-assignment-verification.json`: 실제 Task·기존 Session2·Run2·input hash/수락/성공. 자동 subagent 조직화나 Task 수용 완료가 아님 |
| AT-13 보존 | `live-restore-verification.json`: 별도 실제 복원 DB/API·232Run/17,456event·cursor/receipt digest. 실제 pending/binding0은 fixture 보완, 운영 DB 전환 아님 |
| AT-16 SNB | `implementation-qa.md`: 960px pointer/keyboard/복원·390px drawer/Escape/focus. 기존 실제 CUA 기록 재사용 |
| AT-17 Entra | `track-browser-verification.json`·`track-server-verification.json`: Track 본인 동의/로그인/SSE/logout/재로그인·Basic/위조 차단. 현재 새 GUI 실기는 로그인 입력 대기 |
| AT-19 binding | `native-binding-verification.json`: 실제 Task A→B/revision/CAS/재시작·Run 성공과 Task todo 구별·철회 |
| AT-21 실제 관측 | `native-observation-verification.json`·모델 요청 운영 후속: 동일 실제 Run/17event/cursor와 재시작·원본 대조 |

AT-18은 현재 `session-relations.ts`의 조회 전후 원본 인가·grant 재검증,
`session-relations-flow.ts`의 명시 유형/참조 구분,
`flow-groups.ts`의 source-qualified 고유 Run 집계와 실제 QA 기록을 함께 확인했다.
현재 코드의 관계 API/client/flow/web·그룹 집계 기존 검사 40개를 재실행해
40개 통과·실패0·skip0을 확인했다(약 10.5초). 운영 동작을 새로 실행한 검사는 아니다.
Track `a3bb446`의 Windows/Ubuntu CI는 회귀 보조 근거이며 실제 교차 앱 수용을
대신하지 않는다. 테스트 개수를 진행률의 분자로 사용하지 않는다.

## 앞으로의 보고와 실행 순서

현재 수치와 행별 판정의 단일 원본은 [goal-status.md](goal-status.md) 상단이다.
과거 수치는 이력으로 표시한다. 이후 보고에는 수용 충족률과 함께 **직전 대비
새로 확인된 하위 단계, 아직 사용자 경로를 막는 조건, 다음 검사**를 명시한다.
새 하위 항목을 만들더라도 기존 상위 항목의 가중치나 분모를 바꾸지 않는다.

남은 임계 경로는 현재 identity/source·실행 authority/metadata 인가 연결 →
실제 WorkCoordinator/Projects 결과 연결 → desktop 접속과 Track 검토다.
원본 Demian 인증 이동·문맥 요약 GUI, 그룹 운영 GUI, 다중 장치 대시보드 검사는
각 요구의 잔여 조건으로 분리한다. 완료된 관계 renderer를 다시 전체 업무와
묶어 보류하지 않는다.

전체 완료 예상은 산정 불가, 일정 신뢰도 낮음이다. 아직 전체 업무의 첫 성공
실기가 없고 desktop 연결 경로와 운영 실행 구성이 미완료여서 날짜를 추정할
근거가 부족하다. 다음 재산정은 위 잔여 검사 중 실제로 닫힌 조건이 생겼을 때다.
이번 감사는 전체 goal 완료나 중단이 아니며 제품/서비스 배포를 변경하지 않는다.
