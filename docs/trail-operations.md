# AgentTrail 원격 접속

주소: https://trail.pydemia.ai · 기본 인증: **Microsoft Entra ID 활성화**. 본인 계정 `pydemia@pydemia.ai`로 실제 로그인·보드 표시를 확인했습니다. [SSO 활성화 상태](entra-sso.md)를 우선 확인합니다.

로컬 관리자·테스트 주소 `http://127.0.0.1:5332`에서만 사용자 이름 `pydemia`와 `Copy-Trail-Password.cmd`로 복사한 비밀번호를 사용할 수 있습니다. 공개 주소에서는 이 비밀번호로 로그인할 수 없습니다. 비밀번호는 사용자 전용 ACL로 보호된 `~/.local/share/agent-track/trail-credentials.json`에만 보관합니다.

## 경로

현재 경로: Cloudflare proxied CNAME → 기존 `ubuntu-server` Tunnel → OAuth2 Proxy `127.0.0.1:14340` → Caddy `127.0.0.1:14342` → SSH `127.0.0.1:14332` → 이 PC `127.0.0.1:5332` 인증 gateway → 원본 AgentTrail `127.0.0.1:5330`. 공개 인증이 없으면 로그인으로302 또는 API401을 반환하며 Basic 우회 경로는 없습니다.

5330은 집계 요청을 받는 대표 daemon이며, 같은 화면에서 설정한 주요 프로젝트10개와 시험 보드1개를 함께 조회합니다. [다중 프로젝트 구성·세션 범위](multi-project-overview.md)를 따릅니다. 일부 원본 링크는 localhost 포트를 직접 열 수 있으므로 다른 PC에서는 overview의 통합 조회를 사용합니다.

원본 Host/Origin 검사를 유지하고 gateway가 인증·외부 Origin 검사를 통과한 요청의 Host/Origin을 로컬 upstream에 맞춥니다. 원본 action token 검사는 유지합니다. SSE를 buffering하지 않습니다. Cloudflare Access 조직은 만들지 않고 기존 pydemia.ai 서비스와 같은 Entra/OAuth2 Proxy 방식으로 전환을 준비했습니다.

## 시작·중단·복구

- `Start-Trail.cmd`: `deploy/trail-projects.json`의 모든 보드를 확인·시작하고 gateway와 SSH를 기동합니다. SSH는 끊기면5초 후 재시도합니다.
- Windows 사용자 로그인 시 Startup의 `AgentTrail Remote.vbs`가 위 launcher를 숨김 실행합니다. 로그인 전·절전·PC 종료 중에는 접속되지 않습니다.
- gateway 중단: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Stop-Trail.ps1`. 기록한 PID와 실행 인자를 확인하고 해당 gateway 및 그 SSH 자식만 종료합니다. 로컬 보드는 유지합니다.
- 영구 중단: Startup의 해당 VBS를 제거하고 gateway·전용 SSH를 중단합니다. DNS와 ingress를 제거하려면 `trail.pydemia.ai` 항목만 삭제하며 공유 Tunnel과 다른 ingress를 보존합니다.
- 비밀번호 변경: gateway 중단 후 credential 파일의 password를 새 난수로 교체하고 재시작합니다. 새 값은 clipboard helper로 가져옵니다.
- 로그: `~/.local/share/agent-track/gateway.*.log`. 요청 원문·인증 헤더는 기록하지 않습니다.
- 서버 인증 상태: `ssh pydemia-server 'systemctl --user status agent-trail-sso.service agent-trail-sso-upstream.service'`.
- Trail 앱만 로그아웃: `https://trail.pydemia.ai/oauth2/sign_out?rd=%2F`. Microsoft 전체 계정이나 다른 앱의 session은 종료하지 않습니다.

PC→서버 SSH 공개키 인증과 기존 서버 Tunnel이 모두 필요합니다. SSH만 복구하는 기능이며 gateway/보드 프로세스 crash를 지속 감시하는 서비스는 아닙니다. 프로세스가 종료되면 launcher를 다시 실행합니다. 서버 14332는 loopback만 bind합니다.

`track.pydemia.ai`는 새 제품의 예정 주소이며 이번 배포에서 DNS나 앱을 생성하지 않습니다.

## 초기 Basic 배포 검증 이력 — 2026-11-11 KST

아래는 최초 배포의 과거 검증이며 현재 공개 인증 상태가 아닙니다. 전환 준비 후의 현재 검사는 [entra-verification.json](entra-verification.json)과 [SSO 상태](entra-sso.md)를 따릅니다.

- DNS: proxied CNAME `trail.pydemia.ai` readback 확인.
- 기존 Tunnel ingress version 8에 전용 route 추가. 기존 5개 hostname과 404 fallback 유지 확인.
- 미인증·잘못된 비밀번호 401, 인증 HTML·model·panel·world·tree·fleet 200.
- SSE 200·text/event-stream·초기 data 수신 확인.
- 허용하지 않은 Origin 403, action token 없는 설정 POST 403.
- gateway stop/start 후 외부 API 200·미인증 401 재확인.
- 사용자 Startup VBS 생성과 cscript 실행 확인. 실제 Windows 재부팅·로그인 복구와 브라우저 렌더링은 미검증.

비밀값 없는 상세 결과는 [trail-verification.json](trail-verification.json)에 저장했습니다.
