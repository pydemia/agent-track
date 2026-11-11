"""Validate saved per-app credentials; start only the deployed Trail authentication stack."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

root = Path.home() / '.local/share/agent-track-sso'
expected = {'trail': '8e026114-f50c-454c-9d70-76490df3dfd0', 'track': '4d28c8bb-ab49-489e-aa85-b0934479620b'}
results = {}
for app, client in expected.items():
    file = root / app / 'client.env'
    values = dict(line.split('=', 1) for line in file.read_text().splitlines() if '=' in line)
    assert values['OAUTH2_PROXY_CLIENT_ID'] == client, f'{app}: client ID mismatch'
    assert values.get('OAUTH2_PROXY_CLIENT_SECRET'), f'{app}: credential missing'
    assert file.stat().st_mode & 0o777 == 0o600, f'{app}: credential file permissions'
    result = subprocess.run([str(root / 'bin/oauth2-proxy'), f'--config={root / app / "oauth2-proxy.cfg"}', '--config-test'], env={**os.environ, **values}, capture_output=True)
    assert result.returncode == 0, f'{app}: configuration validation failed (private output withheld)'
    results[app] = {'clientIdMatches': True, 'credentialMode': '600', 'configValid': True}

result = subprocess.run([str(root / 'bin/caddy'), 'validate', '--config', str(root / 'Caddyfile'), '--adapter', 'caddyfile'], capture_output=True)
assert result.returncode == 0, 'Caddy validation failed'
subprocess.run(['systemctl', '--user', 'enable', '--now', 'agent-trail-sso-upstream.service', 'agent-trail-sso.service'], check=True, capture_output=True)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

opener = urllib.request.build_opener(NoRedirect)
for attempt in range(30):
    try:
        request = urllib.request.Request('http://127.0.0.1:14340/', headers={'Host': 'trail.pydemia.ai', 'X-Forwarded-Proto': 'https'})
        try:
            response = opener.open(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        if response.status == 302:
            break
    except urllib.error.URLError:
        pass
    time.sleep(0.3)
assert response.status == 302, 'SSO listener not ready'
location = urllib.parse.urlparse(response.headers['Location'])
query = urllib.parse.parse_qs(location.query)
assert location.hostname == 'login.microsoftonline.com'
assert query['client_id'] == [expected['trail']]
assert query['redirect_uri'] == ['https://trail.pydemia.ai/oauth2/callback']
assert query['code_challenge_method'] == ['S256']
assert query.get('nonce') and query.get('state')
cookie = response.headers.get('Set-Cookie', '')
assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=Lax' in cookie
results['login'] = {'status': 302, 'provider': location.hostname, 'callbackMatches': True, 'pkce': 'S256', 'nonceAndState': True, 'secureCookie': True}
for name, headers in [('unauth', {}), ('forgedIdentity', {'X-Forwarded-Email': 'pydemia@pydemia.ai', 'X-Agent-Track-Trust': 'wrong'}), ('fakeCookie', {'Cookie': '__Host-agent-trail=forged'})]:
    request = urllib.request.Request('http://127.0.0.1:14340/panel', headers={'Host': 'trail.pydemia.ai', 'X-Forwarded-Proto': 'https', **headers})
    try:
        response = opener.open(request, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == 401, name
    results[name] = {'status': 401, 'basicChallenge': response.headers.get('WWW-Authenticate', '').lower().startswith('basic')}
    assert not results[name]['basicChallenge']
results['track'] ['serviceStarted'] = False
(root / 'activation-verification.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results))
