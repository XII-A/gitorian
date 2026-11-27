# Local database

Read [database design](../../../../docs/database.md) before changing schema or commands. Use Node from `.nvmrc` and disposable profiles. The app owns `journal.sqlite`; fixtures seed through `tools/seed-journal.mjs` or named commands, never through retired state tables.

Run the affected storage scenarios with `pnpm test tests/journal-database.test.ts tests/database-worker.test.ts tests/database-integrity.test.ts`. Require transaction rollback to leave the prior draft/checkpoint intact, stale writers to fail, worker death before commit to leave no changes, lost acknowledgment retries to resolve the persisted version, invalid restore to retain the current generation, and unknown newer migrations to reject opening without mutation. Inspect foreign-key checks through independent native SQL.

Review the affected persistence path in a disposable desktop profile. Optional diagnostics include `pnpm smoke:acquisition`, `pnpm verify publishing` and `pnpm smoke:images`. Keep evidence under `.ai-docs/verification/`.

`pnpm smoke:writing:release` measures real Electron input/autosave under a large synthetic activity archive using the production renderer. `pnpm smoke:writing` runs the same replay in Vite development mode; React development performance-track logging can itself create long tasks while recording large component props. Keep those traces separate from release results. Keep storage/query timings distinct from typing latency. Report measured sample sizes and milliseconds with calculated relative changes; do not infer memory/battery gains from SQL timing. A diagnostic profile is weaker than a complete desktop journey and does not replace persistence evidence.

For history changes, exercise pagination, text search, opening an older entry and reload with an empty current week.
