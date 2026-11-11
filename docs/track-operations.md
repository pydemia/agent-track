# Agent Track 제품 운영

2026-11-11 KST · 최초 조회 기반 배포. 운영 AgentTrail과 별도 프로세스/DB다.

## 요청 경로

`track.pydemia.ai → Cloudflare Tunnel → server:14343 OAuth2 Proxy(Entra)
→ server:14344 Caddy → server:14346 SSH reverse → Windows:14345 Track`.

공개 인증은 Entra 단일 tenant와 Track 전용 client를 사용한다. 초기 허용
계정은 소유자 한 명이다. 공개 Basic 인증은 없으며 proxy 신뢰 key와 Entra
사용자 이메일을 함께 검증한다. API/SSE는 미인증 시 401이다. Caddy는
Authorization·access token 전달을 제거하고 내부 신뢰 key를 덮어쓴다.
해당 key는 OIDC 토큰이 아니며 내부 hop의 위조 전달 헤더를 막는 용도다.

Cloudflare 기존 tunnel ingress v9에서 Track 규칙 하나를 추가해 v10으로
변경했다. DNS CNAME은 같은 tunnel을 사용한다. Trail·다른 앱 경로는 보존했다.

## 비공개 상태와 실행

Windows 현재 사용자 `.local/share/agent-track/`에 다음을 둔다. 해당 디렉터리는
현재 사용자와 SYSTEM만 접근하도록 기존 ACL을 유지한다.

- `track-product.config.json`: 공개 origin, DB, source별 계정·수집 범위.
- `track-proxy-key`: 서버 Caddy와 공유하는 무작위 key. 출력/커밋 금지.
- `product.sqlite`와 WAL: 조회 원장. 대화·tool input/output는 저장하지 않는다.
- 제품/SSH PID·stdout/stderr. 오류 응답은 source URL·credential 원문을 포함하지 않는다.

`Start-Track.cmd`로 시작하고 `scripts/Restart-Track.ps1`로 제품만 재시작한다.
재시작은 PID와 실행 파일·인자·14345 listener 소유자를 대조한다. 사용자
Startup의 `Agent Track.vbs`가 숨김 watcher를 실행하고 20초마다 제품/SSH를
복구한다. PC가 꺼지면 수집·제품 upstream은 사용할 수 없다. 이 배포를
상시 독립 서버 collector 구조로 확장하는 것은 후속 작업이다.

Linux 서버에는 `agent-track-sso.service`, `agent-track-upstream.service`를
사용자 systemd unit으로 enable했다. 기존 Trail unit·credential을 덮지 않는다.
credential은 `~/.local/share/agent-track-sso/track/`의 mode 600 파일에 둔다.
`deploy/track/prepare-upstream.py`는 Track Caddy·API route 설정만 준비한다.

## 수집과 권한 한계

Demian은 현재 `127.0.0.1:8080`에서 bearer token을 요구한다. 기존 private 설치 파일의 apiToken을 직접 참조한다(credentialFormat=demian-service). 원본 인증은 유지하며 source의 소유자 권한 안에서 세션·알려진 Run을 조회한다. 전역 과거 Run feed는
기존 API에 없으므로 명시 Run + 허용한 현재 Run을 수집한다. `discoverHistory=true`를 명시하면 세션 메시지 entry의 Run ID와 별도 message cursor만 남겨 과거 Run을 찾는다. 메시지 본문은 일시 응답 디코딩 후 버리고 저장/표시하지 않는다. 페이지 상한·부분 이력은 연결 설명에 표시한다.

Codex는 허용한 Git 폴더의 최근 7일·최신100개 jsonl을 읽는다. 64MiB 초과
파일과 파일 수 제한으로 제외한 개수를 연결 정보에 표시한다. 다른 위치·
Claude·desktop·Assistant native feed는 기본 미지원이다. 원본 로그를
변경하지 않으며 해석 가능한 turn/tool metadata만 원장에 넣는다.

