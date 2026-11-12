/** Resolve activation ownership first, then recover each owned profile independently. */
export async function recoverWebProfiles(options) {
  await options.activateFallback();
  const profiles = ["local", "public"];
  const identities = {};
  const failedProfiles = [];
  const metadataUpdateFailures = [];
  for (const profile of profiles) {
    const replacement = options.replacements[profile];
    if (!replacement) continue;
    try { await options.stop(replacement); } catch { failedProfiles.push(profile); }
  }
  for (const profile of profiles) {
    if (failedProfiles.includes(profile)) continue;
    try {
      if (options.stopped.has(profile)) identities[profile] = await options.start(profile);
      else {
        const original = options.originals[profile];
        if ((await options.inspectOriginal(original)).exited) { await options.stop(original); identities[profile] = await options.start(profile); }
        else identities[profile] = original;
      }
    } catch { failedProfiles.push(profile); }
  }
  for (const [profile, record] of Object.entries(identities)) {
    try { await options.commitProfile(profile, record); } catch { metadataUpdateFailures.push(profile); }
  }
  return { recoveredIdentities: identities, failedProfiles, metadataUpdateFailures };
}

/** Recover only the explicitly supplied public service; callbacks own all I/O. */
export async function recoverPublicWeb(options) {
  const result = { activationFailed: false, recoveryFailed: false, metadataUpdateFailed: false };
  const { original, replacement } = options;
  const valid = record => record != null && Number.isSafeInteger(record.pid) && record.pid > 0;
  // Equal PIDs cannot distinguish a reused PID from duplicate lifecycle records.
  if (!valid(original) || (replacement !== undefined && (!valid(replacement) || replacement.pid === original.pid))) {
    result.recoveryFailed = true;
    return result;
  }
  try { await options.activateFallback(); } catch { result.activationFailed = true; }
  try {
    const inspect = async record => {
      const observation = await options.inspect(record);
      if (observation?.state !== "owned-live" && observation?.state !== "exited-free" &&
          !(observation?.state === "exited-occupied" && Number.isSafeInteger(observation.listenerPid) &&
            observation.listenerPid > 0 && observation.listenerPid !== record.pid)) {
        throw new Error("Public identity or port ownership is not safe");
      }
      return observation;
    };
    // Validate both records before any destructive operation, even if one exited.
    const originalState = await inspect(original);
    const replacementState = replacement === undefined ? undefined : await inspect(replacement);
    // An exited original commonly shares the public port with the known live
    // replacement. Occupancy is allowed only for that independently verified peer.
    if (originalState.state === "exited-occupied" &&
        (originalState.listenerPid !== replacement?.pid || replacementState?.state !== "owned-live")) {
      throw new Error("Unknown public listener preserved");
    }
    if (replacementState?.state === "exited-occupied" &&
        (replacementState.listenerPid !== original.pid || originalState.state !== "owned-live")) {
      throw new Error("Unknown public listener preserved");
    }
    if (originalState.state === "owned-live" && replacementState?.state === "owned-live") {
      throw new Error("Conflicting public ownership observations");
    }
    if (replacementState?.state === "owned-live") {
      await options.journalIntent(replacement);
      // Journaling may yield control; revalidate ownership before signaling.
      if ((await inspect(replacement)).state === "owned-live") {
        try { await options.stop(replacement); } catch { /* Inspection reconciles lost output. */ }
        if ((await inspect(replacement)).state !== "exited-free") {
          throw new Error("Replacement has not released the public port");
        }
      }
    }
    // No stop receipt is needed: a fresh inspection decides retain versus start.
    const current = await inspect(original);
    if (current.state === "exited-occupied") throw new Error("Occupied public listener preserved");
    const recovered = current.state === "owned-live"
      ? original
      : await options.startFrozenFallback();
    if (!valid(recovered)) throw new Error("Invalid recovered public identity");
    if ((await inspect(recovered)).state !== "owned-live") throw new Error("Recovered public web not ready");
    result.recoveredIdentity = recovered;
  } catch {
    result.recoveryFailed = true;
  }
  if (result.recoveredIdentity) {
    try { await options.commitPublic(result.recoveredIdentity); } catch { result.metadataUpdateFailed = true; }
  }
  return result;
}
