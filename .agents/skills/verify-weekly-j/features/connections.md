# Connection controls

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify connections`. The runner owns a temporary journal-only profile and retains screenshots, actions, HTTP traces, process exit, independent SQLite evidence, and cleanup results under `.ai-docs/verification/connections-*/`.

## GitHub entry points

- Settings > Connections: GitHub and Notion headings have Connect actions instead of disconnected text. GitHub has no client-ID field or app-creation link.
- GitHub Connect: the heading control shows its starting spinner, then expands to the code, icon-only Copy code action, Cancel sign-in, and primary Open GitHub action.
- Offline start > retry: a simulated failure stays in one row (message, Cancel, Retry), without a description; retry obtains a code.
- Browser failure > Open GitHub: browser recovery guidance leaves the code usable. The button shows loading during the real IPC command with simulated browser launching.
- Copy code: accessible icon-only control confirms in place; record the OS clipboard comparison separately. A simulated clipboard failure preserves the selectable code and shows error feedback in the same icon. Late polling responses remain owned by existing behavior tests.
- Cancel sign-in / Escape: return to Connect and restore focus. Expiry and declined authorization show distinct recovery copy and offer a fresh attempt.
- Successful authorization: the same surface contracts to a compact Connecting face, then green Connected, then the hold-to-disconnect control. The fixture identity appears beside it. Reload preserves the account; encrypted fixture-token storage is required when the OS backend is available.
- Disconnect: keyboard input completes the hold and removes the local token. Account metadata stays in SQLite, consistent with the store contract.

## Notion entry points

- Without a token: the heading Connect action is disabled. Typing a token enables it; no extra Connect action exists below the field.
- Connect: the same notionConnect command receives the trimmed token. The heading control shows pending, then a safe failure with Retry. The token remains available after failure and raw HTTP diagnostics stay out of the footer.
- Retry: simulated success clears the token, shows a check, then reveals the integration identity and Disconnect. Reload preserves the connection and its encrypted fixture token when supported.
- Disconnect: keyboard hold returns the section to the disabled Connect action and removes the local token.

## Evidence and scope

Require `run.json` with exit zero, `passed: true`, `cleanup.removed: true`, and `evidenceRetained: true`. Review `captures.json`, full PNGs, section-detail PNGs, `actions.jsonl`, `http-requests.json`, `connected-state.json`, and `persisted-settings.json`. The OAuth POSTs must use the shared public ID without a client secret. Independent post-exit SQLite must retain the fixture GitHub login and omit the obsolete client-ID property.

The runner targets desktop dark and narrow dark layouts (390px may round to 391px under Windows scaling). GitHub's transient loading/check states are captured before their timers complete. The Notion token is a fixture, never a real credential. Both vault files must be removed by the end of the journey.

Only GitHub/Notion HTTP, browser launching, and one clipboard failure are simulated; renderer, preload, IPC, vault, and local storage are real. Unexpected HTTP requests fail. No Git repositories, live authorization, messages, or publishing are involved. This does not verify real provider credentials, organization policy, or other OS credential backends. A live authorization needs a separately authorized destination.

For reproduction, apply `source.patch`, copy the retained `connections-smoke.mjs` into `tools/`, and follow the shared runner instructions. Keep earlier failed run evidence; require its cleanup result before proceeding.
