# Gitorian verification map

- [Crash recovery](crash-recovery.md) covers notification, diagnostic sharing, refresh resumption and restart. Windows process ownership is tested by `pnpm smoke:recovery-termination`.

- [Onboarding](onboarding.md): first-time checklist, direct Settings actions, writing access, dismissal and header popover, real completion truth, reload persistence, existing-profile migration, themes, narrow widths and zoom. Run `pnpm verify onboarding`; use `GITORIAN_VERIFY_ONBOARDING_INLINE=1` for completion from the inline card.
- [Checklist motion](onboarding.md#disclosure-text-stability): `pnpm verify onboarding-disclosure` isolates step/body expansion and native text raster stability with no repositories or account setup.

Read the matching feature recipe before changing or verifying behavior. Each recipe lists user entry points; report coverage per entry point, including failures or missing preconditions.

Use `pnpm build` and `pnpm verify doctor` before desktop review. Follow [the skill](../SKILL.md) for isolation, evidence and cleanup.

- [Connections](connections.md) covers provider account controls, device authorization and repository matching. `pnpm verify notion` runs the optional Notion diagnostic.
- [Window chrome](window-chrome.md): thin Windows frame, hover/focus reveal, native drag bounds, window actions, reduced motion, and workspace navigation.
- [Repository import](repository-import.md) covers discovery, cancellation, selection, resuming tracking and persisted side effects.
- [Weekly activity](weekly-activity.md) covers refresh, unavailable sources, retry and activity filters.
- [Writing](writing.md) covers entry creation, editing, autosave, recovery, citations, clipboard and history.
- [App updates](app-updates.md): `pnpm verify app-updates` covers real background downloads, writing responsiveness, toast/header actions and checkpoint recovery. `node tools/verify-update-install.mjs` proves a real unsigned NSIS installation/restart in a disposable product/profile.
- [Inspecting changes](inspecting-changes.md): hub details, workspace inspector, file filtering, pop-out, and docking.

Legacy `pnpm smoke` and `pnpm smoke:week-history` are diagnostic harnesses; they do not yet provide the import runner's full artifact/cleanup contract. Before using those commands from the Codex host, temporarily remove `ELECTRON_RUN_AS_NODE` from the child environment (restore it afterward), as the import runner does automatically. Keep their stdout/stderr and add screenshot/action capture for the feature being changed. Fixtures and programmatic corruption/recovery setup must be distinguished from user actions. A sample workspace can prove UI behavior but cannot prove real publishing or durable real-profile writes.

- [Local database](database.md): schema integrity, migrations, draft conflicts, worker restart, acquisition checkpoints, restore fencing and bounded reads; linked desktop journeys own writing, import, publishing and images.

- Settings panels: open all five tabs and check Preferences, Template and Backup at narrow width. Save and reopen a changed refresh interval.
