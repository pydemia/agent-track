# 기본 인증: Microsoft Entra ID

2026-11-11 KST. 사용자 결정: 공개 접속은 Entra ID, 사용자 이름·비밀번호는 로컬 관리자·테스트에만 허용.

## 현재 상태

2026-11-13 추가: 아래 Trail/Track 최초 등록 기록과 별도로 Demian 원본 웹의
기본 인증도 Entra로 연결할 준비를 진행했다. 전용 설정의 설치 바이너리 검사는
통과했지만 실제 등록·secret·공개 라우팅은 아직 적용하지 않았다. 현재 Demian은
Basic401이다. [공개 웹·Entra 전환 준비](demian-public-web-preparation.md)를 따른다.
Track의 이후 실제 배포·로그인 증거는 `track-server-verification.json`과
`goal-status.md`의 AT-17을 기준으로 하며 아래 최초 등록 당시의 미검증 기록과 구별한다.

- 기존 조직 tenant: `fb44f64f-973f-480d-ab48-f30f3bababb6` (`pydemia.ai`). 조직 계정으로 Entra 관리 화면 접속 확인.
- `Pydemia AgentTrail` 등록 상태와 single-tenant Web callback을 브라우저에서 확인. Client ID `8e026114-f50c-454c-9d70-76490df3dfd0`, object ID `a24150fb-a49a-4dbd-bcff-ec251bf48da3`. 사용자 입력 credential로 프록시 운영 전환 및 실제 로그인 성공.
- 후속 사용자 승인으로 `Pydemia Agent Track` 앱 등록 제출·성공 알림·조직 전용 계정 유형을 확인. Client ID `4d28c8bb-ab49-489e-aa85-b0934479620b`, object ID `593f0b2b-c1ba-4bd4-a4cd-389d9bd8113a`. credential 저장·파일 권한600·설정 유효성 검사 확인. 제품 미배포이며 실제 token 교환·사용자 로그인은 미검증.
- 서버 OAuth2 Proxy 7.15.2·Caddy의 격리된 사본, 앱별 config·unit·숨김 입력 helper 준비. 다른 앱의 client secret은 재사용하지 않음.
- 실제 등록 설정의 OAuth2 Proxy config-test, Caddy validate 통과. Trail은 본인 계정에 한한 최초 권한 동의 후 callback·세션 발급·실제 보드 표시 성공. 조직 전체 동의는 선택하지 않음.
- 공개 Basic fallback 제거. 공개 `/`는 Microsoft 로그인으로302, 미인증 API·SSE는401. 서버 Tunnel ingress version9에서 Trail만 `127.0.0.1:14340`으로 변경, 다른 route 보존.
- `agent-trail-sso.service`, `agent-trail-sso-upstream.service` enabled/active와 서버 사용자 linger 확인. Windows의 gateway·원본 AgentTrail은 계속 필요함.
- 로컬 `http://127.0.0.1:5332`만 기존 관리자 Basic 사용 가능. 원본 AgentTrail의 로컬 주소는 유지.

## 등록할 앱

| 앱 | Web redirect URI | 계정 유형 |
| --- | --- | --- |
| Pydemia AgentTrail | `https://trail.pydemia.ai/oauth2/callback` | pydemia 단일 tenant |
| Pydemia Agent Track | `https://track.pydemia.ai/oauth2/callback` | pydemia 단일 tenant |

초기 허용 사용자는 기존 Trail을 사용한 소유자 `pydemia@pydemia.ai`로 제한한다. 조직 전체 허용·추가 사용자·그룹은 별도 결정하며 tenant의 모든 사용자에게 자동 공개하지 않는다. Microsoft Graph 데이터 접근 권한은 추가하지 않는다. Entra 정책에 따른 계정 선택·MFA는 남을 수 있다.

Trail은 최초 승인, Track은 후속 “track도 진행해 줘” 승인에 따라 등록 상태를 확인했다. Track은 이 작업에서 Register를 제출하고 성공 알림을 확인했다. Client secret 생성·새 credential 입력은 브라우저 정책상 사용자에게 인계한다. 비밀값은 채팅에 보내지 않는다.

소유자 직접 입력 도구: 저장소 루트의 `Configure-Trail-Entra.cmd`, `Configure-Track-Entra.cmd`. Client ID는 고정되어 있어 재입력하지 않으며 각 앱에서 만든 secret의 **Value**만 숨김 입력한다. 이 도구는 서버 권한600 파일에 저장하고 공개 라우팅을 자동 변경하지 않는다.

## 준비한 경로

