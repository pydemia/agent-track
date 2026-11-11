"""Prepare only Track's isolated Entra upstream; never print credentials."""
from pathlib import Path
import re
import subprocess

root = Path.home() / ".local/share/agent-track-sso"
app = root / "track"
key = (app / "proxy-key").read_text().strip()
if not re.fullmatch(r"[0-9a-f]{64}", key):
    raise SystemExit("Invalid private Track proxy key")

caddy = f"""{{
    admin off
    auto_https off
}}
http://:14344 {{
    bind 127.0.0.1
    reverse_proxy http://127.0.0.1:14346 {{
        header_up X-Track-Proxy-Key {key}
        header_up -Authorization
        header_up -X-Forwarded-Access-Token
        header_up -X-Auth-Request-Access-Token
        flush_interval -1
    }}
}}
"""
target = app / "Caddyfile"
target.write_text(caddy)
target.chmod(0o600)
validation = subprocess.run(
    [str(root / "bin/caddy"), "validate", "--config", str(target), "--adapter", "caddyfile"],
    capture_output=True,
)
if validation.returncode:
    raise SystemExit("Track upstream validation failed; secret-bearing output suppressed")

cfg = app / "oauth2-proxy.cfg"
text = cfg.read_text()
text = re.sub(r"^api_routes = .*?$", 'api_routes = ["^/api(/|$)"]', text, flags=re.M)
cfg.write_text(text)
cfg.chmod(0o600)
unit = Path.home() / ".config/systemd/user/agent-track-upstream.service"
unit.write_text(f"""[Unit]
Description=Agent Track isolated authenticated upstream
After=network-online.target
[Service]
ExecStart={root}/bin/caddy run --config {target} --adapter caddyfile
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
[Install]
WantedBy=default.target
""")
unit.chmod(0o600)
subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
print("Track upstream validated and prepared. Trail configuration preserved.")
