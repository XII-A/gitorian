# Connection controls

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify connections`. The runner owns a temporary journal-only profile and retains screenshots, actions, HTTP traces, process exit, independent SQLite evidence, and cleanup results under `.ai-docs/verification/connections-*/`.

## GitHub entry points

- Settings > Connections: GitHub and Notion headings have Connect actions instead of disconnected text. GitHub has no client-ID field or app-creation link.
- GitHub Connect: the heading control shows its starting spinner, then expands to the code, icon-only Copy code action, Cancel, and primary Open GitHub action.
- Offline start > retry: a simulated failure stays in one row (message, Cancel, Retry), without a description; retry obtains a code.
- Browser failure > Open GitHub: browser recovery guidance leaves the code usable. The button shows loading during the real IPC command with simulated browser launching.
- Copy code: accessible icon-only control confirms in place; record the OS clipboard comparison separately. A simulated clipboard failure preserves the selectable code and shows error feedback in the same icon. Late polling responses remain owned by existing behavior tests.
- Cancel / Escape: return to Connect and restore focus. Expiry and declined authorization show distinct recovery copy and offer a fresh attempt.
- Successful authorization: the same surface contracts to a compact Connecting face, then green Connected, then the hold-to-disconnect control. The identity prepares while hidden and reveals only after the final button width settles, without horizontal or secondary layout movement. Delayed avatars fade into fixed boxes. Reload preserves the account; encrypted fixture-token storage is required when the OS backend is available.
- Disconnect: Cancel leaves the connection intact. A held confirmation first exercises a simulated disconnect command failure and Retry; the successful retry removes the token, shows Disconnected for about 900ms, then returns to Connect. Account metadata stays in SQLite, consistent with the store contract. Without closing Settings, reconnect, observe Connected, require an active Disconnect button, then disconnect again and require an active Connect button. This repeated cycle owns the regression for stale disconnect feedback after reconnect.

## Notion entry points

- Without a token: the heading Connect action is disabled. Typing a token enables it; no extra Connect action exists below the field.
- Connect: the same notionConnect command receives the trimmed token. The heading control shows pending, then a safe failure with Retry. The token remains available after failure and raw HTTP diagnostics stay out of the footer.
- Retry: simulated success clears the token, shows a check, prepares its optional profile lookup, then reveals the integration identity after Disconnect settles. The lookup must not briefly show a fallback name before replacing it. Reload preserves the connection and its encrypted fixture token when supported.
- Disconnect: Cancel leaves the connection intact. A held confirmation exercises a simulated disconnect command failure and Retry, then shows Disconnected for about 900ms before the disabled Connect action. The token is removed on successful retry. Without closing Settings, enter the fixture token, reconnect, require Connected followed by an active Disconnect button, then disconnect again and require the disabled Connect action. Neither cycle may inherit the previous action's pending/success state.

## Evidence and scope

Require `run.json` with exit zero, `passed: true`, `cleanup.removed: true`, and `evidenceRetained: true`. Review `captures.json`, full PNGs, section-detail PNGs, `actions.jsonl`, `http-requests.json`, `connected-state.json`, and `persisted-settings.json`. The OAuth POSTs must use the shared public ID without a client secret. Independent post-exit SQLite must retain the fixture GitHub login and omit the obsolete client-ID property.

The runner targets desktop dark and narrow dark layouts (390px may round to 391px under Windows scaling). GitHub's transient loading/check states are captured before their timers complete. The Notion token is a fixture, never a real credential. Both vault files must be removed by the end of the journey.

GitHub/Notion HTTP, browser launching, one clipboard failure, delayed avatars, and one disconnect IPC failure per service are simulated; renderer, preload, IPC, vault, and local storage are real. Unexpected HTTP requests fail. No Git repositories, live authorization, messages, or publishing are involved. This does not verify real provider credentials, organization policy, or other OS credential backends. A live authorization needs a separately authorized destination.

For reproduction, apply `source.patch`, copy the retained `connections-smoke.mjs` into `tools/`, and follow the shared runner instructions. Keep earlier failed run evidence; require its cleanup result before proceeding.

## Connection handoff motion

The same owning journey records requestAnimationFrame measurements in `github-identity-motion.json` and `notion-identity-motion.json`. Require at least three visible and settled frames, no more than 0.5px horizontal/width change during the reveal, and no more than 0.5px vertical drift once opacity reaches 0.99. The intended normal entrance moves vertically by 4px; reduced motion must contain no translation. The harness simulates a 1600ms avatar response at Electron's HTTPS protocol boundary and waits for image completion before finishing the trace.

Run the normal desktop journey, then the distinct narrow/reduced-motion case with long provider names:

```powershell
$env:WEEKLY_J_VERIFY_MOTION = 'stress'
try { pnpm verify connections } finally { Remove-Item Env:WEEKLY_J_VERIFY_MOTION }
```

Require both runs to exit zero with cleanup confirmed. The stress fixture uses a long GitHub login and Notion integration name and retains its own independent SQLite expectation. Inspect native section screenshots as well as traces: actions must remain fully readable and within the section, with names truncated rather than actions clipped. Both success and failure/recovery paths still run. The renderer HTTPS avatar fixture is simulated; it is not evidence of live provider image availability.

When reproducing a dirty revision, also copy the retained `ConnectionIdentity.tsx` into `src/renderer/ConnectionIdentity.tsx` before building, because untracked new files do not appear in Git's tracked source patch.

## Disconnect result ownership

`useDisconnectTransition` retains the operation's controlled feedback independently of persisted connection truth. The owning journey samples the native renderer every animation frame for both first and repeated disconnects in `github-disconnect-{first,repeat}.json` and `notion-disconnect-{first,repeat}.json`. Require the active done face to say Disconnected for 700?1800ms (the intended hold is 900ms), then require idle Connect. An absent/one-frame result and an indefinitely retained result must both fail. While the done face is visible, a real state command must already report the service disconnected.

Before each first hold, Cancel must preserve the existing connection. The IPC fixture rejects the first disconnect command before it reaches the backend; verify the error stays in place, the connection is retained, and Retry reaches the readable result. This simulated failure does not prove recovery from arbitrary partial filesystem/store failures. The repeated cycle then disconnects without the injected failure. Both paths still use real keyboard holds, preload, IPC, vault and store on success.

For a dirty revision, restore the retained `useDisconnectTransition.ts` into `src/renderer/` in addition to applying `source.patch`. This new hook is not included in Git's tracked diff until added.
