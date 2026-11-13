# Assistant를 통한 보호 Run 관측

기준: 2026-11-14 KST. **native API·공개 gate는 운영 반영했고 Assistant는
정지된 새 이미지 후보까지 검증했다.** Track 새 collector와 Assistant 교체,
WorkCoordinator→Projects→Note→desktop→Track 실제 업무 수용은 아직 미완료다.
[현재 운영·후보 근거](assistant-native-observation-operating.json)를 따른다.

## 운영 전환 후속

Dedicated API8081은 `db861e8`의 동결 후보로 교체했다. 원래 API8080과 worker는
같은 PID로 유지했다. 공통 시작 도구는 API에만 별도 release pointer를 사용하고
기존 worker pointer를 유지한다. 전환 lock·설정 hash·현재 process 생성 신원·
retained handle 종료와 복구 경로를 검토했고, 실제 canary를 종료한 뒤 전환했다.
전환 후 공통 PowerShell 시작 명령이 같은 API PID를 adopt하는 것도 확인했다.

공개 gate는 현재 process/파일 신원을 검증한 뒤 교체했다. TLS·기존 브라우저
인증/설정·cloudflared를 유지했고, 서명 capability200/무서명403과 metadata query
전달·비정상 query403을 대조했다. metadata는 존재하지 않는 Run으로 native
`application/problem+json` 응답까지 확인했다. 실제 보호 Run 본문200은 아직 아니다.

Assistant `0691e1a` 이미지와 정지된 후보를 생성했다. 기존 native 설정이 이미
설치된 앱이므로 env/mount를 다시 추가하는 기존 clone 함수를 사용하지 않는다.
새 `image_clone_request`/`verify_image_clone`은 image와 source label5개만 변경하고
기존 환경·HostConfig·13개 mount·네트워크를 그대로 대조한다. 새 credential이나
mount는0개다. 기존 clone/lifecycle 회귀를 포함한 Python37개와 Linux 후보
검사를 통과했다. 운영 Assistant는 아직 `f79a5b1`이다. 새 source의 push·PR CI는
모두 통과했다. 다음은 현재 DB의 새 복구/preview 증거와 새 운영 guard·cutover다.

첫 사전 검사의 receipt 컬럼 이름 오류는 readonly 쿼리를 고쳤고 운영 action 전
중단됐다. gate 검사의 RFC problem media type 가정과 Windows 경로 표기 차이도
각각 원본 응답/실행 신원으로 확인해 고쳤다. 실패한 canary·전환 기록을 덮어쓰거나
소비된 runner를 재실행하지 않았다. 새 모델/Task/Note/Run과 DB 복원은 수행하지 않았다.

## 현재 연결

1. Demian `db861e85d72dd59368704dddb089f0615113532d`의 signed metadata API는
   원본 실행 receipt와 현재 native 인가로 제한한 JSON page를 제공한다.
2. Persona `0691e1a1a80f0fa75999fd59f779aacb9921606a`의 Gateway는 기존 durable
   reference와 현재 async source authorizer를 사용해 해당 GET을 서명한다. 읽기 중
   lifecycle `get`·재전송·새 실행·관측 결과 DB 저장을 호출하지 않는다.
3. Persona reader의 v2 `executions/:executionId/roles/:roleId/native`는 현재
   owner/role reference를 조회 전후 대조한다. 브라우저 쿠키나 Track proxy key를
   native 실행 credential로 사용하지 않는다.
4. Track `AssistantAuthority.nativeWindow()`는 현재 같은 actor의 Projects Task와
   명시 producer mapping을 대조하고, native GET을 마지막에 다시 확인한다.
   `AssistantNativeCollector`가 Run·이벤트·원본 Task binding을 저장한다.
5. 원장 snapshot은 새 source의 현재 `authorizedRunIds` 교집합만 내보낸다.
   기존 Trace projection이 invocation/call ID를 이용해 도구 시작·완료를 연결하고,
   Assistant 역할 상세에서 같은 Run의 Trace로 이동할 수 있다.
6. 공개 `delegated-proxy`에도 metadata GET 경로를 추가했다. query는 생략하거나
   정확한 `?after=<canonical-int64>&limit=<1..250>` 순서만 허용하고, HMAC envelope와
   bearer·Host·organization을 기존대로 대조한 뒤 원래 URL 그대로 전달한다.
   query alias·추가 key·POST·무서명 요청은 거부한다. 위 운영 gate 전환 후속을 따른다.

원문·도구 인수/결과·native signing key·binding/context/request hash·native
principal은 Track 원장과 공개 응답에 포함하지 않는다. private writer가 있는
원래 Demian source와 별도의 source ID를 사용하며 기존 source를 재해석하지 않는다.

## 명시적 활성화

같은 Track actor와 Projects reader에 고정한 Assistant v2 source에 다음 mapping을
추가한다. UUID와 origin은 실제 producer receipt/설정으로 확인해야 한다.

