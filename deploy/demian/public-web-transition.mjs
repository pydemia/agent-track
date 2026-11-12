/** Coordinate public-web callbacks without importing platform or I/O code. */
export async function executePublicWebTransition(options) {
  const result = {
    stage: "validate-original",
    committed: false,
    stopAttempted: false,
    journalFailed: false,
    reportFailed: false,
  };
  const valid = record => record != null &&
    Number.isSafeInteger(record.pid) && record.pid > 0;
  const { original } = options;
  // No callback may run with an invalid original, including reporting.
  if (!valid(original)) {
    return { ...result, failure: "invalid-original" };
  }
  const journal = async (stage, record) => {
    result.stage = stage;
    try {
      await options.journal(stage, record);
    } catch {
      result.journalFailed = true;
      throw new Error("Public transition journal failed");
    }
  };
  try {
    result.stage = "prepare";
    await options.prepare();
    result.stage = "preserve-before-stop";
    await options.checkPreserved();
    result.stage = "inspect-original";
    if ((await options.inspect(original))?.state !== "owned-live") {
      throw new Error("Original public identity is not owned-live");
    }
    await journal("stop-intent", original);
    result.stopAttempted = true;
    result.stage = "stop";
    try {
      await options.stop(original);
    } catch {
      // Output loss is reconciled by inspecting this same frozen identity.
    }
    result.stage = "inspect-stopped-original";
    if ((await options.inspect(original))?.state !== "exited-free") {
      throw new Error("Original public port has not been released");
    }
    await journal("start-intent");
    result.stage = "start-candidate";
    let candidate;
    try {
      candidate = await options.startCandidate();
    } catch {
      result.stage = "find-candidate";
      // The adapter looks up only this operation's receipt. Never start twice.
      candidate = await options.findCandidate();
    }
    result.stage = "validate-candidate";
    if (!valid(candidate) || candidate.pid === original.pid) {
      throw new Error("Invalid or ambiguous public candidate identity");
    }
    result.replacement = candidate;
    result.stage = "inspect-candidate";
    if ((await options.inspect(candidate))?.state !== "owned-live") {
      throw new Error("Candidate public identity is not owned-live");
    }
    result.stage = "verify-candidate";
    await options.verifyCandidate(candidate);
    result.stage = "preserve-before-commit";
    await options.checkPreserved();
    await journal("commit-intent", candidate);
    result.stage = "commit-candidate";
    await options.commitCandidate(candidate);
    result.stage = "preserve-after-commit";
    await options.checkPreserved();
    result.committed = true;
  } catch {
    result.failure = "transition-failed";
    if (result.stopAttempted) {
      try {
        const recovery = await options.recover(result.replacement);
        // Copy only the public contract, never arbitrary callback error details.
        result.recovery = {
          activationFailed: recovery.activationFailed,
          recoveryFailed: recovery.recoveryFailed,
          metadataUpdateFailed: recovery.metadataUpdateFailed,
          ...(recovery.recoveredIdentity === undefined ? {} : {
            recoveredIdentity: recovery.recoveredIdentity,
          }),
        };
      } catch {
        result.recovery = {
          activationFailed: false,
          recoveryFailed: true,
          metadataUpdateFailed: false,
        };
      }
    }
  }
  // The commit boundary is irreversible here: reporting cannot roll it back.
  if (result.committed) {
    try {
      await journal("committed", result.replacement);
    } catch {
      result.failure = "reporting-failed";
    }
  }
  try {
    await options.report({ ...result });
  } catch {
    result.reportFailed = true;
    result.failure ??= "reporting-failed";
  }
  return result;
}
