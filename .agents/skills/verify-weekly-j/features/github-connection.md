# GitHub connection

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify github-signin` from the repository root. The runner owns a temporary journal-only profile, removes it after Electron exits, and retains evidence under `.ai-docs/verification/github-signin-*/`.

## Entry points and outcomes

- Settings > Connections > Sign in with GitHub: one action, no OAuth client-ID field or app-creation link. The main process selects weekly-j's shared public registration.
- Failed start > Try sign-in again: simulated offline failure stays inline and retry obtains a code.
- Code > Copy code / Open GitHub / Cancel sign-in: the renderer confirms copying (the OS clipboard read is recorded separately and may be unavailable on the automation host); browser-launch failure leaves instructions and a manually usable code; cancel restores focus to sign-in.
- Expired code > Try sign-in again: expiration clears the old code and retry obtains a new one.
- Authorization > connected identity: simulated GitHub HTTP supplies a fixture account through real IPC, vault, and store. The UI confirms in place and shows the account. Renderer reload preserves the connection. The local encrypted token file must exist when protected storage is available.
- Connected account > Disconnect > hold Disconnect: real keyboard input completes the hold. The account becomes disconnected and its local token file is removed.

Inspect `run.json` for zero exit, `passed: true`, `cleanup.removed: true`, and `evidenceRetained: true`. Inspect `actions.jsonl`, numbered screenshots, `http-requests.json`, `connected-state.json`, and `persisted-settings.json`. Recorded OAuth POSTs must use the shared public ID without a client secret. The independent post-exit SQLite read must retain the fixture login and omit the obsolete client-ID property. The login metadata remains after disconnect, consistent with the existing store contract; connection status comes from the token vault.

The narrow dark code screenshot targets a 390px viewport (Windows display scaling can round this to 391px); other screenshots use 1280px. Unit behavior coverage additionally owns late renderer polling responses, clipboard failure, polling backoff, dirty-form behavior, and old-settings parsing. Do not duplicate those fixtures here.

## Simulation boundary

Only `globalThis.fetch` and `shell.openExternal` are replaced before loading the compiled main process. Unexpected HTTP requests fail. No Git repositories, live GitHub approval, external messages, or publishing are involved. This journey does not verify the registration's real device-flow setting, organization authorization policy, live credentials, or OS credential availability on other platforms. A live sign-in needs separately authorized browser approval.

For reproduction from a dirty revision, apply `source.patch`, copy the retained `github-signin-smoke.mjs` into `tools/`, and follow the common runner reproduction instructions. No fixture token is a real credential.
