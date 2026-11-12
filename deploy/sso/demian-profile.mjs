import { randomBytes } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

export const demianSso = Object.freeze({
  hostname: "demian.pydemia.ai",
  tenantId: "fb44f64f-973f-480d-ab48-f30f3bababb6",
  ownerEmail: "pydemia@pydemia.ai",
  oauthPort: 14430,
  bridgePort: 14431,
  transportPort: 14432,
  windowsGatePort: 3100,
});

const otherClients = new Set([
  "8e026114-f50c-454c-9d70-76490df3dfd0",
  "4d28c8bb-ab49-489e-aa85-b0934479620b",
]);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Render only. No files, processes, app registrations or credentials are read. */
export function buildDemianSsoProfile({ home, clientId, cookieSecret }) {
  if (typeof home !== "string" || home.trim() !== home || !/^\/[A-Za-z0-9_./-]+$/.test(home) ||
      posix.normalize(home) !== home || home === "/" || home.endsWith("/")) {
    throw new Error("Expected a canonical Linux home path");
  }
  if (typeof clientId !== "string" || clientId.length !== 36 || !uuid.test(clientId) ||
      clientId === "00000000-0000-0000-0000-000000000000" || otherClients.has(clientId)) {
    throw new Error("Expected a separate Demian Entra client ID");
  }
  const cookie = cookieSecret ?? randomBytes(32).toString("base64url") + "=";
  if (typeof cookie !== "string" || !/^[A-Za-z0-9_-]{43}=$/.test(cookie) ||
      Buffer.from(cookie, "base64url").length !== 32 ||
      Buffer.from(cookie, "base64url").toString("base64url") + "=" !== cookie) {
    throw new Error("Expected a canonical 32-byte cookie secret");
  }
  const root = `${home}/.local/share/agent-track-sso`;
  const app = `${root}/demian`;
  const callback = `https://${demianSso.hostname}/oauth2/callback`;
  const cfg = `provider = "entra-id"
provider_display_name = "Microsoft Entra ID"
client_id = "${clientId}"
http_address = "127.0.0.1:${demianSso.oauthPort}"
upstreams = ["http://127.0.0.1:${demianSso.bridgePort}/"]
redirect_url = "${callback}"
oidc_issuer_url = "https://login.microsoftonline.com/${demianSso.tenantId}/v2.0"
scope = "openid profile email"
oidc_email_claim = "preferred_username"
authenticated_emails_file = "${app}/allowed-emails"
code_challenge_method = "S256"
insecure_oidc_skip_nonce = false
cookie_name = "__Host-demian"
cookie_secure = true
cookie_httponly = true
cookie_samesite = "lax"
cookie_path = "/"
cookie_expire = "8h"
cookie_secret = "${cookie}"
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
api_routes = ["^/api(/|$)", "^/track-context(/|$)"]
`;
  // The existing gate remains private. OAuth tokens and browser Basic headers
  // never become its credential; a separate private bridge.env supplies it.
  const caddy = `{
    admin off
    auto_https off
}
http://:${demianSso.bridgePort} {
    bind 127.0.0.1
    reverse_proxy http://127.0.0.1:${demianSso.transportPort} {
        header_up Host ${demianSso.hostname}
        header_up Authorization "{env.DEMIAN_GATE_BASIC_AUTHORIZATION}"
        header_up -X-Forwarded-Access-Token
        header_up -X-Auth-Request-Access-Token
        flush_interval -1
    }
}
`;
  const unit = (description, command, environment) => `[Unit]
Description=${description}
After=network-online.target
[Service]
WorkingDirectory=${app}
EnvironmentFile=${app}/${environment}
ExecStart=${command}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
[Install]
WantedBy=default.target
`;
  return {
    version: 1,
    profile: "demian",
    appRoot: app,
    unitsRoot: `${home}/.config/systemd/user`,
    registration: { clientId, tenantId: demianSso.tenantId, callback,
      allowedEmail: demianSso.ownerEmail, extraGraphPermissions: [] },
    appFiles: {
      "oauth2-proxy.cfg": cfg,
      Caddyfile: caddy,
      "allowed-emails": `${demianSso.ownerEmail}\n`,
      "registration.json": JSON.stringify({ version: 1, clientId,
        tenantId: demianSso.tenantId, callback }, null, 2) + "\n",
    },
    unitFiles: {
      "agent-demian-sso.service": unit("Demian Microsoft Entra ID authentication",
        `${root}/bin/oauth2-proxy --config=${app}/oauth2-proxy.cfg`, "client.env"),
      "agent-demian-sso-upstream.service": unit("Demian private authenticated upstream",
        `${root}/bin/caddy run --config ${app}/Caddyfile --adapter caddyfile`, "bridge.env"),
    },
    requiredPrivateFiles: ["client.env", "bridge.env"],
    reverseForward: { bindHost: "127.0.0.1", serverPort: demianSso.transportPort,
      destinationHost: "127.0.0.1", destinationPort: demianSso.windowsGatePort },
  };
}

/** Validate a supplied renderer result before any deployment writes it. */
export function validateDemianSsoFiles(profile) {
  if (!profile || profile.version !== 1 || profile.profile !== "demian" ||
      Object.keys(profile.appFiles ?? {}).sort().join(",") !== "Caddyfile,allowed-emails,oauth2-proxy.cfg,registration.json" ||
      Object.keys(profile.unitFiles ?? {}).sort().join(",") !== "agent-demian-sso-upstream.service,agent-demian-sso.service") {
    throw new Error("Invalid Demian SSO file set");
  }
  const match = /^(.*)\/\.local\/share\/agent-track-sso\/demian$/.exec(profile.appRoot ?? "");
  const cookie = /^cookie_secret = "([A-Za-z0-9_-]+=)"$/m.exec(profile.appFiles["oauth2-proxy.cfg"] ?? "")?.[1];
  if (!match || !cookie) throw new Error("Invalid Demian SSO profile");
  const expected = buildDemianSsoProfile({ home: match[1], clientId: profile.registration?.clientId, cookieSecret: cookie });
  if (!isDeepStrictEqual(profile, expected)) throw new Error("Demian SSO profile changed");
  return profile;
}
