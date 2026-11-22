---
name: verify-gitorian
description: Verify changed Gitorian behavior in Electron using a disposable profile and optional diagnostics.
---

# Verify Gitorian

Read the [feature map](features/README.md) and select the affected desktop entry points. Define what the user should see and which local side effects should result.

1. Run `pnpm build` and `pnpm verify doctor` from the repository root. Require both to exit zero.
2. Use a disposable profile and fixture data. For an interactive run, point `GITORIAN_DEV_PROFILE` at a new temporary directory and run `pnpm dev`. Use journal-only fixtures for writing and real disposable Git repositories for repository behavior.
3. Drive the affected controls in Electron. Record the actual input, resulting UI and relevant side effects, such as writing still present after reopening. Use the optional feature diagnostics when they match the behavior under review.
4. Exit the owned app, remove its temporary profile and retain evidence under `.ai-docs/verification/`. Record commands, fixture setup, observed outcomes and cleanup. Use simulated provider responses or disconnected profiles. External publishing requires explicit authorization.

Follow [testing](../../../docs/testing.md#final-revision-verification) for the separate pre-PR checks and compilation.
