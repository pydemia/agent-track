# Assistant → Demian 실행 참조의 읽기 계약

기준: 2026-11-12 KST. 기존 Assistant gateway를 배포된 reader 기준 revision
`5196c8bc` 위의 격리 branch `codex/agent-track-demian-observer`에 통합 중이다.
운영 서비스·credential·worker를 변경하거나 실제 교차 앱 실행을 만든 결과가 아니다.
전체 목표는 14/21(66.7%, 동일 가중치), 완료 예상 산정 불가·신뢰도 낮음이다.

Private [draft PR22](https://github.com/pydemia/persona/pull/22)의 구현 revision은
`c7181a1c`, 서식과 POSIX 경로 fixture 보정 후 원격 head는 `b449f5fe`다. 격리 전체 검사1177개 중
1163통과·실패0·환경skip14, 관련172개 전부 통과와 build/typecheck를 확인했다.
후속 서식2파일은 정규화한 JavaScript가 동일하며 변경85파일의 Prettier 검사를
통과했다. head의 두 원격 CI에서 app/container/collection/code-worker가 모두
통과했다. 경로 보정은 테스트 fixture만 변경하며 운영 loader를 바꾸지 않는다.
검사 revision·한계·운영 보존 대조는
`assistant-demian-observer-verification.json`에 기록한다.

## 기존 구현의 재사용

별도 gateway 작업의 기준 HEAD는 `ebb507a6`이며 실제 기능에는 당시 미커밋
변경이 포함되어 있다. HEAD만으로 기능을 복원할 수 없다. 기존 gateway에는
owner-scoped durable intent, POST-once fence, 유실 응답의 GET 조정, 서명 요청,
native Run receipt·산출물·peer 지원이 있다. 중복 dispatch adapter나 새 receipt
원장을 만들지 않고 이 구현과 기존 `externalRuntime` 근거를 재사용한다.

원래 gateway 작업 폴더는 수정하지 않았다. 복사 기준410개 파일을 현재 원본과
대조하여 모두 같은 bytes/hash임을 확인했다. 격리 통합의 충돌은 기존 native
reader의 strict 관측과 gateway 기능을 함께 보존하는 방향으로 해결했다.

## 관측과 실행 제어의 분리

`DemianWorkRuntimeGateway.observe()`는 현재 owner·reference·context·binding과
저장된 요청/receipt 무결성을 확인한 뒤 기존 관측을 반환한다. lifecycle `get()`의
kick, dispatch·원격 GET 조정·cancel·DB 쓰기는 호출하지 않는다. metadata 관측은
저장된 artifact BLOB을 읽고 hash 검증하지 않으며 `bytesVerified: false`와
`verificationState: unverified`를 유지한다. 원격 실행의 현재 ACL을 새로 확인한
것으로 간주하지 않는다. 이는 Track 소비자가 독립적으로 확인해야 한다.

Backend 선택은 현재 selected flag가 아니라 기존 reference의 실제 backend
소유권을 따른다. 로컬 runtime에 observer가 없으면 lifecycle getter로 대체하지
않고 조회 불가로 반환한다.

## 버전별 native reader

| 계약 | 응답과 호환 범위 |
| --- | --- |
| `/api/integrations/track/v1` | 기존 closed DTO 유지. 외부 timing/reference를 표현하지 못하므로 해당 실행은 목록의 omitted에 포함하고 개별 조회에서는 노출하지 않음. `demianReferencesSupported: false` |
| `/api/integrations/track/v2` | 외부 wall timestamp는 미검증으로 유지. 역할별 nullable `runtime.demian`에 검증된 producer와 실제 Session/Run 참조 제공. `demianReferencesSupported: true`, controls는 false |

v2 `runtime.demian`의 허용 필드는 `origin`, `organizationId`, `workspaceId`,
`sessionId`, `runId`, `operationId`다. origin은 credential 없는 canonical HTTPS
origin이다. producer 조직/workspace/origin은 현재 검증된 gateway binding에서,
Session/Run은 그 binding과 일치하는 기존 receipt에서 읽는다. operation은 기존
gateway correlation이며 새 attempt나 새로운 실행 ID를 의미하지 않는다.

Coordinator는 strict observer가 반환한 참조를 매번 다시 구성한다. 저장된
WorkExecution UI 문서의 `externalRuntime.runId`를 수정해도 그 주소로 v2 관계가
생기지 않는다. 참조를 생성할 receipt가 없으면 null이며 UUID나 thread 이름으로
Demian 실행을 추정하지 않는다. 이 관측 전용 참조는 저장 원장에 추가하지 않는다.

v1/v2는 같은 별도 reader grant를 사용하지만 cursor MAC domain을 구분한다.
한 버전의 cursor를 다른 버전에 재사용할 수 없다. 두 namespace 모두 UI cookie·
Entra proxy identity로 reader 인증을 대신하지 않으며 GET만 허용하고 응답 직전
grant를 재검사한다. 원문 응답·prompt·서명 claim·key·artifact bytes를 제외한다.

## Track 소비자와 활성화의 남은 조건

현재 운영 source 설정은 v1이다. Track의 v2 소비자 구현은 원본 namespace를
명시적으로 선택하며 v1으로 자동 후퇴하지 않는다. 구현과 source 활성화를
구분한다. 다음 조건을 모두 만족한 참조만 연결한다.

1. 현재 Assistant owner/reader grant, 연결된 Projects Task의 현재 권한을 확인한다.
2. v2 producer origin·조직·workspace와 정확히 대응하는 Demian source를 운영
   설정에 명시한다. `service=demian`이나 같은 UUID만으로 source를 선택하지 않는다.
3. 그 source의 현재 native principal·Run/Session/workspace 접근과 기존
   operation receipt를 다시 확인한 기존 Run만 typed 관계로 연결한다. DTO의
   origin을 요청 주소로 사용하지 않는다. 새 Run 탐색이나 실행 생성으로 대체하지 않는다.
4. native 권한·source mapping·Projects 권한이 사라지거나 원본 확인에 실패하면
   이전 관계·ID·상세를 제거한다. Assistant 상태와 native Run 상태를 합치지 않는다.
5. Root가 소유한 native container/guard 전환과 credential 준비를 거쳐 실제 QA
   업무의 Assistant 역할 → native Run → Track 그룹/edge를 대조한다. 원본 전환은
   Work/runtime schema를 추가하므로 이전 schemaUnchanged·29/62개 테이블
   guard를 재사용할 수 없다. 새 source/image·DDL 보존·최신 데이터 backup과
   rollback 계약이 필요하다. Track 소비자 구현은 원본 전환을 수행하지 않는다.

### 그룹·관계·상세 탐색

Project → Task → WorkExecution → 작업 묶음 → 역할의 기존 그룹을 유지한다.
실제 Demian Session/Run은 원본 소속을 따르며, 역할에서 Run으로
`assistant-demian-runtime` 관계를 연결한다. 접힌 대표선은 원본 관계를 보존하고
선택 시 실제 끝점과 Operation/Session/Run 근거를 표시한다. Run을 선택하면
같은 source-qualified ID로 Demian Trace의 호출·도구·산출물 상세에 이동한다.
외부 wall timestamp를 역할 소요 시간이나 전체 완료율로 합산하지 않는다.

브라우저에는 producer tuple을 보내지 않고, 외부 thread/turn 참조도 제거한다.
현재 native·Projects snapshot과 다시 교차 확인하여 단절·철회·Run 누락 시 이전
관계·실행 상세를 제거한다. 현재 Assistant Task는 native 조회 후에도 재확인한다.

격리된 합성 UI에서 중첩/접힘 관계 선택·원본 edge 상세·동일 Run의 Trace 이동,
390px·키보드 탐색과 native 권한 철회 후 ID/edge 제거를 확인했다. 실제 원본
업무 수행의 증거로 계산하지 않는다. independent 검토는 현재 소비자 patch의
권한·참조·투영 범위에서 구체적인 결함을 찾지 못했으며 운영 승인과 구분한다.

v2 producer는 참조를 제공할 뿐 native 접근 권한을 부여하지 않는다. 전체 교차 앱
업무와 desktop·두 번째 장치·실제 child/peer 조직화는 기존 AT-12/14/15/18/20의
미완료 조건으로 유지한다. 합성 테스트와 실제 운영 검증은 따로 기록한다.
