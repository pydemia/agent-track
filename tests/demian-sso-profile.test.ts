import assert from "node:assert/strict";
import test from "node:test";
import { buildDemianSsoProfile, demianSso, validateDemianSsoFiles } from "../deploy/sso/demian-profile.mjs";

const input = { home: "/home/fixture", clientId: "11111111-1111-4111-8111-111111111111",
  cookieSecret: Buffer.alloc(32, 42).toString("base64url") + "=" };

test("Demian's rendered file set is isolated from Trail/Track and requires its own client and bridge credentials", () => {
  const profile = buildDemianSsoProfile(input);
  assert.equal(validateDemianSsoFiles(profile), profile);
  assert.equal(profile.registration.callback, "https://demian.pydemia.ai/oauth2/callback");
  assert.deepEqual(profile.registration.extraGraphPermissions, []);
  assert.equal(profile.appFiles["allowed-emails"], "pydemia@pydemia.ai\n");
  assert.deepEqual(profile.requiredPrivateFiles, ["client.env", "bridge.env"]);
  assert.deepEqual(profile.reverseForward, { bindHost: "127.0.0.1", serverPort: 14432, destinationHost: "127.0.0.1", destinationPort: 3100 });
  assert.match(profile.appFiles.Caddyfile, /header_up Authorization "\{env\.DEMIAN_GATE_BASIC_AUTHORIZATION\}"/);
  for (const file of Object.values(profile.unitFiles)) {
    assert.ok(file.includes(profile.appRoot));
    assert.match(file, /NoNewPrivileges=true\nPrivateTmp=true\nUMask=0077/);
  }
  const cfg = profile.appFiles["oauth2-proxy.cfg"];
  for (const setting of ['provider = "entra-id"', 'code_challenge_method = "S256"',
    'cookie_name = "__Host-demian"', 'cookie_secure = true', 'cookie_httponly = true',
    'insecure_oidc_skip_nonce = false', 'pass_basic_auth = false', 'pass_access_token = false',
    'scope = "openid profile email"', 'api_routes = ["^/api(/|$)", "^/track-context(/|$)"]']) assert.ok(cfg.includes(setting), setting);
  assert.equal(Object.isFrozen(demianSso), true);
});

test("reused app IDs, path/config injection and noncanonical cookie material are rejected before rendering", () => {
  for (const clientId of ["8e026114-f50c-454c-9d70-76490df3dfd0", "4d28c8bb-ab49-489e-aa85-b0934479620b",
    "00000000-0000-0000-0000-000000000000", input.clientId + "\n", input.clientId + '\npass_basic_auth = true']) {
    assert.throws(() => buildDemianSsoProfile({ ...input, clientId }));
  }
  for (const home of ["/", "/home/a/../b", "/home/a/", "/home/user with spaces", "/home/a\n", "/home/a\nEnvironment=X", "relative", "C:/Users/fixture"]) {
    assert.throws(() => buildDemianSsoProfile({ ...input, home }));
  }
  for (const cookieSecret of ["x".repeat(32), input.cookieSecret + "\n", Buffer.alloc(16).toString("base64"), input.cookieSecret.slice(0, -1)]) {
    assert.throws(() => buildDemianSsoProfile({ ...input, cookieSecret }));
  }
});

test("fresh renders use distinct private cookies and cannot silently widen a reviewed profile", () => {
  const first = buildDemianSsoProfile({ home: input.home, clientId: input.clientId });
  const second = buildDemianSsoProfile({ home: input.home, clientId: input.clientId });
  assert.notEqual(first.appFiles["oauth2-proxy.cfg"], second.appFiles["oauth2-proxy.cfg"]);
  for (const mutate of [
    (p: typeof first) => { p.appFiles["allowed-emails"] += "another@example.test\n"; },
    (p: typeof first) => { p.appFiles.Caddyfile += "\nhttp://:3100 {}\n"; },
    (p: typeof first) => { Object.assign(p.appFiles, { "../track/client.env": "forbidden" }); },
    (p: typeof first) => { p.unitsRoot = "/etc/systemd/system"; },
    (p: typeof first) => { Object.assign(p, { ignoredField: undefined }); },
  ]) {
    const changed = structuredClone(first); mutate(changed);
    assert.throws(() => validateDemianSsoFiles(changed));
  }
});

test("reviewed profiles validate independently of JSON object key ordering", () => {
  const profile = buildDemianSsoProfile(input);
  const reordered = Object.fromEntries(Object.entries(profile).reverse());
  assert.equal(validateDemianSsoFiles(reordered), reordered);
});
