# Agent Track 구현 goal 기준표

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

| 요구 | 수용 조건 | 상태·증거 |
| --- | --- | --- |
| AT-01 | 원본 ID·재수신·충돌 방지 | 검증 완료. `tests/core.test.ts` ID/충돌·dedupe·재시작·binding 검사, 실제 Codex 211 Run의 source/run UNIQUE 원장 |
| AT-02 | snapshot과 실시간 실행 상태 일치 | 검증 완료. `recovery-http.test.ts` 초기 snapshot/SSE 일치·할당/실행/권한 대기/취소 중/실패 구분. 실제 native 성공·취소 종료와 공개 Trace 대조. `source-availability.test.ts` 시작 시 미인가 캐시 숨김·전 범위 확인 뒤 단절 시 stale·거부 후 새 스트림 인가·단일 SSE 실패의 connected 덮어쓰기 방지. 운영 API 단절 시 native 원장19개 보존/노출0·이벤트404와 공개 사유 안내 대조 |
| AT-03 | durable cursor·중복·역순·gap·재시작 복구 | 검증 완료. 실제 HTTP 단절 후 DB 재시작·cursor1 재수신·gap2 보충·3 dedupe. stale/forbidden/재인가 fixture와 실제 native cursor17 재시작 확인 |
| AT-04 | Trail·파일·산출물 근거와 수집 범위 | 검증 완료. 실제 answer.txt metadata·원본/공개 Trail 대조와 native 파일 편집4Run 조회. 성공3파일의30byte/hash·요청/완료seq, 거절/만료는 실패·파일 없음 구분. 공개 Trail·390px/Tab·Project 철회404/경로 제거→복구, 원문 비노출·이벤트 digest 불변·조회 한도 검사 |
| AT-05 | 실제 Run·step·tool Trace, unknown 보존 | 검증 완료. 실제 Codex Run13event/5개 paired tool·관측 구간 공개 대조. 실제 native17event와 없는 step/호출 ID unknown 표시. invocation/call tuple·int64·모호함·시각 역행 fixture 통과. native212event·lineage9·도구3결과(실패1/성공2)와 Flow 대조·원장 불변, 요청≠실행 시작 구별 |
| AT-06 | 동일 원본 선택 deep link와 미지원 안내 | 부분. Demian Session href·Run link 미지원 안내. 실제 원본 웹이 Basic401로 브라우저 이동 차단. Track Entra/API 관측과 별개이며 원본 웹 인증 연결 필요 |
| AT-07 | 계정/프로젝트 권한 교집합·metadata allowlist | 검증 완료(현재 소유자 배포). 별도 owner-bound Projects reader·현재 native ACL/Project ID 교집합. 실제 scope7→6에서 API404·공개 업무 비노출→7 복원. 다른 Track actor의 owner key 차용 거부·bound Run 비노출·원문 제외 fixture. 추가 사용자 native principal은 별도 구성 필요 |
| AT-08 | 네 화면·빈/오류·접근성·favicon 실기 | 검증 완료. 공개 네 보기·favicon bytes/hash·SNB/Map keyboard/mobile. 분리 QA의 네 빈 보기·503/재시도·stale·철회·401 만료 후 private cache/URL 제거 실기. 실제 Entra membership 철회와 구별 |
| AT-09 | capability 기반 명령·idempotency·receipt·단절 | 부분. native cancel 실기 accepted→cancelled·동일 receipt, unknown/철회/만료/재시작·서로 다른 UUID 중복 방지 fixture. 공개 UI 취소 클릭→native cancelled·receipt1건 대조. 재개/재시도는 원본 계약 미지원 |
| AT-10 | 범위·만료·철회·runtime 재검증 승인 | 검증 완료(현재 소유자 배포). 실제 native fileChange allow_once·동일 receipt·30byte 파일, 공개 UI deny·파일 비생성, 원본 자동만료/결정0·late 요청 차단. bound Project reader 철회 시 원문/세 API404→복구, 모바일/Tab·만료 후 인자 제거. 실제 allow_session 후 도구2회/승인 요청1건·새 QA 파일2개, 다른 실행/업무 상태와 구별 |
| AT-11 | 원본 업무 생성/배정·수락 확인·실패 보존 | 검증 완료(현재 소유자·명시 QA 범위). 공개 UI Task1건 생성·최신 내용/정책 검토 후 기존 native Session2개에 Run2건 배정, exact input hash·request-status·binding·실제 성공·cursor 대조. Task r1/todo 불변. unknown/새 UUID 차단·접수 후 binding 복구·재시작/backup·철회 직전 무전송 fixture.390px/Tab·미제출 초안 보존·실제 reader 철회 시 본문/초안/Run ID 제거→복원. `task-assignment-verification.md` |
| AT-12 | typed Map·근거·목록·순환/고립·node group과 깊이 탐색 | 부분. 실제 native 소속 지도·관계 목록·키보드·390px 실기, SCC 순환/고립·10,000노드 fixture. 실제 Pydemia FlowCanvas·node/edge 상세·source/Run ID 분리. 실제 same-Task·Session2·Run2 지도·행 정렬, child closure fixture. Projects 실제 dependency1건·업무2·Session2·기존 Run2의6node/5edge, 선행 방향·관계/현재 revision 상세·390px/키보드/URL 이동·범위7→6에서 API404·그래프/URL 제거→7복원 실기. 중첩 그룹·화면 Task 묶음 생성/해제·깊이 preset·접힘 내부 원본 선택·breadcrumb/전체 맞춤·재조회 유지·390px 실기. 현재 업무2/관계1 및 Codex Run1/도구4를 대조, 대표 경계선·순환/소속 충돌·10,000-depth는 fixture 증거. 원본 artifact result의 Run 그룹·상세·edge는 실제 answer.txt로 확인. 격리 실제 explicit managed-child receipt·17event·그룹/관계 상세를 추가 확인. 실제 nested coordinator3호출/63event·5그룹 대조, peer·운영 통합은 남음 (`projects-dependencies-verification.json`, `node-groups-verification.json`, `native-managed-child-verification.json`) |
| AT-13 | 보존·backup/restore·cursor/receipt 정합 | 검증 완료. 실제 online backup→별도 복원 DB→API232Run·17,456event 대조. binding/pending receipt·archive tombstone fixture. 자동 삭제 비활성·명시 archive 정책. 운영 DB 전환/재난 훈련과 구별 |
| AT-14 | Assistant→Demian→desktop→Track 실제 업무 | 부분 준비. Track 전용 authority/API·현재 Projects 교집합·별도 WorkExecution/역할 UI·중첩 그룹을 구현하고 canonical HTTP/권한·투영·브라우저 fixture를 검증했다. 통합 Root 원본 cutover 후 Track 운영 활성화·정상 Entra UI·기존 실행1/역할1/18초/37event·현재 Projects 검토 상태·6node5edge/3그룹을 대조했다. 전체 교차 앱 업무는 아직 미검증. 전용 Assistant native 읽기 API·strict coordinator·runtime.observe를 별도 private PR21에 구현. 새18개 SQLite/실제 Tasks/HTTP 검사, 전체899개 중885통과·실패0·환경skip14. Track client98개와 실제 Work/Runtime DB별 암호화·복구를 검증했으나 전체 교차 앱 업무는 미검증 (`assistant-native-reader-verification.json`, `assistant-workspace-verification.json`, `assistant-live-verification.json`) |
| AT-15 | 전체 프로젝트 기본·필터·장치/수집 누락 | 부분. 전체5저장소+native 여러 workspace·필터/해제·선택 유지 실기, source별 범위/미지원 표시. 두 번째 실제 장치 연결 남음 |
| AT-16 | SNB 접힘/크기/키보드/보존/모바일 실기 | 검증 완료. CUA 로컬 QA 960px: sidebar244/main700→접힘main944; pointer272·keyboard+4·reload272; 390px drawer340·Tab 순환·Escape focus 복귀 |
| AT-17 | Track Entra 로그인/API/SSE/logout·공개 Basic 차단 | 검증 완료. 본인 consent(조직 동의 제외), 공개 로그인·snapshot/SSE·logout 후 비노출·재로그인. `track-server-verification.json` 공개401/위조·Basic 거부 |
| AT-18 | invocation/cowork/managed-child/peer를 구별·고유 Run 집계 | 부분. 별도 인가 native lineage9건·정확한 도구 item join3건·Run/호출 분리와 업무별 고유 Run 집계. 격리 실제 explicit managed-child Run1/17event·부모/child ID 분리와 원본 receipt·Track 상세 확인. 실제 coordinator→sorter→verifier→종합의3호출/5요청/63event를 별도 QA에서 확인. cowork/peer·교차 장치와 native 운영 전환 남음 |
| AT-19 | Projects 원본·Run 단위 binding 이력·서로 다른 완료 | 검증 완료. 실제 native QA Task A→B로 명시 Run 연결·재연결, A 원본 revision2와 당시 revision1 보존, stale revision409·동일 receipt·재시작 이력2건. Run 성공/Task todo·agent report/검증/수용 unknown 구별. bound Project 철회 시 공개 비노출·네 API404→복구 |
| AT-20 | Demian/Projects 문맥 요약·인증 조회·Track 장애 격리 | 부분. Projects 원본 BFF·개요·Task 목록/상세를 소유자 QA Project1개에 운영 연결. 실제 Map 이동·socket 단절 중 업무 생성/수정·자동 복구·390px/키보드 실기. Demian owner/Session 전후 재인가 BFF·요약 UI 구현, 분리 native web에서 요약 단절 중 실제 Run 성공18event/도구0·복구 후 Run3·같은 공개 Map·390px/Tab 실기. native web120/Track238 검사 통과. 원본 web 교체 전 Docker DB 연결 종료와 API/worker 종료 발견, 운영 적용 보류. 다른 사용자 인가 계약도 별도. `projects-context-native-ui-verification.json`·`demian-context-native-ui-verification.json` |
| AT-21 | 실제 Demian 실행을 Track에서 관측하고 재접속 대조 | 검증 완료. 실제 native Run `82f7e1fd-8fe2-4da1-8307-99f3e016f48c` 성공, canonical SSE17개·cursor17/highWater17. 제품 재시작 후 동일 원장·공개 Trace seq17 대조 |

현재 전체: **14/21 (66.7%)**. 동일 가중치 수용 조건 기준이며 작업량 추정치가 아니다.
AT-01/02/03/04/05/07/08/10/11/13/16/17/19/21을 검증했다. 기존 Session 실행 배정을
새 Session 생성·자동 subagent 조직화·업무 수용으로 계산하지 않는다. 전체 완료 예상
범위는 아직 산정 불가, 신뢰도 낮음. Demian 문맥 요약의 원본 운영 적용, Assistant를 포함한 전체 교차 앱 업무, desktop 위치·두 번째 실제 장치와
child/peer·dependency 근거 연결이 남았다.
새 Flow/업무별 실행 조직의 계획은 `mission-ui-plan.md`, native 대조는
`native-flow-verification.json`·`native-task-assignment-verification.json`이다.
Node group 추가는 AT-12를 확장하며 전체 분모·완료 개수를 바꾸지 않는다.
사용자 화면 묶음은 현재 화면 상태이며 서버 저장·재접속 복원은 후속이다.
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
