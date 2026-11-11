"""Run interactively on the server; no secrets in command arguments or output."""
import getpass
import os
from pathlib import Path
import re
import sys

app = sys.argv[1]
if app not in ('trail', 'track'):
    raise SystemExit('Expected trail or track')
root = Path.home() / '.local/share/agent-track-sso' / app
target = root / 'client.env'
if target.exists():
    raise SystemExit('Existing configuration preserved. Rotate explicitly.')
client_id = sys.argv[2] if len(sys.argv) > 2 else input(f'{app} application (client) ID: ').strip()
if not re.fullmatch(r'[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', client_id):
    raise SystemExit('Invalid client UUID')
client_secret = getpass.getpass('Client secret Value (hidden): ')
if not re.fullmatch(r'[A-Za-z0-9_.~\-]+', client_secret):
    raise SystemExit('Unexpected client secret characters')
fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as file:
    file.write(f'OAUTH2_PROXY_CLIENT_ID={client_id}\nOAUTH2_PROXY_CLIENT_SECRET={client_secret}\n')
print('Saved per-app credentials privately. No service restart or route switch performed.')