source ID는 한 원본 instance·수집 범위를 뜻한다. 종류·endpoint·조직·로그
경로·허용 저장소 범위를 바꾸면 같은 ID를 재사용하지 않고 새 ID를 등록한다.
원장에 비밀값을 포함하지 않는 identity hash를 고정해 과거 캐시가 새 출처의
grant로 넘어가는 것을 막는다. label·credential 회전은 identity 변경과 구별한다.

Projects가 붙은 Run은 Project source의 연결/grant도 있어야 조회할 수 있다.
현재 구현은 한 Track 소유자와 별도 native reader/account를 고정하고 매 조회의
현재 Project ACL·정확한 ID 교집합을 확인한다. 다중 사용자 native principal
등록/위임은 별도 구성이다. 기본 설정 `cancelUsers=[]`는 제어를 닫는다. 현재 운영은 기존 Entra 소유자 한 명만 `cancelUsers`에 명시해 Demian 취소를 연다. `auth.users`가 여러 명이면 취소를 자동 비활성화한다. 원본 credential이 admin 수준이므로 다중 사용자 권한 위임으로 확대하지 않는다. 승인·재개·재시도는 미지원이다.

## Projects 전용 읽기 연결

`Start-Projects-Bridge.ps1`는 Windows loopback14349에서 기존 서버의
loopback14324 Projects edge로 SSH local forward를 연다. 공개 Projects의
Entra 설정은 유지하며, 이 내부 API도 별도 native HMAC 인증을 요구한다.
watcher는 기록한 PID와 listener를 대조하고 알 수 없는 listener는 보존한다.

`projects-reader.json`과 `projects-reader.key`는 Windows private 상태에 둔다.
credential JSON은 version1, Track user, native accountId/principalId, kid,
revision, 절대 secretFile 경로를 갖는다. 예제 설정의 account UUID는 교체해야
하는 예시다. 구성 전에는 native 사용자/Entra tenant 매핑·현재 ACL과 서버
mount를 확인하고 `deploy/projects/provision-reader.py --dry-run`으로 native
schema 검사를 수행한다. 이 스크립트는 Linux 서버에서 실행하며 기존
Assistant principal을 보존하고 별도 projects:read/tasks:read만 추가한다.
새 key를 Git·출력·브라우저에 넣지 않는다. 네이티브 업무 데이터는 변경하지 않는다.

각 API/SSE 관측은 현재 원본 Project 범위를 다시 확인한다. 연결된 Run도
해당 Project ID가 현재 허용되어야 표시한다. 원본 업무는 페이지별 metadata만
브라우저에 전달하며 body/goal 등 원문은 응답 해석 후 버린다. Task projection을
영구 저장하거나 원본 업무를 생성/배정/수정하지 않는다. 현재 실제7프로젝트·
26업무 조회, dedicated reader scope7→6에서 API404·공개 업무 비노출,
7복구를 확인했다(`projects-live-verification.json`).

현재 Run 상세의 명시적 연결은 `POST /api/bindings`를 사용한다. 이는 Track
원장의 기록이며 native Task 배정/업무 변경이 아니다. 현재 배포의 단일
Entra 소유자·연결된 Demian Run·별도 Projects 읽기 범위가 모두 있어야 한다.
서버가 조회한 Task revision/title을 기록하며 browser title 입력은 받지 않는다.
UUID receipt·예상 binding version의 CAS와 원장 transaction으로 중복/충돌을
처리한다. 응답 미확정 시 같은 요청으로 확인하며 다른 UUID를 자동 생성하지
않는다. 이전 이력은 보존하고 다른 Run·같은 Session에는 전파하지 않는다.
원본 업무를 삭제하거나 현재 권한이 철회되면 임의 unbind로 접근을 열지 않는다.
`binding_receipts`는 SQLite online backup/복원에 포함된다.

