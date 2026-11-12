import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { configSchema } from "../apps/api/config.ts";
import { sourceIdentity } from "../apps/api/source-identity.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function configuration() {
  const user = "fixture@example.test";
  const common = { users: [user], device: "fixture", label: "fixture" };
  return { database: resolve(".runtime", "unused-fixture.sqlite"), publicOrigin: "https://track.example.test",
    auth: { mode: "local" as const, user }, sources: [
      { ...common, id: "assistant", kind: "assistant" as const, baseUrl: "https://assistant.example.test",
        assistantCredentialFile: resolve(".runtime", "unused-reader.json"), assistantUser: user,
        assistantOwnerId: "sso-sub:" + "a".repeat(64), assistantPrincipalId: "reader", assistantProjectsSourceId: "projects",
        assistantProtocol: 2 as 1 | 2, assistantDemianMappings: [{ origin: "https://api.demian.example.test",
          organizationId: uuid(1), workspaceId: uuid(2), sourceId: "demian" }] },
      { ...common, id: "projects", kind: "projects" as const, baseUrl: "https://projects.example.test",
        projectsCredentialFile: resolve(".runtime", "unused-projects.json"), projectsUser: user,
        projectsAccountId: uuid(3), projectsPrincipalId: "reader" },
      { ...common, id: "demian", kind: "demian" as const, baseUrl: "http://127.0.0.1:8080", organizationId: uuid(1) },
    ] };
}

test("explicit producer tuple can map to a separate loopback native API without changing durable source identity", () => {
  const parsed = configSchema.parse(configuration());
  assert.equal(parsed.sources[0]!.assistantDemianMappings![0]!.origin, "https://api.demian.example.test");
  const source = parsed.sources[0]!;
  const { assistantProtocol: _protocol, assistantDemianMappings: _mappings, ...v1 } = source;
  assert.equal(sourceIdentity(source), sourceIdentity(v1));
  assert.equal(configSchema.safeParse({ ...configuration(), sources: [v1, ...parsed.sources.slice(1)] }).success, true);
});

for (const invalid of ["http", "credentials", "path", "slash", "duplicate", "v1", "organization", "source", "actor", "Projects"] as const)
  test(`producer mapping rejects ${invalid} configuration`, () => {
    const config = configuration();
    const assistant = config.sources[0]!;
    // Find by source ID so this fixture does not assume a homogeneous source array.
    if (!("assistantDemianMappings" in assistant)) throw new Error("Invalid fixture");
    const mapping = assistant.assistantDemianMappings![0]!;
    if (invalid === "http") mapping.origin = "http://api.demian.example.test";
    if (invalid === "credentials") mapping.origin = "https://user:secret@api.demian.example.test";
    if (invalid === "path") mapping.origin += "/api";
    if (invalid === "slash") mapping.origin += "/";
    if (invalid === "duplicate") assistant.assistantDemianMappings!.push({ ...mapping });
    if (invalid === "v1") assistant.assistantProtocol = 1;
    if (invalid === "organization") mapping.organizationId = uuid(90);
    if (invalid === "source") mapping.sourceId = "projects";
    if (invalid === "actor") config.sources[2]!.users = ["other@example.test"];
    if (invalid === "Projects") assistant.assistantProjectsSourceId = "missing-projects";
    assert.equal(configSchema.safeParse(config).success, false);
  });
