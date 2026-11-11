import { backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Store } from "../packages/storage/store.ts";
import { bindingSchema } from "../packages/contracts/index.ts";
import { readFile } from "node:fs/promises";

const [command, database, destination, cutoff] = process.argv.slice(2);
if (!database || !existsSync(database)) throw new Error("Existing database path required");
const store = new Store(resolve(database));
try {
  if (command === "check") console.log(JSON.stringify({ integrity: store.integrity() }));
  else if (["backup", "archive"].includes(command ?? "") && destination) {
    if (command === "archive" && (!cutoff || !Number.isFinite(Date.parse(cutoff)))) throw new Error("Archive cutoff ISO timestamp required");
    const target = resolve(destination);
    if (existsSync(target)) throw new Error("Backup destination already exists");
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    await backup(store.db, target);
    const restored = new Store(target);
    try {
      if (restored.integrity() !== "ok") throw new Error("Backup integrity check failed");
      console.log(JSON.stringify({ backedUp: true, integrity: "ok" }));
    } finally { restored.close(); }
    if (command === "archive") console.log(JSON.stringify({ pruned: store.pruneBefore(cutoff!) }));
  } else if (command === "bind" && destination) {
    // Explicit operator import, not Projects mutation or inferred business ownership.
    const binding = bindingSchema.parse(JSON.parse(await readFile(destination, "utf8")));
    store.bind(binding, "local-operator");
    console.log(JSON.stringify({ bound: true, provenance: binding.provenance }));
  } else throw new Error("Use check <db>, backup <db> <new-file>, archive <db> <new-backup> <cutoff-ISO>, or bind <db> <binding-json>");
} finally { store.close(); }
