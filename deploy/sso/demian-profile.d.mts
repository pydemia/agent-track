export const demianSso: Readonly<{ hostname: string; tenantId: string; ownerEmail: string; oauthPort: number; bridgePort: number; transportPort: number; windowsGatePort: number }>;
export interface DemianSsoProfile {
  version: 1; profile: "demian"; appRoot: string; unitsRoot: string;
  registration: { clientId: string; tenantId: string; callback: string; allowedEmail: string; extraGraphPermissions: string[] };
  appFiles: { "oauth2-proxy.cfg": string; Caddyfile: string; "allowed-emails": string; "registration.json": string };
  unitFiles: { "agent-demian-sso.service": string; "agent-demian-sso-upstream.service": string };
  requiredPrivateFiles: string[];
  reverseForward: { bindHost: string; serverPort: number; destinationHost: string; destinationPort: number };
}
export function buildDemianSsoProfile(input: { home: string; clientId: string; cookieSecret?: string }): DemianSsoProfile;
export function validateDemianSsoFiles(profile: unknown): DemianSsoProfile;
