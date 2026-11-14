# Agent Track 구현 goal 기준표

## 현재 판정 — 2026-11-14 KST

**기존 수용 판정 15/21·71.4%를 유지한다. 전체 개발 완료율은 산정하지 않는다.**
상위 요구 동일 가중치·부분0이며 직전 대비0%p다. 기존 완료15개는 각 행에 적힌
owner/QA 범위의 누적 증거다. 이번 점검은 모든 완료 기능을 최신 운영 환경에서
재실행한 검사가 아니다. 71.4%를 운영 준비도나 남은 시간의 비율로 사용하지 않는다.

마지막 상위 증가(11월13일18:10)는 AT-18 판정 정정이었다. 그 뒤 새 상위 완료는
없다. 후속에서는 Track 운영 전환·보호 source 활성화와 실제 WorkCoordinator 실행을
진행했다. 같은 Projects 업무에 실제 결과를 먼저 첨부했고 Track에서 성공 Run과
이벤트8개를 확인했다. 기존 폴더 이동 처리도 수정·운영 반영해 같은 Execution의 Note
발행과 Projects 참조 연결을 완료했다. 현재 PC의 실제 화면 검토와 보호 원본의 상세
Trace 누락이 남아 전체 업무를 완료로 세지 않는다. 집계가 거친 문제와 실제 통합 미충족을
구분한다. [현재 실제 업무 근거](workflow-observation-2026-11-14.json)를 따른다.

