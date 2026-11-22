# Testing

Follow [coding standards](../CODING_STANDARDS.md) for coverage and verification scope.

```sh
pnpm test                         # Vitest domain and integration tests
pnpm test tests/state-updates.test.ts
pnpm check                        # Typecheck, lint, format check and Vitest
pnpm verify:release               # Pre-PR checks and production compilation
```

Windows CI runs `pnpm check` for pull requests targeting `main`, `release`, or `release/**`. For a desktop behavior change, use the [verification skill](../.agents/skills/verify-gitorian/SKILL.md) to select the affected manual checks or optional diagnostics.

## Final-revision verification

`pnpm verify:release` runs checks, then compiles Electron and the OAuth service. It sets `CI=1` for child commands, stops at the first failure and records source identity, commands, stage timings and exit status in `.ai-docs/verification/release/<run>/run.json`. Source identity covers HEAD and the contents of tracked and nonignored untracked files. Run it on the final source before opening a PR and repeat the run after any further source edits.

`pnpm build`, `pnpm build:compile` and `pnpm verify:release` share a checkout lock. Concurrent commands fail with the current owner PID and command. After an interruption, verify that the owner and its child processes have exited before removing the exact `.ai-docs/verification/checkout.lock` directory.

## Test coverage

Keep distinct behavior at the module interface, including Git, storage, recovery, external HTTP contracts, and persisted side effects. Keep fixtures isolated and exercise real adapters where practical.

Oxlint enforces the Landmines testing rules. Run the large Git import benchmark with `pnpm smoke:import-stress` and native Windows recovery checks with `pnpm smoke:recovery-termination`. Use strict HTTP interception at the network boundary and await application or fixture signals to coordinate concurrent work.
