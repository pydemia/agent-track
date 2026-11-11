import { spawn } from "node:child_process";

/** The launcher owns cleanup until both readiness and record persistence succeed. */
export async function launchRecordedWeb(options) {
  const child = spawn(options.executable, options.args, { cwd: options.cwd, env: options.env, windowsHide: true, detached: true, stdio: ["ignore", options.stdoutFd ?? "ignore", options.stderrFd ?? "ignore"] });
  const exited = new Promise(resolve => child.once("exit", resolve));
  let released = false;
  try {
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    const record = { ...options.record, pid: child.pid, startedAt: new Date().toISOString(), state: "starting" };
    await options.persist(record);
    if (!(await options.verify(record, child))) throw new Error("Owned web failed readiness");
    const ready = { ...record, state: "ready" };
    await options.persist(ready);
    child.unref(); released = true;
    return ready;
  } finally {
    if (!released && child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill();
      let timer;
      try {
        await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned web cleanup could not be verified")), 3000); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
  }
}
