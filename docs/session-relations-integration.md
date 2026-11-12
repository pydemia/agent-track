# Demian 세션 관계와 실행 그룹 연결

AT-12·AT-18의 managed-child·peer 근거를 원본 세션별 읽기 API로 연결한다.
호출·cowork 이벤트, 별도 child Run, peer 처리 영수증은 서로 다른 단위다.
관계를 읽기 위해 모델·worker·peer discovery를 시작하지 않는다.

## 원본 계약과 현재 상태

2026-11-12 현재 다음 Demian GET 계약을 소비한다.

- `/api/v1/sessions/{sessionId}/relations/managed-children`
- `/api/v1/sessions/{sessionId}/relations/peer-processing`

Demian 작업 트리는 `codex/common-sessions`, HEAD `297678ea` 위의 미커밋·
미추적 구현이다. HEAD만으로 새 API가 재현되지 않는다. 원본 검증 manifest의
8개 파일을 현재 bytes와 대조해 모두 일치했다. 후속 보존/복구 검사 후444개
입력을 별도 고정한 API bundle을 기존8080에서 가동했다. 원본 checkout은 수정하지
않았다. 원본 페이지는 UUID Run ID 순서이며 SSE sequence와 다르다.
peer 범위는 처리 영수증이 있는 관계다. 원문·주소·계정·credential은 제외한다.

## Track 조회와 권한

Track의 GET-only 경로는 다음과 같다.

```text
/api/runs/{runKey}/session-relations?kind=managed-children|peer-processing&cursor=...
```

선택 Run의 원본 세션 접근을 전후로 확인한다. 대상 Run이 요청 전후의 현재
Track snapshot과 Projects 권한 교집합에 모두 남아 있을 때만 관계를 반환한다.
등록되지 않은 Run을 자동 발견·생성하거나 관계를 원장에 저장하지 않는다.
Source identity·credential 파일 내용·사용자·Project 범위 변경도 재검사한다.

원본 cursor가 Track에서 숨겨진 Run을 가리킬 수 있어 브라우저에 직접 전달하지
않는다. 사용자·Run·세션·관계 종류·source/credential·Project 범위에 묶인
AES-GCM continuation을 사용한다. 유효 시간15분이며 서버 프로세스가 바뀌면
무효다. continuation은 권한이 아니며 매 페이지를 재인가한다.

전체 조회 기한은10초다. HTTP/body 크기를 제한하고 연결 종료·기한 초과를
취소한다. timer 실행이 늦어져도 마지막 응답 직전까지 monotonic deadline을
검사한다. 원본 오류·HTTP body·schema 진단을 오류 메시지에 노출하지 않는다.

브라우저는15초마다 첫 페이지부터 현재 창을 재확인한다. 관계 종류별 최대
4페이지·1,000건이며 추가 기록과 부분 조회를 표시한다. 실패·철회·계정 또는
Run/Project 범위 변경 시 이전 관계를 지운다. continuation·관계·화면 그룹
이름은 URL이나 로컬 저장소에 보관하지 않는다.

## Map·Trace의 node·edge·group

| 근거 | 표현 | 추론하지 않는 내용 |
| --- | --- | --- |
| managed-child | child Run·child invocation·부모 호출 참조·영수증 | 부모 Run ID가 없으므로 같은 invocation 문자열의 다른 Run에 합치지 않음 |
| peer 처리 | 로컬 connection → conversation → message 문맥과 message → 실제 Run | 원격 Session·전체 peer 발견·실행 의존성 |
| Session 소속 | 현재 RunView의 명시된 세션에 실제 Run 합류 | 같은 이름·시각에 따른 소속 |
| 처리 상태 | 조회 당시 Run 상태와 현재 Run 상태 분리 | Task 완료·사용자 수용·검증 통과 |

peer 연결·대화를 중첩 문맥 그룹으로 묶고 실제 Run은 기존 Session·Run 그룹에
둔다. 경계선은 방향·종류·개별 영수증 근거를 유지한다. 같은 대화의 여러
영수증은 구조선을 중복시키지 않는다. 부모 Run 미확인 참조는 그룹 밖에 남긴다.
기존 Pydemia FlowCanvas의 세 깊이·내부 이동·breadcrumb·상위 복귀·node/edge
상세·키보드 목록을 사용한다. 상세는 식별자·scope·시각이며 원문을 넣지 않는다.

## 검증과 남은 운영 작업

Track consumer는 `90ea858`로 게시·운영 재시작했다. 해당 revision의 Linux·
Windows CI가 모두 통과했다. 실제 Entra 소유자 UI에서 기존 Assistant/Projects
Map의6node/5edge·3중첩 그룹·내부 탐색·breadcrumb을 다시 확인했다. 실제
브라우저 decoder로 운영 BFF의 동일 Assistant 실행1개·역할1개·37event와
현재 Projects `in_review` revision3을 대조했다. Codex 관계는 `unsupported`,
미인가 Demian 관계는404이며 기존 Demian Run19개·Assistant Run0개를 보존했다.
공개 익명 snapshot401·Track/Trail Entra redirect와 자산6개 bytes도 대조했다.

`session-relations-verification.json`은 parser·loopback HTTP·Track 인증/SQLite·
권한 교집합·cursor·투영·브라우저 검사를 구분한다. UI QA는 합성 Run3개·
관계2개·13node/12edge·7그룹, 미확인 부모, peer 내부 탐색, 키보드·390px과
계정 변경/철회 후 제거를 검사했다. native 모델 실행은0이다.

Demian 담당 세션은 READ ONLY 점검으로 기존 DB 대상·컨테이너·볼륨, Run19개,
지정 Run의 성공·연속17event·산출물 참조, migration 식별자24개를 과거 기록과
대조했다. 초기 이 점검만으로 디스크 전체 무결성이나 API 가동을 증명한 것은
아니다. 아래 후속 가동과 구분하며 managed-child·peer receipt는 여전히 각각0이다.

후속 API-only 가동으로 같은19Run·810event가 Track에 중복 없이 다시 연결됐고
새 metadata GET의 실제 인가된 빈 응답·peer 미구성과 공개 Entra Trace를 대조했다.
worker·원본 Web·자동 startup 연결, 실제 child/peer 및 교차 기기 업무가 남았다.
`demian-api-reactivation-verification.json`을 참고한다. desktop 앱의
위치·계약은 미확정이며 hostname만으로 만들지 않는다. 합성 관계를 운영 실행으로
계산하지 않아 전체 수용 상태는14/21로 유지한다.