Snapshot의 `viewEpoch`/`viewVersion`은 BFF 관측 응답 순서다. 원본 이벤트
cursor·Task revision과 다르다. 클라이언트는 더 오래된 응답과 이전 프로세스
epoch를 거부해 권한 축소 뒤 늦게 도착한 응답이 metadata를 복원하지 않게 한다.
이 wire field를 요구하는 클라이언트보다 새 backend를 먼저 배포한다.

## 백업·보존·복구

```powershell
node --import tsx scripts/storage-admin.ts check C:/private/product.sqlite
node --import tsx scripts/storage-admin.ts backup C:/private/product.sqlite C:/private/backups/new.sqlite
node --import tsx scripts/storage-admin.ts archive C:/private/product.sqlite C:/private/backups/new-archive.sqlite 2026-10-01T00:00:00.000Z
```

backup은 SQLite online backup을 사용하며 기존 파일을 덮지 않고 integrity를
검사한다. archive는 백업 성공 후 지정 시점 이전에 종료한 Run의 이벤트
payload만 줄인다. Run ID·binding·cursor·event digest tombstone은 보존한다.
누락/gap이 있는 Run은 정리하지 않으며 이력 축약은 incomplete로 표시한다.
자동 삭제는 활성화하지 않았다. 최초 권고 보존 기간은30일이며 운영 정책이
정해질 때 명시적으로 archive를 실행한다. 백업도 같은 private ACL을 유지한다.

복구는 제품/watcher를 멈추고 현재 DB·WAL을 별도 백업한 후 검증한 복원본을
새 DB 경로에 두고 config.database를 그 경로로 바꾼다. 원본을 삭제하거나
기존 백업을 덮지 않는다. integrity, source cursor, binding, receipt 상태를
대조한 뒤 시작한다. unknown 명령을 복원만으로 재실행하지 않는다.

## 취소 처리와 한계

`POST /api/commands/cancel`은 Entra proxy principal·정확한 Origin·source grant·Run capability를 검사한다. UUID와 payload digest를 원장에 기록하고 동일 요청은 동일 receipt를 반환한다. 같은 계정/Run에 결과 미확정 요청이 있으면 다른 UUID도 거부한다. native 인가·최신 Run을 다시 확인하고 120초 이내 deadline을 재검사한 뒤 전송한다. 원본 `cancelling`은 이미 진행 중이므로 추가 전송하지 않는다.

접수는 종료와 별도다. 통신 결과 미확정·재시작 시 unknown으로 두고 원본을 읽어서만 정리하며 자동 재전송하지 않는다. native cancel은 expected cursor 조건을 받지 않는다. Track cursor는 로컬 이력의 신선도 검사이며 원본 원자적 version precondition은 아니다. 미확정 기록이 남으면 원본 세션에서 상태를 확인한다. credential·사용자 입력은 브라우저 body/URL에 전달하지 않는다.

실기에서 격리 Run을 accepted→cancelled로 취소하고 동일 요청 재수신을 대조했다. 공개 UI에서 receipt를 확인했다. 버튼 클릭 실기와 나머지 명령은 별도 미검증이다.

## 남은 운영 검사

Demian 원본 Session 링크의 웹 이동은 현재 Basic401에 막혔다
(`native-web-link-verification.json`). Track/Trail 전용 Entra 경로와 별개인
원본 서비스 인증이다. 원본 웹의 credential을 수집하거나 Basic 보호를
제거하지 않았다. 원본 웹을 Entra로 연결할 때 해당 서비스의 client/callback·
upstream 인증 경계를 별도로 검토해야 한다.

최초 Entra 본인 계정 동의·공개 로그인/SSE/logout·재로그인과 실제 native Run 관측을 확인했다.
타 앱 연결, 취소 UI 클릭·승인/재개/재시도, 다른 장치, 장시간/규모 검증은
남아 있다. 현재 서비스 노출과 전체 goal 완료를 구별한다.
