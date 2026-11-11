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
