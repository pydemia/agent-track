# Agent Track frontend implementation

## Product structure

- `Track` is the default view and lists every readable run. Project bindings and unbound workspaces have different filters; a Codex repository is labelled `업무 미연결 · <repository basename>` and is never represented as a Projects business project.
- `Trail` and `Trace` show the selected run's paged event metadata. They never render event bodies or transcripts. Pagination uses the endpoint's local event-row cursor (`after`), not a source sequence.
- `Map` shows observed Run records and a separate accessible relation list with the original relation kind. Its code activity view lists only paths present in selected-run event metadata; it does not claim a diff or file change.
- The inspector keeps terminal status, observed report-related events, verification-related events, and Projects acceptance separate. Acceptance remains unknown without evidence.
- The sidebar shows source health, user, selected run, and project/workspace context. A desktop header control collapses and expands it. A 180–360 px native range control resizes it. Width and desktop collapsed state are stored in `localStorage`, keyed by the authenticated snapshot user; the stored value contains only those UI preferences. On mobile it starts closed as a drawer, traps Tab focus while open, closes with Escape, and returns focus to its opener.

## Data and security behavior

- `GET /api/snapshot` loads the authenticated `Snapshot`; `GET /api/stream` consumes named `snapshot` SSE messages containing a full snapshot; `GET /api/health` reports health without mutation.
- `GET /api/runs/:encodedRunKey/events` loads one event page, and additional pages use `?after=<decimal>` with the returned local row cursor.
- Run filtering, selected run, and view are URL-addressable. No access token or credential is placed in the URL or browser storage.
- `forbidden` sources are visible as a health state, but their cached runs and relations are filtered out. Failed requests retain a clearly labelled last valid snapshot; there is no mock-data fallback.
- Event `data` rendering is restricted to `invocationId`, `parentInvocationId`, `groupId`, `memberId`, `childRunId`, `peerSessionId`, `callId`, `tool`, `path`, `artifactId`, `permissionId`, `expiresAt`, `durationMs`, and `redacted`.
- Only a validated HTTP(S) `run.sourceUrl` is linked, and it is labelled `원본 세션`. Run-specific deep links are not inferred. Resume, retry, and cancel controls are visible as disabled, unsupported explanations; the frontend remains read-only.

## Visual system and attribution

The interface adapts the Demian proposal's dark developer-tool surface, lime accent, compact editorial table, and relation/event chronology from `C:/Users/pydemia/git/demian/docs/agent-track-integration/prototype.html` (SHA-256 `AA2A18D4FE2DE367901063E93A7BC09F524B86DFE9A1D9E489C3B1736D8C61FE`). The prototype's example data, controls, and product identity were not copied. Agent Track uses an original geometric lettermark SVG.

The reviewed shared token source is `C:/Users/pydemia/git/ui/packages/ui/src/styles.css` (SHA-256 `F94217E3934646579DEB168AEC074F01471D7C616CB682167C6208A820929956`); the accompanying source/provenance registry is `C:/Users/pydemia/git/ui/registry/provenance.json` (SHA-256 `0000BC11E2979C9E2029B86B7223D2C9BDF2C2DC8A73E090422F26F172A362D0`, registry review date 2026-10-02). The registry describes pydemia/ui originals as project-owned and records upstream component dependencies/licensing. No component code or external dependency was copied. The implementation takes only the compact 4/8/12/16/24 px spacing rhythm, 14 px body / 12 px caption scale, and 5 px small-radius guidance as reference, then defines Agent Track-specific dark/lime semantic colors in `apps/web/src/styles.css`; the light product palette is intentionally not transplanted because it conflicts with the approved dark proposal direction.

## Runtime and accessibility

- Vite serves `apps/web` and proxies `/api` to `http://127.0.0.1:14345`; production output is `dist/web`. No API server configuration was changed.
- `apps/web/index.html` links an original vector favicon at `/favicon.svg`.
- Controls use native buttons, selects, search inputs, tables, and a labelled range input. Current navigation uses `aria-current`; selected runs expose `aria-pressed`; connection and error states are announced; keyboard focus is visible. Reduced-motion preferences are respected.
- The React root uses a typed inline CSS custom property for the adjustable sidebar width. Production CSP must allow style attributes for React-generated style attributes (`style-src-attr 'unsafe-inline'`); script policy can remain strict. No inline script is used.

## Remaining integration limits

The frontend displays only what the authenticated snapshot and event endpoints return. Assistant/Projects capabilities, permission workflows, execution controls, code diffs, and Run-specific source deep links are not implemented by this UI. Browser CSP, favicon bytes and response headers, actual authenticated API behavior, and responsive keyboard behavior require verification in the deployed application environment.
