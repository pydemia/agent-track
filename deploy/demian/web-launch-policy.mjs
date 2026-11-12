import { isAbsolute, join, relative, resolve } from "node:path";

const absolute = value => typeof value === "string" && isAbsolute(value) && !/[\x00-\x1f\x7f"]/.test(value);
function operation(value) {
  if (value !== undefined && (typeof value !== "string" || value.length !== 36 ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) || value === "00000000-0000-0000-0000-000000000000")) {
    throw new TypeError("Invalid web operation ID");
  }
  return value;
}

/** Distinct operation receipts cannot overwrite a previous launch's identity. */
export function webLaunchRecordPath(root, profile, operationId, state) {
  operation(operationId);
  if (!absolute(root) || !["qa", "local", "public"].includes(profile) || !["starting", "ready"].includes(state)) {
    throw new TypeError("Invalid web launch receipt");
  }
  return join(root, "processes", operationId ? `${profile}-${operationId}.${state}.json` : `${profile}.json`);
}

export function webLaunchArguments(entry, operationId) {
  operation(operationId);
  if (!absolute(entry)) throw new TypeError("Invalid web entry");
  return operationId ? [entry, `--agent-track-operation=${operationId}`] : [entry];
}

/** Only a retained child's expected executable, entry and operation may be adopted. */
export function matchesWebLaunch(actual, pid, executable, entry, operationId) {
  const args = webLaunchArguments(entry, operationId);
  if (!Number.isSafeInteger(pid) || pid < 1 || !absolute(executable) || !actual || actual.pid !== pid ||
      typeof actual.name !== "string" || actual.name.toLowerCase() !== "node.exe" ||
      !absolute(actual.executable) || relative(resolve(actual.executable), resolve(executable)) !== "" ||
      typeof actual.created !== "string" || actual.created.length !== 28 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(actual.created)) return false;
  const spellings = value => /\s/.test(value) ? [`"${value}"`] : [value, `"${value}"`];
  const commands = spellings(executable).flatMap(exe => spellings(args[0]).map(file =>
    `${exe} ${file}${operationId ? ` --agent-track-operation=${operationId}` : ""}`));
  return commands.includes(actual.command);
}
