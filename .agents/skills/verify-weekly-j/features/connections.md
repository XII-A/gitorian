# Connection controls

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify connections`. The runner owns a temporary journal-only profile and retains screenshots, actions, HTTP traces, process exit, independent SQLite evidence, and cleanup results under `.ai-docs/verification/connections-*/`.

## GitHub entry points

- Settings > Connections: GitHub and Notion headings have their matching decorative brand logos and Connect actions instead of disconnected text. GitHub has no client-ID field or app-creation link.
- GitHub Connect: the heading control shows its starting spinner, then expands to the code, icon-only Copy code action, Cancel, and primary Open GitHub action.
- Offline start > retry: a simulated failure stays in one row (message, Cancel, Retry), without a description; retry obtains a code.
- Browser failure > Open GitHub: browser recovery guidance leaves the code usable. The button shows loading during the real IPC command with simulated browser launching.
- Copy code: accessible icon-only control confirms in place; record the OS clipboard comparison separately. A simulated clipboard failure preserves the selectable code and shows error feedback in the same icon. Late polling responses remain owned by existing behavior tests.
- Cancel / Escape: return to Connect and restore focus. Expiry and declined authorization show distinct recovery copy and offer a fresh attempt.
- Successful authorization: the same surface contracts to a compact Connecting face, then green Connected, then the hold-to-disconnect control. The identity prepares while hidden and reveals only after the final button width settles, without horizontal or secondary layout movement. Delayed avatars fade into fixed boxes. Reload preserves the account; encrypted fixture-token storage is required when the OS backend is available.
- Disconnect: Cancel leaves the connection intact. A held confirmation first exercises a simulated disconnect command failure and Retry; the successful retry removes the token, shows Disconnected for about 900ms, then returns to Connect. Account metadata stays in SQLite, consistent with the store contract. Without closing Settings, reconnect, observe Connected, require an active Disconnect button, then disconnect again and require an active Connect button. This repeated cycle owns the regression for stale disconnect feedback after reconnect.

## Notion entry points

Run `pnpm verify notion` for Notion-only work. It uses the same fixture transports and owning runner, but skips the entire GitHub interaction block and asserts zero GitHub API/OAuth requests. `pnpm verify connections` remains the combined entry point. For the narrow reduced-motion case set `WEEKLY_J_VERIFY_MOTION=stress` before `pnpm verify notion`.

- Connect, offline Retry, browser failure, Cancel and provider denial still use the real loopback listener and hosted handler. No token field or fabricated device code is shown.
- Authorization alone is incomplete: no saved credentials, destination or page creation before Confirm. The rounded leading picker must share the Confirm button's 4px inset and leave Cancel/Confirm visible. There is no Refresh button.
- Cold discovery shows Found 1 page after the first cursor, then Grouped 2 of 8 pages while resolving ancestors; both labels fit inside the morph on desktop/narrow. The preload event carries a per-load request ID. No overall percentage or fictional search total is displayed. Require notion-discovery-count.png and notion-grouping-count.png.
- Fresh cached pencil editing performs zero discovery search requests. After advancing the fixture main-process clock by five minutes, stale cached rows stay visible while HTTP refresh renames Shared notes to Updated shared notes; only the next picker open shows the renamed row. Require notion-cache-initial.json, notion-cache-refresh.json, notion-cached-tree-stable.png and notion-refreshed-cache-next-open.png. Persisted cache data must not contain credentials and disconnect must remove notion-pages.json. Unit behavior coverage owns cache reconstruction after restart, connection isolation, corrupt/empty caches, failed refresh and cancellation of a late response.
- Page discovery follows two API cursors. Fixtures include a three-level hierarchy, duplicate names and a missing parent. Expand Personal through its chevron without changing the selection. Clicking Personal's name selects it and closes the picker without confirming the connection.
- Nested-toggle Decisions must appear directly beneath Engineering notes at level three; block rows stay hidden. Projects and Archive are separate named data-source groups beneath Personal, even when their database is inside a toggle. Group labels and Enter expand/collapse without selecting or completing authorization; the backend rejects a forged group confirmation. Board entry search retains Personal and Projects, and selecting it leaves authorization pending. Inaccessible toggle ancestors retain their accessible page at the root.
- Searching Decisions exposes its named ancestors. Clearing search restores the menu's prior collapsed state. Visible row text and tooltips must never contain fixture page IDs.
- Require the rounded picker/name field and circular revert button to share the Confirm button's 4px surface inset.
- Choose Create a new page and close Settings before confirming. Reopen and require Connect, no credentials and zero created pages. A fresh authorization must work.
- Keyboard-select an existing parent page. A simulated lost-access response shows inline Retry and never creates a fallback page. Retry saves the existing destination. The connected row shows its icon/name, pencil and Disconnect; the app profile name and Open journal row are absent. Require equal vertical centers for destination identity and Disconnect.
- Pencil editing preselects the saved tree row and expands its ancestors. Cancel retains the saved destination. Edit again, choose Create a new page, type Team journal and Confirm with one click. Closing during the simulated creation delay must still finish exactly one creation. Require notion-provisioned.json to record the named destination and created: 1.
- Renderer reload with transports offline restores the saved destination row within 1200ms and makes no profile/avatar requests. Page icon metadata is persisted with settings. New image icons are downloaded and converted to bounded WebP in the main process; failed/expired images use a page glyph.
- Notion disconnect Cancel preserves the connection. A simulated failure exercises Retry; the successful held confirmation removes credentials. Reconnect, explicitly select the existing journal, and require no duplicate creation. Repeat disconnect and require active Connect.

Acceptance evidence for the Notion-only entry point is run.json, doctor.json, actions.jsonl, http-requests.json, persisted-settings.json, notion-page-tree.png, notion-page-tree-search.png, notion-edit-selected.png, notion-07-connected.png, notion-provisioned.json and captures.json. Require exit zero, passed: true, cleanup.removed: true and evidenceRetained: true. Restoring an uncommitted run requires the retained NotionPagePicker.tsx and notion-page-tree.ts under src/renderer and notion-discovery.ts and notion-discovery-cache.ts under src/main in addition to source.patch. The retained notion-smoke.mjs is a copy of tools/connections-smoke.mjs and should be restored to that original path.

## Evidence and scope

Require `run.json` with exit zero, `passed: true`, `cleanup.removed: true`, and `evidenceRetained: true`. Review `captures.json`, full PNGs, section-detail PNGs, `actions.jsonl`, `http-requests.json`, `connected-state.json`, and `persisted-settings.json`. GitHub OAuth POSTs must use its shared public ID without a client secret. Notion's provider exchange uses a fictional server-held secret through the hosted handler; the desktop sends only signed state, its verifier and a temporary code. Require real loopback traffic and no tokens in redirect URLs. Independent post-exit SQLite must retain the fixture GitHub login and omit the obsolete client-ID property.

The runner targets desktop dark and narrow dark layouts (390px may round to 391px under Windows scaling). GitHub's transient loading/check states are captured before their timers complete. Every Notion credential and registration value is fictional. Both vault files must be removed by the end of the journey.

GitHub/Notion provider HTTP, browser launching, one clipboard failure, delayed avatars, and one disconnect IPC failure per service are simulated; renderer, preload, IPC, vault, local storage, hosted handler and loopback callback are real. Unexpected HTTP requests fail. No Git repositories, live authorization, messages, or publishing are involved. This does not verify real provider credentials, organization policy, or other OS credential backends. A live authorization needs a separately authorized destination.

For reproduction, apply `source.patch`, copy the retained `connections-smoke.mjs` into `tools/`, and follow the shared runner instructions. Keep earlier failed run evidence; require its cleanup result before proceeding.

## Connection handoff motion

The combined GitHub journey records requestAnimationFrame measurements in `github-identity-motion.json`. Notion uses the same reveal mechanism for its page identity, with native screenshots and row-bound assertions in its isolated journey. Require at least three visible and settled frames, no more than 0.5px horizontal/width change during the reveal, and no more than 0.5px vertical drift once opacity reaches 0.99. The intended normal entrance moves vertically by 4px; reduced motion must contain no translation. The harness simulates a 1600ms avatar response at Node's HTTPS request boundary with fixture DNS answers and waits for image completion before finishing the trace.

Run the normal desktop journey, then the distinct narrow/reduced-motion case with long provider names:

```powershell
$env:WEEKLY_J_VERIFY_MOTION = 'stress'
try { pnpm verify connections } finally { Remove-Item Env:WEEKLY_J_VERIFY_MOTION }
```

Require both runs to exit zero with cleanup confirmed. The stress fixture uses a long GitHub login and Notion page name and retains its own independent SQLite expectation. Inspect native section screenshots as well as traces: actions must remain fully readable and within the section, with names truncated rather than actions clipped. Both success and failure/recovery paths still run. The DNS/HTTPS avatar transport fixture is simulated; it is not evidence of live provider image availability.

When reproducing a dirty revision, also copy the retained `ConnectionIdentity.tsx` into `src/renderer/ConnectionIdentity.tsx` before building, because untracked new files do not appear in Git's tracked source patch.

## Disconnect result ownership

`useDisconnectTransition` retains the operation's controlled feedback independently of persisted connection truth. The owning journey samples the native renderer every animation frame for both first and repeated disconnects in `github-disconnect-{first,repeat}.json` and `notion-disconnect-{first,repeat}.json`. Require the active done face to say Disconnected for 700?1800ms (the intended hold is 900ms), then require idle Connect. An absent/one-frame result and an indefinitely retained result must both fail. While the done face is visible, a real state command must already report the service disconnected.

Before each first hold, Cancel must preserve the existing connection. The IPC fixture rejects the first disconnect command before it reaches the backend; verify the error stays in place, the connection is retained, and Retry reaches the readable result. This simulated failure does not prove recovery from arbitrary partial filesystem/store failures. The repeated cycle then disconnects without the injected failure. Both paths still use real keyboard holds, preload, IPC, vault and store on success.

For a dirty revision, restore the retained `useDisconnectTransition.ts` into `src/renderer/` in addition to applying `source.patch`. This new hook is not included in Git's tracked diff until added.

The initial headings are also captured in `connection-logos-dark.png` and `connection-logos-light.png` through native Electron capture. The journey restores dark mode before continuing; heading/button center alignment remains required.

The GitHub heading uses the circular Primer mark as a theme-colored mask; the Notion mark uses the same solid circular treatment. Restore a retained `github-mark.svg` into `src/renderer/assets/` when reproducing an untracked logo revision.

## Persistent profile cache

Cold profiles use the real main-process downloader, image validation, Sharp thumbnail conversion, cache file and renderer IPC; only DNS/HTTPS responses are fixture transports. GitHub has an avatar; Notion displays destination icons rather than an OAuth app avatar. The existing geometry/reveal journeys wait for decoded data-URL images, not an empty image list.

`warmReload(service)` marks the old document, reloads it, waits for a new document, then reopens Settings with provider and image transports offline. Require the decoded cached WebP within 1200ms, zero extra provider/profile/image requests, and a native `*-cached-offline.png`. Review `github-warm-cache.json` and `notion-warm-cache.json`. The fixture's cold avatar response takes 1600ms; the warm check must not wait for it.

The Notion repeat cycle uses a different token and name and must never show the old profile. After both final disconnects, `profile-cache-after-disconnect.json` must be empty. Unit behavior tests cover cache reconstruction from disk (application restart seam), stale/offline retention, in-flight deduplication, corrupt cache data, missing images, account scope, and late response invalidation even when the same token is reused. These constructor tests prove persistent cache loading; the desktop journey reloads the renderer, not the whole Electron process.

For reproduction of an uncommitted revision, restore the retained `connection-profiles.ts` into `src/main/` and `useConnectionProfile.ts` into `src/renderer/`, alongside the source patch and retained harness. Runtime cache data stays outside journal state/backups and contains no credential values.
