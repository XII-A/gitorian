# Working in Gitorian

Read [frontend conventions](docs/frontend.md) before changing renderer UI.

## Testing

- Prefer E2E verification through the real Electron UI, preload bridge, and local store. For feature changes, read and use [verify-gitorian](.agents/skills/verify-gitorian/SKILL.md), then update the affected feature recipes and entry points.
- For complex features, choose realistic scenarios of medium or high complexity, including failure, recovery, and persistence where relevant. Define observable outcomes before implementation.
- Retain reproducible E2E evidence: commands, fixture/precondition details, actions, resulting UI, side effects, and exit status. Keep artifacts under `.ai-docs/verification/` after cleanup.
- Never write unit tests after writing the code. When isolated testing is necessary, first list the system's failure modes and define independent expected outcomes, then write the tests before implementation.
- Keep tests that protect behavior. Avoid tautological assertions, copies of the implementation, and checks that fail merely because code, fixture details, DOM structure, or object identity changed. Performance checks should measure a meaningful bound or responsiveness under realistic load.
- For bug fixes, add a regression test only when existing behavior tests leave a real gap. Extend an existing journey when it covers the same user path.
- Give overlapping behavior one owning scenario. Add parameterized cases only for distinct failure modes; repeated aliases and equivalent inputs do not earn separate fixtures. Use a journal-only fixture for writing/publishing scenarios and create Git repositories only when repository behavior is under test.
- During iteration, run the affected journeys and focused existing tests. Before handoff, run the repository's required checks once; repeat only after relevant edits or failures. Preserve useful existing behavior coverage when pruning tests.

Use disposable profiles and fixture repositories for verification. Keep personal journal data and integration credentials out of fixtures and artifacts. External publishing requires explicit authorization.
