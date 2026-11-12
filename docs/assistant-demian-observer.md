# Assistant → Demian 실행 참조의 읽기 계약

기준: 2026-11-12 KST. 기존 Assistant gateway를 배포된 reader 기준 revision
`5196c8bc` 위의 격리 branch `codex/agent-track-demian-observer`에 통합 중이다.
운영 서비스·credential·worker를 변경하거나 실제 교차 앱 실행을 만든 결과가 아니다.
전체 목표는 14/21(66.7%, 동일 가중치), 완료 예상 산정 불가·신뢰도 낮음이다.

Private [draft PR22](https://github.com/pydemia/persona/pull/22)의 구현 revision은
`c7181a1c`, 서식 보정 후 원격 head는 `9646e704`다. 격리 전체 검사1177개 중
1163통과·실패0·환경skip14, 관련172개 전부 통과와 build/typecheck를 확인했다.
후속 서식2파일은 정규화한 JavaScript가 동일하며 변경85파일의 Prettier 검사를
통과했다. head의 원격 CI는 진행 중이다. 검사 revision·한계·운영 보존 대조는
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

현재 운영 Track client는 v1을 사용한다. 위 v2 source 후보가 구현되어 있다는
이유로 운영 reader나 Track의 지원 상태를 변경하지 않는다. 다음 순서로 연결한다.

1. 현재 Assistant owner/reader grant, 연결된 Projects Task의 현재 권한을 확인한다.
2. v2 producer origin·조직·workspace와 정확히 대응하는 Demian source를 운영
   설정에 명시한다. `service=demian`이나 같은 UUID만으로 source를 선택하지 않는다.
3. 그 source의 현재 native principal·Run/Session/workspace 접근을 다시 확인한
   기존 Run만 typed 관계로 연결한다. 새 Run 탐색이나 실행 생성으로 대체하지 않는다.
4. native 권한·source mapping·Projects 권한이 사라지거나 원본 확인에 실패하면
   이전 관계·ID·상세를 제거한다. Assistant 상태와 native Run 상태를 합치지 않는다.
5. 격리 source의 전체 검사·독립 리뷰 후 Assistant 통합 Root에 고정 revision을
   전달한다. Root가 소유한 native container/guard 전환과 credential 준비를 거쳐
   실제 QA 업무의 Assistant 역할 → native Run → Track 그룹/edge를 대조한다.

v2 producer는 참조를 제공할 뿐 native 접근 권한을 부여하지 않는다. 전체 교차 앱
업무와 desktop·두 번째 장치·실제 child/peer 조직화는 기존 AT-12/14/15/18/20의
미완료 조건으로 유지한다. 합성 테스트와 실제 운영 검증은 따로 기록한다.
