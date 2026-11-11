"""Prepare per-app OAuth2 Proxy configuration without reusing another app's credentials."""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys

ROOT = Path.home() / '.local/share/agent-track-sso'
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(ROOT, 0o700)
bindir = ROOT / 'bin'
bindir.mkdir(exist_ok=True)
source = Path.home() / '.local/lib/persona-sso-operations/e8c9f5cf-75e6-4373-be61-6674eabdbdc7/bin'
for name in ('caddy', 'oauth2-proxy'):
    if not (bindir / name).exists():
        shutil.copy2(source / name, bindir / name)
        os.chmod(bindir / name, 0o700)

def private_write(file, value):
    file.write_text(value)
    os.chmod(file, 0o600)

transport = json.load(sys.stdin)
trust = transport['trustKey']
assert len(trust) == 64 and all(c in '0123456789abcdef' for c in trust)
private_write(ROOT / 'Caddyfile', '''{
    admin off
    auto_https off
}
http://:14342 {
    bind 127.0.0.1
    reverse_proxy 127.0.0.1:14332 {
        header_up Host trail.pydemia.ai
        header_up X-Agent-Track-Trust ''' + trust + '''
        header_up -Authorization
        header_up -X-Forwarded-Access-Token
        flush_interval -1
    }
}
''')
for app, port, upstream in [('trail', 14340, 14342), ('track', 14343, 14344)]:
    appdir = ROOT / app
    appdir.mkdir(mode=0o700, exist_ok=True)
    cookie = appdir / 'cookie-secret'
    if not cookie.exists():
        private_write(cookie, base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())
    cfg = f'''provider = "entra-id"
provider_display_name = "Microsoft Entra ID"
http_address = "127.0.0.1:{port}"
upstreams = ["http://127.0.0.1:{upstream}/"]
redirect_url = "https://{app}.pydemia.ai/oauth2/callback"
oidc_issuer_url = "https://login.microsoftonline.com/fb44f64f-973f-480d-ab48-f30f3bababb6/v2.0"
scope = "openid profile email"
oidc_email_claim = "preferred_username"
authenticated_emails_file = "{appdir}/allowed-emails"
code_challenge_method = "S256"
insecure_oidc_skip_nonce = false
cookie_name = "__Host-agent-{app}"
cookie_secure = true
cookie_httponly = true
cookie_samesite = "lax"
cookie_path = "/"
cookie_expire = "8h"
cookie_secret = "{cookie.read_text()}"
reverse_proxy = true
skip_provider_button = true
pass_host_header = true
pass_access_token = false
pass_authorization_header = false
pass_basic_auth = false
pass_user_headers = true
skip_auth_strip_headers = true
set_authorization_header = false
set_xauthrequest = false
request_logging = false
auth_logging = false
api_routes = ["^/(model|panel|events|world|tree|fleet|hook|setup|spawn|summary|board-lite|whoami|suggest|nudge|tree-of|setup-board)(/|$)"]
'''
    private_write(appdir / 'oauth2-proxy.cfg', cfg)
    private_write(appdir / 'allowed-emails', '\n'.join(transport['allowedEmails']) + '\n')
    unit = f'''[Unit]
Description=Agent {app} Microsoft Entra ID authentication
After=network-online.target
[Service]
WorkingDirectory={ROOT}
EnvironmentFile={appdir}/client.env
ExecStart={bindir}/oauth2-proxy --config={appdir}/oauth2-proxy.cfg
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
[Install]
WantedBy=default.target
'''
    units = Path.home() / '.config/systemd/user'
    units.mkdir(parents=True, exist_ok=True)
    private_write(units / f'agent-{app}-sso.service', unit)

private_write(units / 'agent-trail-sso-upstream.service', f'''[Unit]
Description=AgentTrail authenticated upstream bridge
After=network-online.target
[Service]
WorkingDirectory={ROOT}
ExecStart={bindir}/caddy run --config {ROOT}/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
[Install]
WantedBy=default.target
''')
subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
print('Prepared isolated trail/track Entra configurations. Client registration credentials are pending. No service was enabled.')
