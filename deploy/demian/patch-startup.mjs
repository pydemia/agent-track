import assert from "node:assert/strict";

function once(text, original, replacement) {
  assert.equal(text.split(original).length, 2, "Native startup changed; preserve it for review.");
  return text.replace(original, replacement);
}

/** Only the web launch changes; API, worker, gate and tunnel launches remain. */
export function patchStartup(text, profile) {
  if (profile === "local") {
    text = once(text, "const repo = config.repository", "const repo = config.repository\nconst trackWeb = await import('./track-context/web-release-policy.mjs').then(module => module.loadWebRelease(state)).catch(() => null)");
    text = once(text,
      "await launch('web', [repo + '/node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'], repo + '/apps/web', {",
      "await launch('web', trackWeb ? [trackWeb.entry] : [repo + '/node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'], trackWeb?.cwd ?? repo + '/apps/web', {");
    text = once(text, "  ...commonEnv, DEMIAN_API_INTERNAL_URL: config.apiUrl, DEMIAN_WEB_PUBLIC_URL: config.webUrl,",
      "  ...commonEnv, DEMIAN_API_INTERNAL_URL: config.apiUrl, DEMIAN_WEB_PUBLIC_URL: config.webUrl,\n  ...(trackWeb ? { HOSTNAME: '127.0.0.1', PORT: '3000', DEMIAN_TRACK_CONTEXT_FILE: trackWeb.contextFile } : {}),");
  } else {
    assert.equal(profile, "public");
    text = once(text, "const children=[]", "const trackWeb = await import('./track-context/web-release-policy.mjs').then(module => module.loadWebRelease(root)).catch(() => null)\nconst children=[]");
    text = once(text,
      "[service.repository+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.webPort)],service.repository+'/apps/web',",
      "trackWeb ? [trackWeb.entry] : [service.repository+'/node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(config.webPort)],trackWeb?.cwd ?? service.repository+'/apps/web',");
    text = once(text, "DEMIAN_WEB_PUBLIC_URL:config.publicUrl})",
      "DEMIAN_WEB_PUBLIC_URL:config.publicUrl,...(trackWeb ? {HOSTNAME:'127.0.0.1',PORT:String(config.webPort),DEMIAN_TRACK_CONTEXT_FILE:trackWeb.contextFile} : {})})");
  }
  return text;
}
