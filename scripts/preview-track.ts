import { resolve } from "node:path";
import { readConfig } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";

// Explicit, loopback-only QA of the production build and existing journal.
// No collector, commands, private proxy key or public authentication bypass.
const path = process.env.TRACK_CONFIG;
const user = process.env.TRACK_PREVIEW_USER;
if (!path || !user) throw new Error("TRACK_CONFIG and explicit TRACK_PREVIEW_USER are required");
const original = readConfig(path);
if (original.auth.mode !== "proxy" || !original.auth.users.includes(user)) throw new Error("Preview user must be a configured owner");
const config = () => ({ ...readConfig(path), port: 14347, publicOrigin: "http://127.0.0.1:14347", auth: { mode: "local" as const, user } });
const store = new Store(original.database);
const { server } = createTrackServer(store, config, resolve("dist/web"));
server.listen(14347, "127.0.0.1", () => console.log("Local QA on port 14347; source connections intentionally inactive"));
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => store.close()); });
