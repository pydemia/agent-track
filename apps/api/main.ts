import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readConfig } from "./config.ts";
import { createTrackServer } from "./server.ts";
import { Store } from "../../packages/storage/store.ts";
import { CommandService } from "../../packages/commands/index.ts";

const path = process.env.TRACK_CONFIG;
if (!path) throw new Error("TRACK_CONFIG must point to a private configuration file");
const config = () => readConfig(path);
const initial = config();
mkdirSync(dirname(initial.database), { recursive: true, mode: 0o700 });
const store = new Store(initial.database);
new CommandService(store).recoverInterrupted();
const { server, sources } = createTrackServer(store, config, resolve("dist/web"));
server.listen(initial.port, "127.0.0.1", () => {
  console.log(`Agent Track 0.1.0 listening on loopback port ${initial.port}`);
  void sources.start();
});
const stop = () => { sources.stop(); server.close(() => { store.close(); process.exit(0); }); server.closeAllConnections(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