`trail.pydemia.ai → Tunnel → OAuth2 Proxy 127.0.0.1:14340 → Caddy 127.0.0.1:14342 → SSH 14332 → PC gateway 5332 → AgentTrail 5330`.

OAuth2 Proxy는 tenant issuer·audience·nonce·PKCE S256·허용 계정을 검사한다. Secure/HttpOnly/SameSite=Lax의 `__Host-agent-trail` cookie를 사용하며 Track cookie는 `__Host-agent-track`으로 분리한다. 원래 앱에 access token/Authorization을 전달하지 않는다.

Caddy는 인증된 upstream에서만 사용하는 random trust key를 gateway에 전달한다. gateway는 key와 허용 계정을 함께 검증하고 원본 앱에 넘기기 전에 identity/key/header를 제거한다. 공개 Host에서는 관리자 Basic을 인정하지 않는다. Host·Origin·원본 action token 검사는 유지한다.

비밀값 위치: 서버 `~/.local/share/agent-track-sso` 권한700, 비밀 파일600. PC `~/.local/share/agent-track/trail-sso.json`은 기존 사용자 전용 ACL을 상속한다. 서버 systemd unit에 secret을 인라인하지 않고 앱별 client.env를 사용한다.

## 등록 후 활성화 순서

Trail은 아래 활성화 절차를 수행했습니다. `deploy/sso/activate.py`가 비밀값을 프로세스 내부에서만 읽어 앱 ID·권한·config-test를 확인하고 Trail unit만 시작합니다. Track은 계속 비활성 상태입니다.

1. Entra에 앱별 등록을 제출하고 각 client ID를 기록한다. 사용자 직접 client secret Value를 생성한다.
2. `ssh -t pydemia-server 'python3 ~/.local/share/agent-track-sso/configure.py trail'`로 Trail Client ID와 secret Value를 숨김 입력한다. Track도 준비하려면 마지막 인자를 track으로 바꾼다. secret ID가 아닌 Value를 사용한다.
3. 서버의 실제 등록정보로 `oauth2-proxy --config=.../trail/oauth2-proxy.cfg --config-test`를 수행한다. EnvironmentFile을 프로세스 안에서 로드하며 원문 출력 금지.
4. `agent-trail-sso-upstream.service`·`agent-trail-sso.service`만 시작하고 loopback의 로그인 redirect, tenant/client/callback/PKCE/nonce, 위조 cookie/header 거부를 확인한다.
5. 공유 Tunnel의 Trail ingress만 `http://127.0.0.1:14340`으로 전환하고 나머지 hostname·fallback을 보존한다.
6. 실제 브라우저에서 Entra 로그인→AgentTrail→SSE→설정 action token→logout/만료를 확인한다. 완료 후에만 Entra 활성화 완료로 기록한다.

Track은 upstream 앱과 DNS가 없으므로 unit을 enable하지 않는다. 앱 구현·배포 때 동일 계약으로 연결한다.

SSO 실패 시 공개 Basic으로 자동 복귀하지 않는다. 인증되지 않은 상태에서는 거부하며 로컬 관리자 경로로 조사한다. 기존 secret을 회전할 때는 별도 보호된 백업과 명시적 회전 절차를 적용한다.

## 실제 검사와 남은 범위

- [서버 설정·서비스 검증](entra-server-verification.json), [공개 인증 경계 검사](entra-activation.json), [gateway 경계 검사](entra-verification.json), [실제 브라우저 로그인 기록](entra-browser-verification.json).
- 공개 root의 tenant/client/callback·PKCE S256·nonce/state·Secure/HttpOnly/SameSite cookie 확인.
- 미인증 API/SSE, 위조 identity/cookie, 공개 Basic 요청은401. 잘못된 OAuth state는 OAuth2 Proxy의 generic500 오류로 거부됨(통과한 요청 아님).
- 실제 Entra 로그인과 note 보드·파일 트리·world map 수신 확인. 앱 logout 후 Microsoft 계정 선택으로 이동하고, 재로그인 시 추가 권한 동의 없이 AgentTrail로 복귀 확인.
- 첫 callback의 교차 사이트 탐색을 gateway가 차단하는 문제를 수정. 인증된 최상위 홈 GET만 허용하며 교차 사이트 POST·API 읽기·외부 Origin은403인 회귀 검사 통과.
- 전체 PC/서버 재부팅, 8시간 실제 만료 대기, 다른 사용자 로그인, Track token 교환과 앱 배포는 미실행. 로컬 관리자·테스트 경로만 Basic 사용 가능.

근거: [Entra redirect URI](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri), [OAuth2 Proxy Entra provider](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/ms_entra_id/), [OAuth2 Proxy 7.15 설정](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/).