후속에서는 [별도 native 상세 조회](native-run-evidence.md)를 구현했다. 기존 원장을
변경하지 않고 모델·범위별 usage·Run 시간·산출물 메타데이터·turn/item 참조를 표시한다.
Track 로컬 1,022개 통과/9개 POSIX skip, Persona 관련208개 통과, 임시 PostgreSQL의
Native57개 통과/별도 Assistant 환경1개 skip과 타입·별도 build를 확인했다. source는
Native9f45e6c/Personaf9f78ac에 고정했으나 세 서비스의 새 evidence 운영 경로와 실제 화면은
아직 미검증이다. 구현·검사 결과를 AT-12/14의 사용자 수용 완료로 계산하지 않는다.
새 Persona PR CI43493618449는 네 job 모두 step 시작 전에 실패했다. GitHub annotation의
사유는 계정 결제 실패 또는 spending limit이다. CI 성공을 주장하거나 반복 재실행하지 않는다.
Track17e5ff0의 CI43494168243은 Windows·Ubuntu 모두 성공으로 종료됐다. Native/Assistant/
Track 후보를 별도로 동결했고 운영은 교체하지 않았다. 현재 PC 브라우저 제어는 연결됐으나
해당 프로필이 Entra 비밀번호 단계여서 사용자 로그인을 기다린다. 과거 화면 캡처 실패를
현재 앱 결함이나 로그인 실패로 단정하지 않는다. AT-09의 실제 계약 공백과 구현 순서는
[개발계획](development-plan.md#at-09-재개재시도-구현-순서)에 구분했다.

AT-09 후속 소스 Native d3ffeb9는 재시도/재개/계속 실행의 후속 Run·불변 명령
receipt·Session head·현재 권한 fence와 복구를 구현했다. PostgreSQL 격리 suite72개
통과/선택환경2개 skip, 개인/배포 권한 오류 재현·수정 후 일반 HTTP6개 통과를 확인했다.
Track에는 strict 계약·일반 owner transport를 추가했다. 후속 Assistant e9c6f7c에
owner intent·과거 시도 history·새 correlation/ref·원본 명령 복구를 추가했고, 관련241개와
실제 PostgreSQL/Assistant schema·signer·gateway 연동3개가 통과했다. Native 후속
paired 검사 source는2c113bb다. 후속 Persona2aefb07·Track의 보호 reader에는 과거 시도
조회와 실제 correlation별 native 경로를 추가했다. 현재 ref가 바뀌어도 원본 Run의
인가·이벤트 원장을 보존하고, 잘못된 history는 옛 경로로 되돌리지 않고 거절한다.
[조회 계약](assistant-attempts.md)과 [단계 검증](assistant-attempt-verification.json)을 따른다.
후속 Flow source에는 실제 시도 node·요청 intent edge·역할 시도 그룹과 네 보기의
탐색 연결도 추가했다. 서로 다른 Native 출처의 그룹 중첩과 선택 Run 충돌 누락을
재현해 수정했고 관련64개·타입 검사가 통과했다. 아직 운영 반영·인증된 사용자 화면·
제어/복구 broker와 UI·실제 제공자 검증이 남아 AT-09 완료로 세지 않는다.
[Flow 검증 범위](assistant-attempt-flow-verification.json)를 따른다.
후속 [일반 Native 명령 UI](run-successor-controls.md)는 검토 저장·명시 확인·단일 전송·
응답 유실의 같은 ID 조회를 구현했다. 실제 로컬 HTTP에서 입력·Task 연결·기존 이벤트
보존과 credential I/O 중 권한 철회 경합을 검증했다. 일반 명령의 [접수 Flow 관계](native-command-flow.md)도
현재 owner·양쪽 Run·Projects 범위를 확인해 합성하는 source를 추가했다. 보호된 owner 제어
연결과 운영·인증 화면·실제 제공자 수용은 남아 있다. 취소 권한이나 기존
reader 권한을 새 명령 권한으로 사용하지 않고 운영 설정도 활성화하지 않았다.
[후속 근거](assistant-run-command-verification.json)를 따른다. Track4233d3b의
CI43506947505는 Windows·Ubuntu의 실제 검사 단계 모두 성공했다. 이는 후속 source나
배포 검증을 대신하지 않는다.
[현재 구현 단계](native-run-commands.md)와 [검증 근거](native-run-commands-verification.json)를 따른다.

보호 명령 후속은 [전용 조정자 writer](assistant-command-bridge.md)의 strict 계약,
HTTP adapter와 명시적 설정 검증을 추가했다. reader/proxy credential과 별도로
현재 owner·principal·grant revision을 확인하고, 전송 전 중단과 전송 후 불확실성을
구분한다. 같은 operationId 조회 외 자동 POST 재전송은 없다. 실제 localhost HTTP와
전체 1,130개 검사 중1,120통과·실패0·기존skip10, 타입 검사를 확인했다. 영속 검토/
확인/복구 broker·화면·운영 writer 활성화는 아직 없으며 AT-09 수용으로 계산하지 않는다.
직전 접수 Flow source95c1ed6의 CI43530889791은 Windows·Ubuntu 모두13단계 성공했다.

후속 [조정자 명령 UI·복구](coordinator-command-controls.md)는 영속 검토·CAS 한 번
전송·같은 ID 조회·현재 역할/선택 Run/revision 대조를 구현했다. 동시 GET이 전송 전
차단 근거를 없애던 경합과 목록의 반복 원본 조회를 재현·수정했다. 합성 브라우저에서
검토/확인·응답 유실·권한 만료 동작을 확인했으며 화면 screenshot은 실패했다.
최종 전체1,167개 중1,157통과·실패0·기존10skip, 관련36개·타입·별도 build를 확인했다.
Persona32176e9는 원본 writer와 이전 버전 호환 감사 side table을 PR22에 게시했고
관련674개 중662통과·기존12skip, build/타입/format을 확인했다. 새 Persona CI 두 실행은
모든 job이 검사 step 전에 실패했으므로 코드 검사 통과로 계산하지 않는다. Track의
전용 client sourcec8734db CI43533521387은 Windows·Ubuntu 모두13단계 성공했다.
운영 writer·새 세 서비스 전환·실제 provider/인증 화면 수용은 남아 AT-09는 부분이다.

Track 후속 후보88b2557과 전환기9e5dfac의 Windows·Ubuntu CI는 각각 모두 성공했다.
현재 원본 SQLite 백업 한 개로 후보·이전 버전의 cold QA를 완료했고, 정확한 명령 원장
객체6개·기존 행·WAL 포함 복귀와18개 웹 자산을 대조했다. 실제 전환 전 검사가 정상
서명 조회의 nonce 추가를 전체 DB 변경으로 거부해, 명시적인 MVCC 기반 nonce 추가
보존 검사를 보완했다. 기존 nonce4,477개와 나머지 업무 table41개·schema·sequence·
security 일치를 확인했다. 관련93개·타입 검사가 통과했다. 운영 변경 전의 새 원본
관측 기준만 고정했으며, 업무 DB·runtime·권한은 변경하지 않았다.
[전환 검사와 범위](track-command-schema-rollout.md)를 따른다. 전체15/21·71.4% 유지,
전체 ETA 산정 불가·신뢰도 낮음이며 실제 소비자 전환·인증 화면이 다음 수용 검사다.

첫 후보88 운영 전환은 마지막 저장 보기 검사에서 실패해9639375로 자동 복귀했다.
복귀 PID74952와 원본 config/pointer·이력·Native·다른 프로세스 보존을 확인했다.
격리된 실제 원본 연결에서도 두 Task 저장이10초503으로 재현됐다. 전체 원본 갱신을
6→2회로 묶되 최종 권한 재확인을 유지한 수정 후, 같은 격리 요청이5.8초200과 삭제200을
반환했다. 이 결과는 운영 수용이 아니며 새 후보 전환이 남아 있다. 현재 Chrome의
새 Entra 화면은 비밀번호 입력 단계로 확인했고 사용자 로그인 응답은 아직 없다.

| 전체 업무 AT-14의 단계 | 현재 확인된 상태 | 다음에 닫을 조건 |
| --- | --- | --- |
| 전용 native 실행 환경 | API8081·worker·현재 binding 운영. API16328/gate22040. 원본 API15940·worker42184 유지 | 기존 운영 근거 재사용. 기동 확인만 반복하지 않음 |
| 보호 metadata 원본 조회 | 실제 WorkCoordinator 성공 Run60cca68d의 metadata·이벤트8개가 현재 인가된 reader를 거쳐 Track에 수집됨 | 원본 step/tool/lineage 식별자를 제공하는 계약·현재 흐름 표현 보완 |
| Assistant reader | 9382c9c 운영·PID266620. 기존 전용 credential의v2 reader로 실제 업무의 보호 Run과 완료 Execution 조회 | 보호 원본 상세 관측과 현재 PC의 인증된 화면 대조 |
| 후보 보존·복구 | 현재 Work45,719,552B/Runtime5,203,615,744B를 암호화·복원하고 같은 사본에서 후보 시작·31/64schema·업무 행을 대조. 운영 전환 후 파일68개·다른12개 서비스·renderer 보존과 같은 PID boot adoption 확인 | 이전 실패 보존. 정확한 Task3revision/UI6event 역산 hash와 발행 대기 원장 pin 적용. 물리 재기동/crash는 미실기 |
| Track 수집·Trace | 9639375 API/web 운영·PID78884. 설정6source·새 보호 source connected. 같은 Run/Projects binding·cursor=highWater=8·gap없음 확인. Trace steps0/tools0 | 이벤트의 step/tool ID 부재를 해결해야 상세 Trace를 제공할 수 있음. 수집 성공을 상세 시각화 성공으로 계산하지 않음 |
| 실제 전체 업무 | 같은 Execution/Note operation 재개로 Note 본문 hash·첨부2개·인덱스와 Projects의 현재 결과/Note 참조를 독립 재조회. Execution completed·Task revision5/in_review. 모델·Run·Task 재생성0. Track의 기존8event·역사 binding revision3 보존, 현재 Task revision5의6node/5edge/실행group1 확인 | 현재 PC 화면에서 같은 업무 선택·그룹 탐색을 검토. 상세 native Trace의 원본 식별자·관측 계약 보완 |
| desktop 접속 | 대상은 현재 Windows pydemia-desktop PC로 확인됨 | 같은 실제 업무 접속·선택 대조. 별도 앱/bridge 계약을 대기 조건으로 만들지 않음 |

현재 구현 main `964b031` CI43481460685는 Windows·Ubuntu 모두 성공이다. Track 운영
release는9639375이고 Assistant는9382c9c다. 앞선80b9d3d 보존 도구는 실제 live worker의 registry3종에 한해 checked_at 단조
갱신을 판별하며 나머지 행·설정·권한·schema 대조는 유지한다. 실제 두 snapshot과
관련41개 검사로 확인했다. 새964b031의 정지 발행 대기 원장 pin은 Python41개와 운영
중지 검사 SQL 전체의 읽기 전용 조회로 확인했다. 독립 리뷰의 실행 inactivity와 lease
writer 구분도 반영했다. Persona9382c9c의 Note 수정은 관련260개·서버 타입 검사와
동일 tree의 PR CI43478983163 네 작업을 통과했고 실제 같은 발행을 완료했다.
별도 push43478970112의 Avatar 포커스 실패59/60과 73aabbb Windows 관찰 timeout 실패는
보존하고 재실행하지 않았다.
테스트 수·commit 수·백업 성공·HTTP200을 사용자 업무 완료 수로 환산하지 않는다.

보고는 `수용 판정 / 이번에 닫힌 사용자 조건 / 현재 실패·미지원 / 다음 수용 검사`로
구분한다. 같은 검사를 새 변경·실패 없이 반복한 것은 진척으로 세지 않는다.
전체 완료 예상은 **산정 불가·신뢰도 낮음**이다. 첫 실제 통합 업무와 AT-09의
원본 재개/재시도 구현 범위를 확인한 뒤 재산정한다. 아래21개 요구의 범위·분모는
유지하며 부분6개(AT-06/09/12/14/15/20)를 다음 검사의 원본으로 사용한다.

[이번 감사와 관찰 한계](progress-audit-2026-11-13.md#2026-11-14-0151-kst-진척-정체-판정)와
[후속 운영 증거](assistant-native-observation-operating.json)를 따른다. 새 Assistant의
운영 guard가 같은 프로세스를 adopt했고 기존 app/renderer unit의 enabled 상태를
확인했다. 물리 재기동/crash 실기는 아니다. 이전f79 이미지는 중지한 채 보존했다.
아래 첫 번째 요구별21행 표는 현재 수용 판정이며, 설명·시점별 이력에서 위 상태와
다른 운영 PID·revision·실패·미확정 desktop 문구는 당시 기록이다.

## 요구별 수용 판정

| 요구 | 수용 조건 | 상태·증거 |
| --- | --- | --- |
| AT-01 | 원본 ID·재수신·충돌 방지 | 검증 완료. `tests/core.test.ts` ID/충돌·dedupe·재시작·binding 검사, 실제 Codex 211 Run의 source/run UNIQUE 원장 |
| AT-02 | snapshot과 실시간 실행 상태 일치 | 검증 완료. `recovery-http.test.ts` 초기 snapshot/SSE 일치·할당/실행/권한 대기/취소 중/실패 구분. 실제 native 성공·취소 종료와 공개 Trace 대조. `source-availability.test.ts` 시작 시 미인가 캐시 숨김·전 범위 확인 뒤 단절 시 stale·거부 후 새 스트림 인가·단일 SSE 실패의 connected 덮어쓰기 방지. 운영 API 단절 시 native 원장19개 보존/노출0·이벤트404와 공개 사유 안내 대조 |
| AT-03 | durable cursor·중복·역순·gap·재시작 복구 | 검증 완료. 실제 HTTP 단절 후 DB 재시작·cursor1 재수신·gap2 보충·3 dedupe. stale/forbidden/재인가 fixture와 실제 native cursor17 재시작 확인 |
| AT-04 | Trail·파일·산출물 근거와 수집 범위 | 검증 완료. 실제 answer.txt metadata·원본/공개 Trail 대조와 native 파일 편집4Run 조회. 성공3파일의30byte/hash·요청/완료seq, 거절/만료는 실패·파일 없음 구분. 공개 Trail·390px/Tab·Project 철회404/경로 제거→복구, 원문 비노출·이벤트 digest 불변·조회 한도 검사 |
| AT-05 | 실제 Run·step·tool Trace, unknown 보존 | 검증 완료. 실제 Codex Run13event/5개 paired tool·관측 구간 공개 대조. 실제 native17event와 없는 step/호출 ID unknown 표시. invocation/call tuple·int64·모호함·시각 역행 fixture 통과. native212event·lineage9·도구3결과(실패1/성공2)와 Flow 대조·원장 불변, 요청≠실행 시작 구별 |
| AT-06 | 동일 원본 선택 deep link와 미지원 안내 | 부분. Demian Session href·Run link 미지원 안내. 원본 웹의 무인증 Basic401과 후속 인증 root/context200을 구별한다. 허용 인증으로 동일 Session/Task가 선택되는 브라우저 이동은 미검증이다. 무인증401만으로 새 인증 구현이 필수라고 단정하지 않으며 공개 Track Entra 정책은 유지 |
| AT-07 | 계정/프로젝트 권한 교집합·metadata allowlist | 검증 완료(현재 소유자 배포). 별도 owner-bound Projects reader·현재 native ACL/Project ID 교집합. 실제 scope7→6에서 API404·공개 업무 비노출→7 복원. 다른 Track actor의 owner key 차용 거부·bound Run 비노출·원문 제외 fixture. 추가 사용자 native principal은 별도 구성 필요 |
| AT-08 | 네 화면·빈/오류·접근성·favicon 실기 | 검증 완료. 공개 네 보기·favicon bytes/hash·SNB/Map keyboard/mobile. 분리 QA의 네 빈 보기·503/재시도·stale·철회·401 만료 후 private cache/URL 제거 실기. 실제 Entra membership 철회와 구별 |
| AT-09 | capability 기반 명령·idempotency·receipt·단절 | 부분. native cancel 실기·동일 receipt, unknown/철회/만료/재시작·중복 방어와 공개 UI 취소 대조. 후속 Native 명령·Assistant owner 시도/참조·같은 명령 복구와 과거 시도 Flow source·격리 검사 완료. 일반 Native 검토·전송·복구 broker/UI·접수 Flow source·HTTP 검사 완료. 보호된 owner 제어·운영/인증 화면·실제 제공자 수용은 미완료 |
| AT-10 | 범위·만료·철회·runtime 재검증 승인 | 검증 완료(현재 소유자 배포). 실제 native fileChange allow_once·동일 receipt·30byte 파일, 공개 UI deny·파일 비생성, 원본 자동만료/결정0·late 요청 차단. bound Project reader 철회 시 원문/세 API404→복구, 모바일/Tab·만료 후 인자 제거. 실제 allow_session 후 도구2회/승인 요청1건·새 QA 파일2개, 다른 실행/업무 상태와 구별 |
| AT-11 | 원본 업무 생성/배정·수락 확인·실패 보존 | 검증 완료(현재 소유자·명시 QA 범위). 공개 UI Task1건 생성·최신 내용/정책 검토 후 기존 native Session2개에 Run2건 배정, exact input hash·request-status·binding·실제 성공·cursor 대조. Task r1/todo 불변. unknown/새 UUID 차단·접수 후 binding 복구·재시작/backup·철회 직전 무전송 fixture.390px/Tab·미제출 초안 보존·실제 reader 철회 시 본문/초안/Run ID 제거→복원. `task-assignment-verification.md` |
| AT-12 | typed Map·근거·목록·순환/고립·node group과 깊이 탐색 | 부분. 중첩 그룹·업무 묶음·상세·접기·내부 선택·상위/깊이 탐색·네 보기 범위·저장/복원 구현과 운영 배포, 실제 managed-child·nested coordinator·병렬 합류·Windows→Linux peer의 node/edge/그룹 대조. 병렬 대표선 마우스 선택은 통과. 배포된 네 보기 공통 범위/저장 복원의 사용자 동작 대조와 peer 대표선 포인터 선택 성공 확인이 남는다(기존 시도는 viewport 제약, 제품 결함 여부 미확정). 기존 합성 GUI·운영 owner API 근거를 재사용하며 특정 Entra 재로그인·스크린샷 export·추가 기기 재접속·전체 desktop/SDK 업무를 독립 추가 게이트로 삼지 않음 (`native-parallel-flow-verification.json`, `native-peer-processing-verification.json`, `saved-flow-views-verification.json`, `model-request-trace-verification.json`) |
| AT-13 | 보존·backup/restore·cursor/receipt 정합 | 검증 완료. 실제 online backup→별도 복원 DB→API232Run·17,456event 대조. binding/pending receipt·archive tombstone fixture. 자동 삭제 비활성·명시 archive 정책. 운영 DB 전환/재난 훈련과 구별 |
| AT-14 | Assistant→Demian→desktop→Track 실제 업무 | 부분. Assistant9382c9c·Track9639375/6source가 운영 연결됐다. 실제 Executionf8a9e44f/Run60cca68d/Taske4470864를 유지해 모델 성공→Projects 결과 선첨부→Note 발행→Projects Note 참조 연결→Track 완료 관측의 API 경로를 검증했다. Note 본문·첨부2개·인덱스와 실제 Projects revision5/in_review를 재조회했다. 기존8event/역사 binding3은 불변이고 현재 Task/Execution/역할/Run의6node·5edge·실행group1을 실제 API로 projection했다. 현재 PC 화면 관측 도구가 실패해 인증된 GUI 선택·그룹 탐색은 미검증이며 상세 native Trace steps0이다 (`workflow-observation-2026-11-14.json`). 기존 위임/배포 근거도 보존한다 |
| AT-15 | 전체 프로젝트 기본·필터·장치/수집 누락 | 부분. 여러 저장소/native workspace·필터/해제·선택 유지 및 Windows↔Linux 실제 peer 전송/ACK·두 번째 호스트의 처리 Run1/49event를 대조. 남은 조건은 같은 기본 대시보드의 여러 장치 동시 조회·필터 해제 후 선택/상태 보존. 특정 desktop 구현이나 전체 업무 수용을 이 요구에 추가하지 않음 (`native-peer-transport-verification.json`, `native-peer-processing-verification.json`) |
| AT-16 | SNB 접힘/크기/키보드/보존/모바일 실기 | 검증 완료. CUA 로컬 QA 960px: sidebar244/main700→접힘main944; pointer272·keyboard+4·reload272; 390px drawer340·Tab 순환·Escape focus 복귀 |
| AT-17 | Track Entra 로그인/API/SSE/logout·공개 Basic 차단 | 검증 완료. 본인 consent(조직 동의 제외), 공개 로그인·snapshot/SSE·logout 후 비노출·재로그인. `track-server-verification.json` 공개401/위조·Basic 거부 |
| AT-18 | invocation/cowork/managed-child/peer를 구별·고유 Run 집계 | 검증 완료(현재 인가된 QA 범위, 이번 감사에서 정정). 실제 native lineage9·도구 join3·managed-child17event·nested coordinator63event·cowork 병렬/합류77event·Windows→Linux peer49event의 원본 ID/receipt·명시 관계와 source-qualified 고유 Run 집계를 대조. 조회 전후 인가·grant 재검증 구현 확인. 운영 SDK/worker 전환·전체 업무는 AT-14/15의 통합 잔여 작업이며 본 요구의 완료 조건에 추가하지 않음. protected Assistant 위임 Run metadata 수집은 운영 연결됐으나 이번 원본 이벤트에는 invocation/tool 식별자가 없어 상세 관계·Trace 근거로 확대하지 않음 (`session-relations-verification.json`, `native-managed-child-verification.json`, `native-parallel-flow-verification.json`, `native-peer-processing-verification.json`, `workflow-observation-2026-11-14.json`) |
| AT-19 | Projects 원본·Run 단위 binding 이력·서로 다른 완료 | 검증 완료. 실제 native QA Task A→B로 명시 Run 연결·재연결, A 원본 revision2와 당시 revision1 보존, stale revision409·동일 receipt·재시작 이력2건. Run 성공/Task todo·agent report/검증/수용 unknown 구별. bound Project 철회 시 공개 비노출·네 API404→복구 |
| AT-20 | Demian/Projects 문맥 요약·인증 조회·Track 장애 격리 | 부분. Projects 원본 운영 UI/동일 Map 이동·장애 중 편집/복구와 Demian 분리 웹의 실제 Run/장애 격리 확인. 원본 공개 Web3001은 이미 교체됐고 context200·connected·동일 Session/Run3·wrong actor403을 HTTP로 대조했다. 기존 Basic gate를 유지 중이며 원본 인증 브라우저 GUI·동일 선택 이동·공개 웹 장애 격리 실기가 남음. 과거 Docker 장애를 현재 보류 원인으로 사용하지 않음 (`projects-context-native-ui-verification.json`, `demian-context-native-ui-verification.json`, `demian-public-web-promotion-verification.json`) |
| AT-21 | 실제 Demian 실행을 Track에서 관측하고 재접속 대조 | 검증 완료. 실제 native Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c` 성공, canonical SSE17개·cursor17/highWater17. 제품 재시작 후 동일 원장·공개 Trace seq17 대조 |

## 시점별 이력

### 직전 상세 설명 — 위 현재 판정 우선

현재 기준: **2026-11-14 KST 진척 재점검**. 수용 항목 **15/21·71.4%**
(상위 요구 동일 가중치, 부분0). 이 수치는 개발 작업량·운영 준비도·남은 시간의
비율이 아니다. 기존 완료15개는 명시한 owner/QA 범위의 누적 증거이며 이번에
모든 기능의 운영 동작을 새로 실행한 결과가 아니다.

후속 운영 반영: 새 native API8081과 공개 gate를 전환했다. 원본 API8080과
worker는 같은 PID로 유지했고 새 API의 공통 시작 guard adoption과 공개 metadata
전달·무서명/비정상 query 거부를 확인했다. Assistant0691e1a는 기존 env/mount/
네트워크를 보존한 정지 후보이며 아직 운영 교체 전이다. Track 새 source 활성화와
실제 통합 업무도 남는다. [운영·후보 근거](assistant-native-observation-operating.json)를 따른다.

이번 점검에서 요구 행21개·고유 ID21개·완료15/부분6을 다시 집계했다. 상위
수용률 변화는 **0%p**다. 전체 개발 완료율은 산정하지 않는다. 마지막 상위 집계
증가는 AT-18 판정 정정이었고, 이후 Assistant 운영 전환은 AT-14의 하위 진전이다.
후속 구현에서 Track 수집기가 새 `nativeMetadata()`를 호출하도록 연결했다.
실제 HTTP/SQLite를 거쳐 보호 Run·현재 Projects 업무 연결·Trace 도구 시작/완료
표시까지 검사했다. upstream 업무 데이터는 합성 fixture이며 실제 운영 업무는 아니다.
Demian `db861e8`의 격리 PostgreSQL44개와 Persona `0691e1a`의 coordinator/gateway184개가
통과했다(skip0). 새 코드의 운영 배포·현재 운영 업무 수용은 아직 미완료다.
[연결 구조와 검증 범위](assistant-native-observation.md)를 따른다.

직전 점검에서 관련 테스트12개 통과/실패0/skip0을 재확인했다. 타입 검사는 새
테스트 fixture의 optional 속성에 `undefined`를 명시해 실패했으며, 미지원 port를
실제로 생략하도록 고친 뒤 다시 통과했다. 이 검사는 로컬 계약·권한 경계 검사다.
그 뒤 새 metadata 경로의 실제 PostgreSQL 통합을 확인했다. 운영 배포·전체 업무
실기는 아직 미검증이다. 전체 회귀에서는 새 사전 조회가 다른 actor의403을503으로
바꾸는 회귀1개를 발견해 수정했으며, 해당 API/수집25개가 통과했다.
[재점검 상세](progress-audit-2026-11-13.md#2026-11-14-kst-현재-작업본-재점검)를 따른다.

이번에 닫힌 조건은 **Assistant 운영 전환과 보존 검증**이다. 실제 f79a5b1 이미지가
운영 중이며 같은 현재 역할로 공개 native API의 서명 GET3개를200으로 확인했다.
운영 DB의4개 새 빈 테이블/9개 schema object·기존 업무 행·보고서와 파일68개,
다른12개 서비스 및 renderer를 대조했다. 기존 앱은 중지한 채 보존했다.

기동 직후 Docker의 OomKillDisable false→null 표현 변화로 전환 검증이 실패했다.
HostConfig 전체 hash를 대조해 다른 변화가 없고 기존 clone verifier도 통과함을
확인했다. e6ceacf에서 후보에 한정한 기존 정규화 계약을 적용해33개 회귀와 양쪽
CI를 통과한 뒤, 실행 중인 후보·renderer·budget·avatar를 재시작 없이 같은 PID로
adopt했다. 원본·다른 역할의 계약을 완화하거나 DB·인증을 복원하지 않았다.
실제 power reboot/crash 복구나 새로운 인증 GUI 실기를 수행한 것은 아니다.
[운영 근거](assistant-native-promotion-verification.json)를 따른다.

**남은 핵심 경로:** 새 protected metadata API·Assistant reader·Track source 운영 반영 → 실제 지속
WorkCoordinator 업무 → Projects 결과 선연결·Note 참조 → desktop 접속·Track 검토.
재개/재시도는 원본 실행 기능부터 미지원이며 나머지 사용자 동작 실기도 아래에서
추적한다. 새 모델/운영 Task·Note·Run은 이번 전환에서 생성하지 않았다.

전체 완료 예상 **산정 불가·신뢰도 낮음**. 첫 운영 통합 업무의 실제 결과와
확인된 pydemia-desktop PC의 동일 업무 접속 실기이 다음 일정 재산정 근거다. 최신 요구별 판정은
바로 아래 표를 사용하고, 뒤의 시점별 기록을 현재 상태로 읽지 않는다.

완료: AT-01/02/03/04/05/07/08/10/11/13/16/17/18/19/21.
부분: AT-06/09/12/14/15/20. 분모와 가중치는 변경하지 않았다.

| 남은 요구 | 직전 대비 확보한 단계 | 다음 수용 검사 |
| --- | --- | --- |
| AT-06 앱 간 이동 | 원본 웹 교체·Session URL/미지원 안내·인증 HTTP200 | 허용 인증으로 동일 Session/Task 선택 이동. 무인증401만으로 새 인증 구현 필요를 단정하지 않음 |
| AT-09 실행 제어 | 실제 취소·receipt/중복 방어 | 원본 재개/재시도 계약·실행 지원 |
| AT-12 그룹 탐색 | 실제 child/병렬 합류/peer·네 보기 범위·저장/복원·운영 배포 | 배포된 공통 범위·저장 복원의 사용자 동작 대조, peer 대표선 포인터 선택. 특정 Entra 재로그인·스크린샷 확보 자체는 추가 게이트가 아님 |
| AT-14 전체 업무 | Projects·전용 native API/worker·Assistant 운영, 새 보호 metadata의 실제 SQL/HTTP/Track 원장·Trace 연결 검사 | 새 metadata 경로 운영 반영 → 실제 WorkCoordinator/Projects/Note 업무 → desktop/Track 검토 |
| AT-15 전체 대시보드 | 여러 프로젝트·실제 두 호스트 처리 | 한 기본 대시보드에 여러 장치 세션 함께 표시·필터 해제/선택 보존. 여러 클라이언트 동시 접속 요구가 아님 |
| AT-20 문맥 요약 | Projects 운영, Demian 분리 실기·원본 웹 HTTP 반영 | 원본 인증 GUI·동일 선택·공개 웹 장애 격리 |

아래 표가 현재 요구별 판정의 단일 원본이다. 단일 owner·명시 QA 등 증거의
범위를 유지한다. 매 보고는 이 충족률과 함께 새로 확인된 하위 단계·남은 사용자
경로·다음 검사를 적으며, 테스트/커밋 수를 전체 진척으로 환산하지 않는다.



### 23:19 이전 운영·감사 기록

23:19 KST 후속: 아래22:51의 복원본 검사 실패 원인을 재현·수정했다. 같은
복원본의 후속 검사에서4개 새 빈 테이블/9개 schema object의 정확한 source DDL,
기존 행과 검토된 runtime 시작 delta를 대조했다. 새 백업·앱 기동은 반복하지
않았다. 현재13개 component와 선택 파일68개를 보존한 새 lifecycle preflight도
통과했다. 새 guard 설치·Assistant 운영 전환·전체 업무는 아직 미완료다.
수용15/21·71.4% 유지, 전체 ETA 산정 불가·신뢰도 낮음이다.
[현재 전환 준비 근거](assistant-native-promotion-verification.json)를 따른다.

## 2026-11-13 22:51 KST 재점검

**집계는 15/21·71.4%이나, 제품 전체 개발 완료율은 산정되지 않았다.** 아래
21개 요구 행을 직접 집계해 누락·중복 없이 완료15/부분6을 확인했다. 동일 가중치,
부분0이라는 기존 계산은 유지한다. 기존 완료는 각 owner/QA 범위의 누적 증거이며
이번에 15개 기능의 운영 동작을 모두 다시 검사한 것은 아니다.

| 현재 판단 대상 | 확인된 상태 | 아직 닫히지 않은 조건 |
| --- | --- | --- |
| 전체 사용자 업무 AT-14 | Projects 결과 계약·Demian 전용 API/worker 운영 반영. 실제 Assistant 후보의 인가 조회 통과 | 운영 Assistant 전환·protected Run metadata 연결·WorkCoordinator→Projects→Note→desktop→Track 전체 실기 |
| Assistant 운영 전환 | 후보 이미지와 비활성 container 준비. 실제 Work 45.7MB/Runtime 5.20GB 백업·격리 복원 검증. 복원본의 전체 후보 앱 health200 | 후속 복원본 DB 검사는 `ERR_SQLITE_ERROR: unable to open database file`로 실패. 검증기 원인 조사·수정 및 정확한 DDL/기존 행 대조, 현재 boot guard 갱신 필요. 앱 기동 성공을 전환 완료로 세지 않음 |
| 원본 실행 기능 AT-09 | 실제 취소·receipt·중복 방어 | 재개/재시도는 원본 계약·실행 기능부터 미지원 |
| 그룹/기본 대시보드 AT-12/15 | 관계·그룹·저장 보기 구현/배포, 실제 Windows/Linux QA | 배포된 공통 범위·저장 복원/peer 선 선택, 같은 기본 대시보드의 여러 장치 표시·필터 해제 후 선택 유지 |
| 앱 이동/문맥 요약 AT-06/20 | 원본 URL·인증 HTTP·요약 구현 | 동일 선택의 인증 브라우저 이동, 원본 공개 웹의 Track 장애 격리 |

22:49 원격 readback에서 기존13개 component의 process/설정 계약을 대조해 불변을
확인했다. 운영 Assistant는 image `92ee2a2b…`를 유지하고 native 후보 `cb3df22a…`는
비활성이다. 로컬 API8080/8081·Track14345·gate3100·Web3001 listener도 기존 PID다.
실패한 preview의 멈춘 앱 container만 정리했으며 복원본과 실패 증거를 보존했다.
운영 Assistant 전환·원본 DB 복원·새 모델 요청은 하지 않았다.

직전 수치 상승 14→15는 AT-18 **판정 정정**이었다. 이후 실제 운영 기반 진전은
AT-14 내부에 누적됐지만 사용자 전체 업무의 새 성공은 없다. 따라서 현재의
정체에는 거친 집계 단위와 실제 통합 미완료가 함께 작용한다. 이후 보고는
`완료 요구 수 / 새로 닫힌 사용자 조건 / 현재 실패·미지원 / 다음 폐쇄 조건`을
함께 제시한다. 준비·검사 건수에 사후 점수를 주어 개발 완료율을 만들지 않는다.

전체 완료 예상 **산정 불가·신뢰도 낮음**. 다음 예측 갱신은 Assistant 운영 전환,
인가된 관측과 첫 지속 업무의 실제 결과, desktop 접속 계약 확인을 근거로 한다.
다음 즉시 작업은 새 백업/앱 기동을 반복하는 대신 보존된 복원본의 후속 검사
실패 경계를 바로잡는 것이다. 아래21:46 기록은 그 시점의 이력이다.

## 21:46 기준 및 요구별 누적 판정

현재 기준: 2026-11-13 21:46 KST 운영 실행 연결 후속. 운영 도구 코드 `ae65c07`,
Track 운영 코드 `a3bb446`. 소스와 운영 revision을 구분한다.
후속 테스트 경로 보정 `cc06da0`은 Windows·Ubuntu CI `43429197842`를 통과했다.

**수용 항목 충족률 15/21·71.4%** (상위 요구 동일 가중치, 부분 항목 점수0).
11월13일18:10 감사에서14/21·66.7%를 정정했으며, 이번 운영 후속은15/21을 유지한다.
개발 작업량·운영 준비도·남은 시간 비율로 사용하지 않는다. 전체 교차 앱 업무는
아직 미검증이다. 완료 예상은 산정 불가, 일정 신뢰도 낮음이다. Assistant 운영
전환·인가된 실행 관측·WorkCoordinator/Projects 결과·desktop/Track 전체 실기가 주요 전제다.
[감사 근거와 한계](progress-audit-2026-11-13.md)를 따른다.

**제품 전체의 개발 완료율은 이 수치로 추정할 수 없다.** 15개는 기존에 명시한
owner/QA 범위의 수용 증거를 누적한 개수이며, 현재 운영 revision의 모든 기능을
이번에 다시 실행한 결과가 아니다. 작은 기술 요구와 전체 교차 앱 업무가 각각
1점이어서, 남은 6개가 작업량의 28.6%라는 뜻도 아니다. 현재 사용자 핵심 경로인
`Assistant 지시 → Demian 실행 → desktop 접속 → Track 검토`의 전체 통과 기록은 없다.

11월13일19:11 KST Projects 결과 계약의 배포와19:13~19:16 기존 소비자 확인에
이어, 아래21:46 후속의 전용 실행 경계를 운영 연결했다. AT-14의 전제 진전이며
AT-14 자체를 완료하지 않았다. 마지막 상위 항목 변동은 같은 날18:10의 AT-18 판정 정정이다.
이후에는 수치와 함께 **새로 닫힌 조건 / 실제 기능·연동 부족 / 남은 실기 / 다음
판정 조건**을 보고한다. 커밋·검사 증가를 제품 개발 완료율로 바꾸지 않는다.

21:46 후속: 원본 백업의 별도 복원본에서026만 적용해 보존/시작 검사를 확인한 뒤
원본 DB에 같은 함수·trigger를 추가했다. 실제 전용 Workspace/Session과 현재
역할 binding을 구성하고, Demian `c439341`의 동결 API8081/worker를 가동했다.
공개 `demian.pydemia.ai`에서 서명 capability200·unsigned403, 기존 브라우저200·
무인증401을 확인했다. 기존 API8080과 Track 수집은 유지하며 일반 bearer로 새
보호 Session을 읽으면404다. 기존19Run/810event·기존 행/DDL/sequence/역할은
보존했다. 새 Session의 journal, worker의 빈 managed-child catalog 등 새 metadata는
별도로 대조했다. Persona `f79a5b1` 후보 이미지에서 Linux→공개 HTTPS의 실제
host loader/gateway 조회3개도200이었다. 운영 Assistant는 아직 전환하지 않았다.
운영 Task/Note/Run·모델 요청은0이며 전체 업무 수용으로 세지 않는다.
[운영 연결 근거](demian-dedicated-service-verification.json)가 아래 과거 이력보다 우선한다.

실행 연동 후속: Projects 운영 앱을 검증한 후보 이미지 `7d571b20`으로 전환했다.
기존 다섯 설정 layer·인증 규칙·환경·마운트·네트워크·다른 세 역할을 보존했고,
DB 스키마와34테이블의 전환 전후 데이터 지문도 일치했다. 최신 백업의 격리 복원,
두 실제 앱의 서명 HTTP·metadata 호환 복귀, 현재 Assistant 서명 클라이언트의
새 계약 지원200/위조401·Track7프로젝트/기존 의존관계1건200을 확인했다.
QA 자원·작업 잠금은 정리했다. 이 전환에서 운영 Task/Note/Run·모델 실행은0이며,
전체 WorkCoordinator/desktop 업무 수용으로 세지 않는다.
[운영·실기·한계](projects-results-verification.json)를 따른다.

직전 소스 검증 기록: 배포 전용 Demian worker도 일반 Run 대기열/만료 복구와 로그인
작업을 가져갈 수 있는 경계를 수정했다. 현재 worker의 Session binding·정확한 Run
authority·기존 capability/QA 조건을 함께 확인하고 lease 정리도 같은 소유 범위로
제한한다. 별도 PostgreSQL 회귀69개/skip0·타입 검사·bundle build·독립 소스 검토와
baseline patch의 정확한 Git tree 재현을 확인했다. 원본 API/profile/bundle·같은
PID/생성 시점과 readiness를 유지했다. 이 소스 검사 당시에는 새 worker/권한을
활성화하지 않았고, 이후 위 최신 후속에서 전용 경계를 운영 연결했다.
AT-14의 전제 수정이며 상위 충족률은 유지한다.
[수정과 검증 한계](deployment-worker-intake-verification.json)를 따른다.



이하 수치·미완료 문구는 기록 당시 상태다. 현재 판정은 위 표를 우선한다.

2026-11-13 실행 연동 후속: 계정 준비 상태의 빈 membership 조회 오류를 수정해
Persona PR22 `b6504e5`로 push했다(draft·운영 미배포). 실제 Assistant gateway →
TLS/HMAC API → 동결 worker/core → native Codex Run1/attempt1·전송1·8event와
원 assistant 응답·영수증을 독립 DB 조회로 대조했다. Windows 전체1,181개
(1,167통과·14skip·실패0), 관련103개와 CI 네 job을 통과했다. QA는 정리했고
원본45테이블·42파일·18프로세스를 보존했다. 기존 Note/Projects의 signed
capability GET200·위조401도 확인했으나 개별 QA 대상 쓰기 ACL·전체 업무 수용은
미검증이다. 전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.
운영 전환·protected Run metadata 인가·전체 WorkCoordinator/desktop·Entra GUI가
남는다. [실기와 한계](assistant-native-delegation-verification.json),
[실행 계약](demian-runtime-continuation.md#실제-assistant-gateway의-native-위임)을 따른다.

2026-11-13 운영 후속: 모델 요청 근거 `a3bb446`의 API·웹을 같은 동결 release로
전환했다. Windows CI966통과/9skip·Ubuntu951통과/24skip(각975개·실패0), 양쪽
타입 검사·build를 확인했다. 운영18자산 bytes/hash/MIME, 구 도구 응답 호환과
명시 opt-in, 실제17event·모델1근거·3node/2edge·1그룹 및 접기 내부2edge를
대조했다. 실제 Task 두 개의 저장 보기 생성/조회·revision409·삭제와 Assistant
목록/상세/이벤트200을 확인했다. 원래 설정·기존12테이블 이력·원본45테이블의
행/schema/sequence/보안/container·다른17프로세스를 보존했다. 운영 worker를
시작하거나 새 모델 요청을 보내지 않았다. Entra GUI는 Microsoft 로그인 입력
대기이며 실행 authority·전체 교차 앱 수용도 남는다. 전체14/21(동일 가중치
66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다. 다음 재산정은 현재 identity/source
계약과 운영 실행 연동·실제 업무 수용 검증 후다.
[모델 요청 운영 기록](model-request-trace-verification.json) 참고. 아래는 각 시점의 이력이다.

2026-11-13 Trace 모델 요청 후속: 기존 도구 근거의 제한된 SSE 읽기를 재사용해
모델 요청 시작·종료·보고 소요 시간과 원본 sequence를 별도 node/edge로 투영했다.
명시 opt-in에서만 확장해 구버전 도구 응답과 정규 이벤트 digest를 유지한다.
Run/실제 호출 그룹 내부에 포함하고 참조 호출·모호한 중첩·누락 근거는 구별한다.
운영 원본 Run17event의seq4·`codex-native`/`gpt-6.1-sol`과 종료 미확인을 실제 API로
대조했다. 로컬 분리 화면의3node/2edge·1그룹, 상세·접기·내부 경로·390px 가로
넘침 부재를 확인했다. 실제 Linux Run archive의seq6/45·보고4233ms도 별도 대조했다.
추가 모델 요청은0이다. 초기 전체 검사에서 기존 Assistant 링크 검사1개 실패가
있었고 원인은 미확인이다. 단독35개와 진단 보완 후 전체975개(966통과·9skip·실패0)
및 타입 검사를 확인했다. 원격 CI·동결 배포와 운영 Entra GUI는 아직 별도 단계다.
Demian·Persona의 현재 조회는 executor selector·binding·deployment authority가
미구성임을 확인했다. 다음 운영 구성에는 새 실행 계약·현재 identity/source
tuple과 최신 backup/guard가 필요하다. 전체14/21(동일 가중치66.7%)·ETA 산정 불가·
신뢰도 낮음이며 운영·전체 교차 앱 수용을 전제로 유지한다. `model-request-trace.md` 참고.

2026-11-13 실제 Linux peer 처리 후속: Windows의 새 메시지를 공식 Linux daemon과
native broker가 수신·저장한 뒤 명시 processing API로 Run1/attempt1을 생성했다.
Linux 전용 SDK `8a7f7f2` 빌드·타입 검사·동결 release와717개 source 입력을
대조했다. 실제 모델1요청/756토큰·49event·성공 Run, source snapshot·처리 영수증의
message/conversation/operation/Run ID와 결과 hash를 독립 PostgreSQL 조회로
확인했다. upstream HTTP는 Windows의 제한된 SSH loopback gateway를 사용했으며
원본 provider credential을 Linux로 복사하지 않았다. Track의 실제 관계 API와
6node/5edge·3그룹, 접기3edge·대표선의 키보드 선택과 원본 상세를 확인했다.
마우스 대표선·화면 pixel 품질은 미검증이고 CDP screenshot은 시간 초과였다.
초기 검증 코드의 provenance·socket parent·sequence 오류와 실패 Run도 보존했다.
QA API/DB·worker·전송 daemon·임시 credential은 정리했다. Windows 원본45테이블·
42파일·18프로세스, Linux Persona 서비스/설정은 일치한다. 원격의 별도 인증
container ID1개 교체는 관측했으나 주체·원인은 미확인으로 두고 되돌리지 않았다.
운영 SDK/worker·executor·교차 앱 업무·Entra GUI가 남아 AT-12/14/15/18은 부분,
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다. 다음 재산정은
원본 서비스 경계의 SDK/worker 전환과 실제 업무 수용 검증 후다.
`native-peer-processing-verification.json` 참고. 아래는 각 시점의 이력이다.

2026-11-13 실제 교차 OS 전송 후속: 공식 Reason Network0.12.17 daemon을 기존
설정·서비스와 분리한 Windows PC와 SSH Linux 서버에서 실행했다. 원본 SDK
`8a7f7f2`의 세 transport source와 frozen payload를 대조하고 실제 요청/응답의
ID·내용 hash·replyTo 및 양쪽 ACK 후 inbox 부재를 확인했다. 별도 읽기 전용
SQLite 검사에서도 수신 행의 정확한 body hash·read_at과 발신 receipt를 대조했다.
Windows pipe 서버 PID/exe/생성 시점, Linux SO_PEERCRED/PID/startTicks와
로컬 Windows interface 밖의 원격 SSH 주소를 확인했다. 실제 모델 요청은0이다.
초기 검증 코드의 이름/ID·세션 종류 오판과 Python import 충돌, stale socket의
기동 race·미기록 daemon을 확인·복구했다. 이전의 불충분한 종료 flag는 증거로
쓰지 않으며 최종 독립/proc 조회에서도 소유 daemon 부재를 확인했다.
원본45테이블·42파일·18프로세스와 Linux 서비스 설정/상태·실행 중16container ID를
보존했다. transport ACK는 native peer 처리·모델 실행·Task 수용이 아니므로
AT-12/14/15/18은 부분 상태다. 다음 검증은 실제 inbound message → native
Run/receipt → Track 관계/group의 동일 ID 대조다. 전체14/21(동일 가중치66.7%)·
ETA 산정 불가·신뢰도 낮음을 유지하며 운영 executor·SDK/worker·Entra GUI와
교차 앱 업무의 실제 수용을 전제로 한다. `native-peer-transport-verification.json` 참고.

최신 운영 상태(2026-11-13): 관계 레이블 클릭 수정 `1f224c7`의 API·웹을 새
operation에서 함께 전환했다. PID59568의 실제 generation·loopback listener·
manifest와18웹 파일 bytes/MIME를 확인했다. 기존12테이블 이력·원래 설정·
native45테이블/보안/container·다른17프로세스·bridge를 보존했다. 실제 owner의
Task 두 개 저장 보기 생성/조회·revision409·삭제와 Assistant 목록/상세/이벤트200,
Demian19Run·Projects·Codex·Assistant 연결을 대조했다. 익명/위조API401과
Track/Trail302를 유지한다. 운영 Entra GUI와 desktop·교차 앱/기기는 미검증이다.
`track-label-runtime-verification.json`이 최신 배포 기록이며, 아래 단락은 이력이다.

2026-11-13 실제 병렬·합류 후속: 별도 frozen SDK `8a7f7f2`에서1Run/1attempt·
호출4·멤버3·77event·모델5요청/11,935토큰의 실제 실행을 확인했다. 독립 sorter·
summer의 upstream 구간이2.45초 겹치고, 양쪽 종료seq40/48 후 verifier가seq50에
시작해 두 실제 결과를 검증·최종 종합했다. 원본 metadata·정규화된 계획·3개
명시 호출 join·두 선행선을 대조했다. Track UI14node/26edge·10그룹과 접기25edge·
원본seq16·내부 경로·390px를 확인했다. 레이블의 클릭이 뒤쪽 그룹을 선택하는
문제를 재현하고 `1f224c7`에서 수정·양쪽 선행선 마우스와 대표선 원본 조회로
검증했다. 수정의 Windows·Ubuntu CI957개·타입 검사·build는 실패0이다.
원본45테이블·42파일·18프로세스를 보존하고 성공 실행 archive 후 QA 자원과
credential을 정리했다. 운영 SDK/worker·peer/추가 기기·전체 교차 앱은 남아
14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.
`native-parallel-flow-verification.json`에 실기·표시·운영 경계를 구분했다.

2026-11-13 동결 업그레이드 후속: v2 operator `f73a6d0`의 Windows957개 중
948통과·9skip, Ubuntu957개 중933통과·24skip, 양쪽 실패0·타입 검사·build를
확인했다. 실제12테이블 backup·후보/복구18웹 자산의 격리 cold start를 거쳐
API·웹 `0a6a900`을 함께 전환했다. PID46404의 실제 generation/listener와
18웹 파일 bytes/MIME, Task 두 개의 저장 보기 생성/조회·revision409·삭제를
대조했다. 원래 설정 bytes·기존 이력·native45테이블/보안·다른17프로세스와
bridge를 보존했다. 익명/위조API401·Track/Trail Entra302도 유지된다.
Assistant는 최초 미인가 상태에서 실제 목록/상세/이벤트200·1실행/1역할/37이력을
읽은 뒤 connected를 확인했다. 새 모델 요청·원본 업무 생성은 없다.
SDK/worker·운영 Entra GUI·실제 병렬/peer·교차 앱/추가 기기는 남아 AT-12/18의
전체 실기 완료로 올리지 않는다. 전체14/21(동일 가중치66.7%)·ETA 산정 불가·
신뢰도 낮음이며 남은 실제 연동과 운영 GUI를 전제로 한다. 상세는
`track-runtime-upgrade-verification.json`이다. 아래 단락은 각 시점의 이력이다.

2026-11-13 명시 협업 연결 후속: SDK `8a7f7f2`와 Track `fc87202`의 새 버전
metadata에서 group/member/invocation ID와 `dependsOn`을 연결했다. 실제 새
Run1/attempt1·호출3·멤버2·61event·모델 요청4에서 결과 전달과 정확한 ID를
확인했다. Track의 실제 API/SQLite/UI 경로에서12node/21edge·8중첩그룹을
대조했다. renderer `0a6a900`은 갱신 뒤 포트 측정값이 사라져 edge0개가 되는
문제를 수정했고, 이후 갱신·선택21edge와 그룹 접기20edge·seq16의 원본 선행선을
확인했다. 계획/실행 소속 충돌과 node 한도의 부분 관측 누락도 재현·수정했다.
최종 `0a6a900`의 Windows·Ubuntu CI는 각각942개 중933/919통과·실패0·
환경skip9/23이며 양쪽 타입 검사·build도 통과했다.
원본45테이블·42파일·18프로세스·인증을 보존했으며 QA worker/API/UI를 중지하고
DB archive 후 임시 credential/container를 제거했다. SDK는 로컬 소유 worktree,
Track은 원격 구현이며 새 운영 rollout·Entra GUI·peer/교차 앱/추가 기기는 남았다.
초기 경로 거부와 검증 비교 오류의 경계는 `native-cowork-flow-verification.json`에
보존한다. 전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.

2026-11-13 실제 cowork 증분: 별도 QA의1Run/1attempt에서 협업 그룹1·멤버2·
invocation3·정규 이벤트61·모델 요청4의 성공과 실제 sorter→verifier→최종 결과
전달을 확인했다. native SDK 변경 `dd985ea`는 소유된 별도 worktree의 로컬
commit이며 운영 SDK/worker에 반영하지 않았다. 첫 시도는 도구 정책/callback
누락으로 upstream 요청0회에서 취소했고, 별도 새 실행으로 수정 결과를 확인했다.
Track `a56f558`에서 실제 그룹1/멤버2 종료 요약·호출 범위 중첩·내부 경로와
Run 미선택 Trace/Trail 안내를 로컬 UI에서 대조했다.
최종 구현의 Windows·Ubuntu CI는 각각928개 중919/905통과·실패0·환경skip9/23과
타입 검사·build를 통과했다. 당시 멤버→호출·dependsOn의 명시 연결이 미완이었으며
위 후속에서 새 실제 실행으로 보완했다. 운영 배포/Entra GUI와 peer·추가 기기/
교차 앱의 전체 업무는 남았다.
원본45테이블·42개 보호 파일·18프로세스와 인증을 보존했고 QA 실행은 archive 후
중지·임시 credential/container 제거했다. 상세는 `native-cowork-verification.json`.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음이며, 새 실제 연동과
운영·교차 앱/기기 검증을 전제로 한다.

2026-11-13 저장 Flow 보기 운영 반영: 배포 도구 `4d7da28`의 Windows·Ubuntu CI를
통과한 뒤 API·웹 `7e98793`을 같은 동결 release로 전환했다. 실제 PID21312의
127.0.0.1:14345 listener·CIM·runtime receipt와 HTTP18자산 bytes/MIME를 확인했다.
실제 허용 Projects Task 두 개의 묶음·접힘·내부 초점을 저장·조회하고 오래된
revision409·임시 보기 삭제를 확인했다. 원래 설정 bytes·기존 Track 이력·native
45테이블 전체 상태·다른17프로세스·bridge를 보존했다. Track/Trail302와 공개/로컬
익명·위조 인증401도 유지된다. 실제 Entra GUI는 Microsoft 로그인 대기다.
전환 후 실제 snapshot에서 Demian19Run·Codex·Projects 연결을 확인했다.
Assistant는 초기 미확인 상태였으나 실제 목록·상세·이벤트 GET200·1개 실행/역할·
37이력·현재 Project/Task 참조와 이후 connected를 확인했다. desktop은 미지원이다.
기존11테이블의 검증 backup, 양쪽 release의 격리 cold start와 복구 경로를 준비했으며
원본 DB 복원·native 업무 실행은 하지 않았다. 상세는
`track-frozen-runtime.md`·`track-frozen-runtime-verification.json`에 기록했다.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.

다음 단락은 운영 반영 전의 구현·검증 기록이다.

2026-11-13 계정별 Flow 저장 보기(AT-12-G06): SQLite의 계정 소유·revision 비교
저장/갱신/삭제와 현재 Task/Run/Assistant 인가 API, 저장 이름·묶음·접힘·깊이·
내부 초점의 명시 복원을 구현했다. 로컬 전체857개 중848통과·환경skip9·실패0,
최종 관련26검사·타입 검사·별도 경로 build와 독립 검토를 통과했다. 구현 `7e98793`의
Windows·Ubuntu CI에서 타입·전체 검사·build도 통과했다. 합성 UI에서
프로세스 재시작·새로고침 복원, 이름 갱신·접힘,390px 컨트롤 범위·Tab 이동과
Enter 복원을 확인했다. 권한 철회 뒤 남은 이름을 재현·수정했고, 새 Run 추가로
2node/1edge→4node/3edge가 된 뒤에도 철회한 저장 이름·복원 그룹을 제거했다.

기본 Vite build가 이 checkout의 운영 정적 경로를 갱신한 것을 발견해 기존
동결 프런트엔드로 복원하고 실제 HTTP18파일 byte/hash·Track/Demian 프로세스를
대조했다. 새 후보는 별도 staging에 보관하며 `build:check`와 저장소 지침에
로컬 build 경계를 추가했다. 운영 Saved View 테이블 생성·API 재시작·새 기능
게시와 실제 owner/Entra 검증은 아직 수행하지 않았다. 다음 운영 단계는 Track
DB/설정 backup·현재 미종료 receipt와 프로세스 확인, 운영 정적 root 분리 후
API/프런트엔드 동시 전환이다. `saved-flow-views.md`·`saved-flow-views-verification.json`
참고. 현재 전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.

2026-11-13 공개 Web 운영 반영: `f5b41df`의 Windows·Ubuntu CI 통과 후 원본 public
Web3001만 동결 build `CDH-N8gACrby4eI25LO5q`로 교체했다. 현재 PID55184의 정확한
CIM·listener·고유 operation ready 기록을 확인했다. 기존 gate를 통과한 홈200·
정적 JS hash·실제 Session의3Run/1Session Track 문맥200과 actor403을 대조했다.
SVG·32px PNG의 head 연결·MIME·bytes/hash도 동결 build와 일치했다. 원본45테이블의
전체 행·스키마·sequence·보안 catalog와 container·API/gate/tunnel/Track 신원,
service.json·local startup·worker·credential을 보존했다. 공개 startup·별도 활성화·
domain metadata와 허용한 helper만 변경했다. 새로운 모델 호출은 없다.

로컬 전체831개 중822통과·POSIX 전용skip9·실패0, 관련57검사와 타입 검사, 최종
revision의 양 OS 전체 CI/build를 통과했다. 첫 Windows CI의 일반 임시 경로
fixture 실패는 canonical 경로를 사용하도록 수정했으며 운영 링크 거부는 유지했다.
실제 교체는 commit·기록 오류 없이 종료됐다. 원본 Entra 관리자 로그인과 전용
SSO/transport/라우팅, 브라우저 GUI·교차 앱/추가 기기 검증은 남았다. 외부 Demian은
현재 기존 Basic401, Track/Trail은 기존 Entra302다. 신규 공개 Basic 우회는 없다.
전체14/21(동일 가중치66.7%)·ETA 산정 불가·신뢰도 낮음을 유지한다.
현재 증거는 `demian-public-web-promotion-verification.json`이다. OS/operator 강제
종료 후 자동 재개는 미구현이며 journal·receipt를 통한 수동 복구가 필요하다.

2026-11-13 원본 웹 runtime 후속: 동결 rollback을 실제3002에서 기동해 홈200·정적
파일 byte/hash와 종료/포트 해제를 확인했다. 별도 작업 ID·exclusive 시작/ready 기록·
정확한 CIM/listener와 native handle 종료 adapter를 구현하고 rollback/candidate 양쪽의
실제 launcher를 검사했다. candidate는 현재 native Session의3Run/1Session 요약과
Track 링크, 헤더/Origin/actor403을 대조했다. 원본45테이블 전체 행·스키마·sequence·
보안 catalog·설정11개·서비스4개를 보존했다. 새 암호화 DB/role backup과 같은 image의
network-none/tmpfs 격리 복원·변조 거부·소유 컨테이너 정리를 완료했다. idle API pool을
허용하는 별도 온라인 검사에서 통계 cache 초기화 누락을 독립 검토로 찾아 수정하고
실제 READ ONLY 재현으로 검증했다. 전체774검사 중765통과·환경skip9·실패0 및 타입
검사·독립 정적 리뷰 통과다. 공개 운영 웹/Entra는 아직 전환하지 않아14/21을 유지한다.
현재 실제 증거는 `demian-public-web-runtime-verification.json`이다.

2026-11-13 공개 웹·인증 후속: Demian 전용 SSO renderer/검증을 추가하고 서버의
설치된 OAuth2 Proxy·Caddy·systemd 설정 검사를 합성 credential·격리 디렉터리로
통과했다. 기존 Track/Trail 파일·유닛9개와 서비스3개는 보존했다. 공개 웹 전용
활성화 파일·3001 포트 guard·독립 복구 helper도 구현하고 종료 출력 유실·외부
listener·활성화/metadata 충돌을 검사했다. 실제 원본 startup 패치는 생성만 했고,
동결 candidate1538파일·원본 보호파일6개/프로세스3개/listener3개를 대조했다.
전체768검사 중759통과·환경skip9·실패0 및 타입 검사·독립 정적 리뷰 통과다.
선행 준비에서 원본 build의 독립 rollback1527파일을 동결·전후 hash/알려진 private 값
비포함을 확인했다. 이후 실제 기동과 새 암호화 backup 검증은 위 runtime 후속에 기록했다.
실제 Demian 공개 웹은 여전히 Basic401이며 관리자 로그인·전용 client/secret·
transport·라우팅·원본 웹 전환은 남았다. AT-06/20 및 전체14/21(66.7%)을 유지한다.
자세한 경계와 실행 조건은 [공개 웹·Entra 전환 준비](demian-public-web-preparation.md),
현재 검사 증거는 `demian-public-web-preparation-verification.json`에 기록한다.

2026-11-13 중첩 위임 후속: 별도 native source `d0aaa0b`에서 child runner 연결,
직전 부모/경로·cwd·계정별 durable context·조상 권한의 종료 재검사와 취소 전달을
수정했다. 관련140검사·core/worker 타입 검사·build와 독립 검토를 통과했다.
19,603파일/5link의 새 frozen release로 실제 coordinator → sorter → verifier →
최종 종합을 수행해1Run/1attempt·3호출·5모델 요청/6,436토큰·63event와 실제
assistant 응답을 대조했다. 원본 운영 worker/설정은 전환하지 않았다. 실제 UI에서
중복 부모 관계선을 정리해10node/15edge/5그룹, coordinator 하위5node/5edge와
네 보기·390px를 확인했다. Track725검사 중716통과·실패0·환경skip9다. 원본
45테이블/전체 행·DDL·sequence·보안 catalog·보호파일8·서비스3·source692/산출물2를
보존하고 실행한 QA의 API/Track/DB container·인증 사본을 정리했다. 미사용 번들
하나의 재귀 삭제는 자동 승인 검토가 정책상 차단해 실행하지 않은 채 보존했다.
실제 peer/cowork·교차 앱/기기와 운영 Entra GUI는 남아 전체14/21을 유지한다.
`native-nested-coordinator-verification.json` 참고. 이번 문단의 로컬 UI 검사를
운영 Entra GUI나 native 운영 전환 완료로 계산하지 않는다.
구현 `82cbcd9`의 Windows/Ubuntu CI 통과 뒤 프런트엔드만 게시했다.14개 assets와
favicon/fallback3개·Entra 익명 경계, owner API의 native19Run/Assistant1실행을
대조했으며 기존 Track PID64216과 backend54f8a83·설정/credential을 유지했다.

2026-11-13 coordinator QA 후속: 실제 모델이 sorter 위임을 선택했으나 child의
runner 연결 누락으로 하위 Agent가 실행되지 않았고 QA Run을 취소했다. 실제
외부1회/1,368토큰·1attempt·47event이며 worker 종료 코드0을 업무 성공으로
계산하지 않는다. 이 사례에서 호출 종료 없는 Run 종료를 계속 실행 중으로
표시하던 Trace·그룹 요약을 수정했다. 명시 호출 취소·종료 미확인·충돌을 구별하고
723검사 중714통과·실패0·환경skip9, typecheck/분리 build·독립 소스 검토와 실제
2node/1edge 하위 범위의 네 보기 유지·390px를 확인했다. 원본 데이터·권한·
설정·서비스와 source692/산출물2를 보존하고 owned QA를 정리했다. 실제 중첩
위임·peer·교차 앱/기기와 Entra GUI는 남아 전체14/21(66.7%)를 유지한다.
`native-coordinator-verification.json` 참고. 구현 `c6f335f`의 Windows/Ubuntu CI
통과 후 프런트엔드만 게시했다.14개 assets와 favicon/fallback3개, 익명 Entra
경계와 owner API의 Demian19Run·Assistant1실행 읽기를 대조했다. 서비스 재시작과
credential 변경은 없으며 현재 운영 Entra GUI 검수와 구별한다.

2026-11-13 실제 provider child 후속: 기존 Codex HTTP adapter·접근 토큰만의
격리 QA·명시 registry1건·full pinned compiled worker를 연결한 실제 관리형
child Run1건이 성공했다. 모델 요청1회·641토큰·17event/cursor17과 receipt,
native API→Track의6node/8edge/3그룹·관계 상세·네 보기 범위·390px를 대조했다.
실기로 발견한 호출 참조 중복 집계를 수정해 `호출1·호출 참조1`로 표시한다.
현재718검사 중709통과·실패0·환경skip9다. 원본45테이블의 전체 행/DDL/sequence/
보안 catalog·보호파일8·source692/산출물2·native 서비스 신원을 보존했고 QA
container/credential은 정리했다. 부모 모델 조직화·peer·교차 앱·추가 기기와
운영 Entra GUI는 남아 전체14/21을 유지한다. 실제 QA 결과와 후처리·종료 코드
증거의 한계는 `native-managed-child-verification.json`에 구분했다.
수정 `26207aa`의 Windows/Ubuntu CI 통과 후 프런트엔드만 게시하고14개 assets·
favicon·Entra 익명 경계를 대조했다. 서비스 재시작은 없으며 실제 QA source는
운영 Track에 등록하지 않았다. QA 보관본의 별도 복원에서도 실제 assistant 응답·
성공 Run·17event·receipt를 대조하고 복원 container/credential을 정리했다.

2026-11-13 공통 묶음 후속: 선택한 그룹을 Track·Trail·Trace·Map의 공통 범위로
전달하고 현재 업무 metadata·실행별 lane·의존 관계 Map에 연결했다. 하위 역할의
명시된 Run은 시각적 소속과 구분한 경계 문맥이며 current grant/operation을
재검사한다. 합성 UI에서 업무2·Assistant2·관련 Run4의 네 보기 유지, 하위 역할2·
관련 Run2의4node/2edge·키보드 관계 상세·390px·철회 후 이름/구성 제거와 복원 후
자동 재노출 차단을 확인했다. Windows717개 중708통과·환경skip9·실패0과
typecheck/분리 build를 통과했다. 브라우저 screenshot은 capture timeout으로
확보하지 못했다. 구현 `54f8a83`의 Windows/Ubuntu CI 통과 후 Track DB·설정·이전
index를 백업하고 API/프런트엔드를 함께 게시했다. 실제 업무 metadata200·query400·
method405·다른 actor401,14개 assets와 favicon bytes/Content-Type을 대조했다.
설정/credential 파일6개 hash·native API/Web/gate 프로세스3개·19Run/810event를
보존했다. 운영 Entra GUI 검수·실제 조직화 업무·저장 보기는 미완료다.
`group-workspace-verification.json` 참고. 전체14/21(66.7%)·ETA 산정 불가·신뢰도
낮음을 유지한다.

2026-11-13 admission/pin 후속: 격리 native `e458d12`에 원본 권한·Run·receipt와
같이 commit/rollback하는 명시적 QA 등록과 모든 QA worker의 runtime pin 강제를
구현했다. 관련189개 검사와19,599파일/5link closure의 부작용 없는 준비 검사를
통과했다. 원본 DB에는 migration을 적용하지 않았고 데이터·설정·서비스를
보존했다. 실제 기동 설정·backup/rollback·교차 앱 실기는 남아 전체14/21을
유지한다. `demian-worker-admission-verification.json` 참고.

2026-11-13 intake/drain 후속: 격리 native `1c691aa`에 정확한 QA tuple의
임대·복구·workspace lease 삭제 제한과 전체 종료 drain/cancel을 구현했다.
관련154검사를 실제 분리 PostgreSQL·fake provider/CLI에서 전부 통과했고,
원본 데이터·보안 catalog·설정·서비스를 보존했다. 원격/운영 적용과 실제 QA
업무 수행은 하지 않았으며, atomic QA 등록·pinned runtime·새 closed release와
교차 앱 실기는 남아 전체14/21을 유지한다. `demian-worker-intake-verification.json` 참고.

2026-11-13 worker 준비 후속: 원본692입력과 기존 산출물2개를 보존한 별도
source snapshot 위에 frozen readiness를 구현했다. 실제 소스·설치 dependency·
worker/core의19,589파일/5link payload를 검증했으며 실행·DB/provider/network
동작은 시작하지 않았다. 관련69검사와 compiled CLI8검사·typecheck/build는
통과했다. QA 범위 lease/복구·전체 drain·실제 child/peer/교차 앱 실행은 남아
전체14/21을 유지한다. `demian-worker-readiness-verification.json` 참고.

기준: 2026-11-12 KST. 기존 AT-01~17을 유지하고 Demian 대화
`01a1c901-2cea-7a21-9b38-8d12445f0a49`에서 AT-18~21을 추가했다.
전체 수용 충족률은 동일 가중치 21개 중 검증 완료 개수다. 이는 작업량
추정치가 아니다. 구현·fixture·서비스 준비만으로 실기 조건을 완료 처리하지 않는다.

Assistant 후속은 기존 gateway·peer·Note source를 배포 reader `5196c8bc` 위에
격리 통합하고 부작용 없는 observer와 v2 producer 참조를 private draft PR22에
게시했다. 구현 revision의 전체1177개 중1163통과·실패0·환경skip14, 관련172개
전부 통과·build/typecheck·원본410파일 보존을 대조했다. 서식 보정 head의 원격
CI는 진행 중이며 운영 Track은 여전히 v1이다. 소비자3서비스 교차 인가·source
mapping·Root 소유 native 전환·실제 교차 앱 Task는 미완료다. 전체14/21을 유지한다.
`assistant-demian-observer.md`·`assistant-demian-observer-verification.json` 참고.

최신 후속: Demian 세션 관계 읽기 consumer·typed node/edge와 peer 연결/대화의
중첩 그룹을 구현했다. 요청 전후 Run/Projects 교집합·credential 변경·암호화
continuation을 검증하고, 합성 UI에서3Run·13node/12edge·7그룹과 내부 탐색·
390px·계정 변경 제거를 대조했다. Windows552개 중543통과·실패0·POSIX9skip,
typecheck·분리 build 통과. 후속 원본 API 가동에서도 실제 관계 영수증은0이므로
AT-12/18은 부분 상태다. `session-relations-verification.json` 참고.

산출물 후속은 실제 native `answer.txt` result metadata를 원본과 대조하고 Run/
Session 그룹에 연결했다. 결과·첨부 귀속을 구별하며 조회 철회 시 node/상세를
제거한다. `bb63ea4`의 Windows/Linux CI와 운영 재시작 후 정상 Entra의 실제
Map5node/4edge/2그룹·Trace2node/1edge/1그룹·Trail을 확인했다. 분리 합성 UI의
2산출물·7그룹과 구분하며 원본19Run/810event·Assistant37event를 보존했다.
`artifact-flow-integration.md`·`artifact-flow-verification.json` 참고. managed-child/peer의 실제 조직화와 전체 교차
앱 실행은 여전히 미검증이므로 전체 14/21을 유지한다.

Consumer `90ea858`의 Linux/Windows CI 통과 후 Track 운영 재시작·정상 Entra
UI·기존 Assistant/Projects3중첩 그룹과 실제37event를 재확인했다. 새 원본
관계 API를 가동한 결과는 아니며 수용 개수는14/21로 유지한다.

현재 Demian은 READ ONLY canary와 암호화 DB·role 백업/격리 복원 후 API8080만
고정444-input bundle로 재가동했다. 같은 source19Run·810event·native17cursor와
정상 Entra의 실제212event/lineage9/도구3·중첩 그룹2개를 대조했다. 테이블45개·
sequence1개·role 속성/비밀번호 해시·전체 DDL 및 가동 전후 보안 catalog와 원본
설정/프로세스를 보존했다. worker는 중단·peer registry 미구성이며 원본 Web 요약
적용은 후속이다. API-only 자동 startup은 `bbcfe95`에서 구현·등록하고 실제 task
결과0·PID15940 재사용, 원본 전체 DB·보안 catalog·설정8개·process 보존을 확인했다.
Native cold start·PC 재부팅을 수행한 결과는 아니다. `demian-api-startup-verification.json`
참고. 아래 Docker 장애 기록은 과거 진단이다. 디스크 전체
무결성·전체 원본 운영 복구를 완료 처리하지 않는다. `demian-api-reactivation.md`·
`demian-api-reactivation-verification.json` 참고.

새 Flow/업무별 실행 조직의 계획은 `mission-ui-plan.md`, native 대조는
`native-flow-verification.json`·`native-task-assignment-verification.json`이다.
Node group 추가는 AT-12를 확장하며 전체 분모·완료 개수를 바꾸지 않는다.
네 보기의 공통 화면 선택은 현재 접속 상태다. 별도 계정별 저장 보기의 명시 복원은
AT-12-G06으로 구현·격리 검증했으며 실제 owner 운영 반영과 실제 Task 두 개의
저장/조회·revision 충돌·삭제는 위 동결 전환 기록에서 확인했다.
2026-11-13 native QA 기동 후속 `8afec9e`는 descriptor/release/private pin·현재
registry·home 설정 부재를 검증하고 claim/idle 한도 후 종료한다. 관련245개 검사와
실제 compiled entry의 임시 DB/제어 provider 실행을 통과했다. 운영 migration·worker
기동·실제 협업 Task와는 구별하며 AT-14/18 완료로 올리지 않는다. 원본692입력/
산출물2·DB/보안 catalog·설정8개·서비스를 보존하고 검사 DB·credential은 정리했다.
새 전체 payload는 frozen-readiness만 검증했다. `demian-worker-launch-verification.json`
참고. 실제 binding/credential·최신 rollout guard는 기존 승인에 따라 소유 대화에 문의했다.
Assistant metadata 계약·선택적 읽기 service와 native route 후보를 별도 PR21에
구현했다. Track client 라이브러리의98개 검사(실제 loopback HTTP2개 포함)와
별도 Linux 후보 이미지의 backup/암복호화11개 검사를 통과했다. Windows 전체
422개 중413통과·실패0·POSIX 한정9skip이며, 운영 DB는 읽기 전용 사전 점검만
실행했다. 운영 배포·principal·Track source/API/UI는 연결하지 않았다. AT-14의 실제
업무 증거로 세지 않는다. Native lifecycle getter의 다른 Task 중단 부작용을 분리한
관측 경로를 실제 Tasks/query-only DB에서 검사했다.
Client/복구 도구의 검증과 한계는 `assistant-client-verification.json`,
`assistant-reader-client.md`, `assistant-backup-primitives.md`에 기록했다.
실제 native Work/Runtime SQLite의 DB별 읽기 snapshot·암호화·별도 복구·전체
측정값 대조와 Windows DPAPI 소유자 키의 스트리밍 인증/평문 hash 대조도
완료했다. 두 DB의 원자적 동시 snapshot이나 배포 직전 고정 baseline으로
간주하지 않는다. 원본 앱·보호 대상13개의 설정/프로세스를 유지했고,
원본 DB 복원·reader credential 생성·원본 앱 교체는 실행하지 않았다.
`assistant-native-recovery-verification.json`에 범위와 원래 export wrapper의
mount 순서 비교 실패·별도 재검증을 함께 기록했다.
다음 재산정은 실제 child/peer·외부 앱 계약 연결 후다.

연결 상태 후속 수정에서는 재시작 직후 전체 원본 인가를 확인하지 못한 실행을
숨긴다. 접근 거부를 단순 통신 단절로 낮추지 않으며, 이후 새 스트림 인가까지
확인해야 표시를 복구한다. 공개 업무 Map은 Demian 실행을 표시하지 않는 상태에서도
별도로 인가된 실제 Projects 업무2개·선행 관계1개를 유지했다. 이전6node/5edge
실기 증거를 현재 native 연결 정상으로 해석하지 않는다.
`source-availability-verification.json`에 운영 범위와 회귀 증거를 기록했다.

2026-11-12 KST 운영 점검: Demian 원본 API와 worker가 PostgreSQL 연결 종료로
중단됐으며 Docker engine이 실행되지 않는다. 재기동 bootstrap은 기존 data block의
파일시스템을 인식하지 못하고 사용 중 디스크에 대한 mkfs 거부로 실패했다. 데이터
보존을 위해 추가 재기동·디스크 수리를 중단했다. Demian 원본 web 교체·startup patch·
active release 생성은 실행하지 않았다. 이전 실기 증거와 현재 서비스 가용성을 구별하며
AT-20은 완료로 올리지 않는다. DB/API/worker 복구 후 원본 적용·브라우저 대조가 필요하다.

## 실행 순서

1. Demian-first: string int64 계약, metadata allowlist, durable SQLite 원장,
   Run snapshot·SSE adapter·binding 이력. 단독 실행도 업무 미연결로 수용.
2. 전체 Track, Trail, Trace, typed 실행 Map 및 목록, SNB·상태·deep link.
3. 실제 Demian 실행 연결, 보존/복구, Entra 제품 배포.
4. Projects 업무/권한·요약 연결, Demian 문맥 요약, Assistant/desktop
   계약·연결. 지원하지 않는 기능은 capability에 표시.
5. 명령/승인·업무 생성/배정의 source acceptance, 교차 앱 실기·운영 검증.

Projects가 Project/Task·수용 조건을 소유하고, Demian이 Session/Run·실행
권한을 소유한다. Track은 조회 투영·binding·명령 receipt를 소유한다.
Track 장애는 원본 대화/업무 편집을 막지 않아야 한다. AgentTrail 운영은
보존한다. 개인정보 원문·tool arguments·provider identity는 기본 수집하지 않는다.

2026-11-12 Assistant UI 후속: 별도 native 실행·역할·상태 이력과 Task Map 결합을
구현하고 로컬 canonical HTTP/SQLite fixture 및 390px·중첩 그룹·대표선·권한 철회
검사를 수행했다. 실행 성공과 현재 Task 수용을 구분하며 Run 원장에 변환 저장하지
않는다. Reader credential은 Assistant 통합 Root가 별도 준비했고 native 배포/guard는
Root가 단독 담당한다. Track 운영 config는 native-ready 확인 전 유지한다. 이 준비는
AT-14 실기 달성으로 계산하지 않으며 전체14/21·66.7%는 유지한다. 전체 ETA는
운영 교차 앱·Demian 복구·두 번째 기기/child·peer 증거에 의존해 산정 불가, 신뢰도 낮음.

Assistant 운영 후속: 통합 Root의 native-ready 후 전용 원본 읽기와 현재 Projects
교집합을 실제로 연결했다. 정상 Entra UI에서 실행1/역할1·18초·37상태event,
3중첩그룹·6node5edge·역할/관계 상세·390px을 대조했고 Track 재기동 후 동일
실행을 확인했다. WorkExecution은 Run 원장에 저장하지 않는다. 새 AI 실행0이며
기존 완료 업무만 조회했다. 전체 Assistant→Demian→desktop 업무 수행·두 번째
기기와 child/peer 검증을 대신하지 않아 AT-14와 전체14/21은 그대로다.

2026-11-12 v2 소비자 후속: 명시된 producer→native 출처 설정, 현재
Assistant/Projects/native 접근·실제 operation receipt 대조, server-only 참조
제거와 typed 역할→Run 관계를 구현했다. 중첩 그룹의 원본 관계·상세와 동일
Run의 Trace 이동, 390px/키보드·철회 후 ID/edge 제거를 합성 UI에서 확인했다.
Private native PR22 head `b449f5fe`의 두 원격 CI는 통과했다. Root의 source
리뷰에는 구체적인 결함이 없었으나 전체85파일/운영 승인은 아니며, 새 Work/runtime
DDL에 맞춘 보존·backup/rollback·guard가 필요하다. 운영 source는 v1이고 실제
producer tuple은 아직 구성되지 않았다. 전체14/21(66.7%)·ETA 산정 불가·신뢰도
낮음을 유지한다. `assistant-demian-observer.md`에 구현/활성화 경계를 기록했다.

Track 구현 `cf7402ab`의 Windows/Linux CI 통과 후 운영에 반영하고 정상 Entra
브라우저의 기존 Task Map6node/5edge/3그룹·내부 탐색·상세, Assistant37event를
재확인했다. native19Run/810event·전체 DB/DDL/sequence·보안 catalog·설정8개와
API/Web/gate 신원을 보존했다. 운영 source는 v1이므로 새로운 typed 교차 앱
관계의 운영 실기를 주장하지 않는다. 전체 수용 개수는14/21로 유지한다.

그룹 관측 요약 후속 `ff8b6b0`: 업무/Run/역할/호출/도구 상태를 나누고 명시된
대기·실패·검토, 선행/후속 업무와 산출물을 원본 상세에 연결했다. 그룹 밖의 Run
충돌·산출물 소속 불일치는 부분 관측으로 표시한다. 목적·입력·수용 조건은 원본
미제공이며 제목으로 만들지 않는다. Windows672개 중663통과/실패0/환경skip9와
Linux CI 통과 후 프런트엔드만 게시했다. 정상 Entra UI에서 실제 Run1·answer.txt
40byte metadata의 그룹 요약과 키보드 상세 이동을 확인했다. 원본19Run/810event·
Assistant37event·전체 native DB/DDL/보안 catalog·설정8개·서비스 신원을 보존했다.
실제 child/peer·교차 앱 업무는 별도이므로 전체14/21(66.7%)을 유지한다.

2026-11-13 탐색 복원 후속 `86eedd8`: 현재 화면의 이전/상위/전체 복귀에서
선택·접힘·카메라를 복원하고 계정/원본 구조 변경 시 이력과 사라진 ID를 제거한다.
화면 크기가 바뀌면 현재 bounds로 다시 맞춘다. 합성 UI에서 정확한 카메라/선택
복원·경계 상세 왕복·390px·철회 후 재노출 차단을 확인했다. Windows681개 중
672통과/실패0/환경skip9와 Linux CI 통과 후 프런트엔드만 게시했다. 기존 원본
19Run/810event·Assistant37event·native DB/설정/서비스 보존과 게시 assets를
대조했다. 새 브라우저 세션의 운영 Entra 로그인은 사용자 입력 대기이므로 현재
운영 GUI 복귀 실기를 완료로 기록하지 않는다. 전체14/21은 유지한다.
