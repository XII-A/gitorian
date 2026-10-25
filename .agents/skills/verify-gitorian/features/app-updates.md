# App updates

Windows NSIS installs check stable GitHub Releases shortly after startup and every six hours. Updates download without blocking writing. Installation requires an explicit Update now action; normal exit never installs. Development and unsupported platforms hide the control.

## Entry points and outcomes

- **Header:** The icon-only update control appears in the hub and writing workspace only after an update is downloaded and ready to install. Its primary foreground dot, accessible name and tooltip announce Update ready. Idle, checking, current, downloading, failed download and installing states have no header control. The desktop journey verifies these hidden states, then opens the ready popover from both headers and captures `06-hub-update-popover.png` alongside the workspace screenshot.
- **Ready toast:** appears once per version on the device, without focus transfer. Update now uses the same checkpoint and installation path as the header. Dismissal leaves Update ready in the header; navigation/reload does not repeat the prompt.
- **Ready popover:** Update ready opens Ready to update and Update now. Escape returns focus. Narrow/reduced-motion presentation must fit.
- **Checkpoint:** the active draft uses its existing recovery cache and durable save, including in-flight writes and the final keystroke. Pending images or failed saves block installation. Settings must be saved/closed first. Editing resumes after preparation/launch failure. Inject an asynchronous installer-spawn rejection, require no quit attempt, then retry successfully through the same updater instance.
- **Integrity and lifecycle:** a failed or corrupt download never becomes ready. Repeated checks do not create simultaneous downloads. Prereleases and downgrades are disabled. There is no installation on normal exit.

## Desktop journey

Run `pnpm build`, `pnpm verify doctor`, then `pnpm verify app-updates` on Windows.

`tools/app-updates-smoke.mjs` drives the real compiled app, preload, IPC, NSIS updater, loopback HTTP download/hash validation, native editor input, background store writer and SQLite. It sets an isolated update configuration through electron-updater's documented development fixture seam. The harness advances the real scheduled startup-check callback at the timer seam instead of waiting for each automatic interval. The production preload has only state, subscription and install operations. Provider responses and final installer launch are simulated. Save/launch faults are injected explicitly at existing IPC/installer seams. No live releases, personal credentials or repositories are used.

The fixture contains a 200-paragraph journal and a throttled 12 MB update. Derive its week with the application's shared `weekOf(new Date(), settings)` helper, honoring the profile timezone and week start; never hardcode a calendar week. Record the fixture week/draft ID, require its seeded text in the opened editor before typing, and check autosave against that same draft ID. Sustained typing must cross an autosave checkpoint during download, preserve editor identity/focus/text, and keep input-to-paint p95 below 100 ms, worst input below 350 ms and maximum frame gap below 500 ms. Retain `writing-performance.json`; these measurements characterize this fixture/machine, not all supported machines.

Evidence includes screenshots showing no header button for checking failure, current version, rejected download and background download, followed by the ready toast, ready popovers, save-blocked restart and narrow reduced-motion UI; `installer-handoff.json` records simulated handoff with an independent SQLite read before launch. The runner independently reads `persisted-drafts.json` after normal shutdown and checks cleanup. Read `run.json` for the exact source/build identity, outcomes and cleanup result.

## Actual unsigned installation and restart

After building, run `node tools/verify-update-install.mjs` on Windows. This is a separate, slower journey using two real unsigned NSIS packages labeled 0.1.4 and 0.1.5. It checks generated latest.yml hashes and unsigned configuration, installs the old fixture, types real writing, downloads through the real updater, invokes Update now and observes a real installer/relaunch of the newer executable. The new process must render the last typed writing, and an independent post-exit SQLite read must agree.

The fixture has a distinct product/app ID, no shortcuts, and a generated entry that hardcodes disposable profile/cache paths and a loopback inspector. This entry exists only in disposable packages and is removed from out/ during cleanup; production has no fixture flags or inspector entry. The actual installation, provider responses, UI actions and updater handoff are recorded under `.ai-docs/verification/update-install-*`. The localhost feed replaces GitHub hosting; no release is published. The fixture uninstaller removes its registration before the owned temporary directory is removed. Require `run.json.passed` and `cleanup.removed` to be true; never replace the personal installation to test an update.

The installed journey also quits with an update ready and reopens the old version, proving ordinary exit does not install. The header action returns without repeating the ready toast across the full process restart. It then invokes Update now and observes the new version and restored writing.

## Release assets

The existing draft-only workflow must include the NSIS installer, its blockmap, latest.yml and SHA256SUMS covering all assets. Production uses the GitHub provider configured under win.publish. Unsigned Windows updates intentionally omit publisher-name verification; download hashes remain verified. Signing is deferred. A real GitHub release is not part of local verification and needs release authorization.