```json
{
  "assistantProtocol": 2,
  "assistantProjectsSourceId": "projects-owner",
  "assistantDemianMappings": [{
    "origin": "https://demian.pydemia.ai",
    "organizationId": "<actual-organization-uuid>",
    "workspaceId": "<actual-workspace-uuid>",
    "sourceId": "demian-assistant-owner"
  }]
}
```

대상 native source는 `kind: "demian"`,
`assistantNativeSourceId: "<that-assistant-source-id>"`, 동일 origin의 `baseUrl`,
동일 `organizationId`, 같은 owner 한 명의 `users`로 구성한다. 별도 native
bearer/HMAC는 전달하지 않는다. token·credentialFormat·직접 Run/Session 수집·
discovery·취소·승인·배정 설정이 있으면 config가 거절한다. source identity에
관측 방식을 포함하므로 기존 source ID를 변경해 캐시 권한을 차용할 수 없다.
이 예시는 실제 운영 활성화 기록이 아니다.

현재 조회 창은 최근 Assistant 업무50개·해당 source 실행64개·Run별 이벤트250개다.
이후 이벤트가 남으면 native through boundary를 저장해 미완전 상태를 유지하고
다음 조회에서 durable cursor부터 이어받는다. 목록 전체/모든 과거 업무의 수집을
보장하지 않는다. 같은 이벤트는 기존 immutable digest·dedupe를 사용한다.
인가 실패·철회·source 변경·재시작 시 저장 Run도 숨기고 새 조회로만 복구한다.

이 source의 별도 native lineage·tool evidence/model request·artifact·file page·
session relations·orchestration·permission/control API는 아직 지원하지 않는다.
일반 bearer로 재시도하지 않고 unsupported/거부를 반환한다. Trace의 현재 이벤트
기반 흐름과 구분한다. saved view는 새 현재 source/Run grant를 다시 확인한다.

## 확보한 증거와 다음 단계

- 실제 HTTP producer/client→Track API→SQLite→Trace 검사6개: 시작/완료 연결,
  Task 역사 revision 유지, 페이지 재개·중복 방지, 철회/잘못된 tuple/actor 차단.
- 격리 PostgreSQL metadata/기존 runtime44개: 실제 SQL 양성 projection·int64·
  alias 충돌·scope/서명·일반 bearer 차단·현재/조회 도중 권한 철회, source event 불변.
- Persona coordinator/gateway184개: 현재 native 결과·원본 reference·늦은 인가
  철회·관측 DB 불변·lifecycle 무호출. 테스트 upstream/runtime는 합성이다.
- Track·Persona server·Demian API 타입 검사, Demian API bundle와 별도 Track
  frontend build 통과. frontend는 운영 `dist/web`를 덮어쓰지 않았다.

전체 Track 회귀의 첫 실행은 다른 actor 거부 경로에서1개 실패해 수정했다.
해당 API/수집25개는 수정 후 통과했다. 최종 전체 회귀는990통과·실패0·9skip이며,
`47fa23f`의 Track Windows/Ubuntu CI43455156723은 모두 성공했다. Persona PR22의
CI 한 app job은 build/typecheck/format 뒤 report TTS archive 다운로드 HTTP403으로
실패했다. 별도 push run의 같은 설치 단계는 통과했고 후속 검사가 진행 중이다.
Persona 전체 CI 통과로 보고하지 않는다. 원격 CI 상태와 검사 범위는
`assistant-native-observation-verification.json`에 별도로 기록한다. Windows의
POSIX 백업 전용 skip은 통과로 합산하지 않는다.

공개 gate 경로가 빠져 있던 문제도 후속으로 수정했다. 수정 전403을 재현했고,
수정 후 metadata 전달과 기존 gate 회귀12개/타입 검사가 통과했다. 이 gate 변경은
위 `47fa23f` 이후이므로 해당 CI 결과로 gate 후속까지 통과했다고 주장하지 않는다.
Persona push의 같은 media 설치 단계가 통과한 근거로, PR의 실패 app job만1회
재실행 요청했다. 다른 job·원본 설정·검사 기준은 변경하지 않았다.

다음은 native API·public gate의 metadata 경로·Assistant image/reader와 Track
source의 운영 반영이다. 현재 운영 release·DB·인증을 확인한 새 계획을 사용하며,
이전 소비된 cutover/backup runner를 재실행하지 않는다. 그 뒤 한 실제 지속 업무의
지시·Run·Projects 결과·Note 참조·Track 관측을 같은 ID/receipt로 대조한다.
desktop은 과거 사용자 지정을 찾았다. 「SSH config에 장비 접속 설정 추가」
대화 `01a173cd-0935-7213-a827-3ab30a298212`에서 현재 Windows PC를
`192.168.0.2 pydemia-desktop`으로 명시했고, 이번 hostname/IPv4 검사와 일치했다.
따라서 이 PC를 desktop 실기 대상으로 삼는다. 별도 desktop 앱/bridge 계약을
가정해 추가 대기 조건을 만들지 않는다. 이 PC에서 같은 실제 업무로 접속하는
검사는 남는다. 수용15/21·71.4%는 유지하며 개발 완료율로
환산하지 않는다. 전체 ETA 산정 불가·신뢰도 낮음이다.
