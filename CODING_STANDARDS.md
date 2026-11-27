# Coding standards

## Before implementation

Read the conventions for each affected area:

- Renderer UI: [frontend](docs/frontend.md).
- Main-process services, application work, or native adapters: [backend](src/main/README.md).
- Effect code or tooling: [Effect patterns](docs/effect.md).

Define observable outcomes before implementation. For complex features, cover realistic failure, recovery, and persistence scenarios where relevant. When isolated tests are necessary, list failure modes and independent expected outcomes, then write tests before implementation.

## Feature verification

Use Vitest for domain and storage behavior, including persistence, repository acquisition, recovery and external-provider contracts. Give each automated outcome one owning scenario at the module interface.

Review changed desktop behavior in Electron when native input, clipboard, preload or rendering matters. Include relevant keyboard selection, cancellation, editing and focus behavior in that review.

Use [verify-gitorian](.agents/skills/verify-gitorian/SKILL.md) for feature changes and update affected feature recipes and entry points.

Use disposable profiles and fixture repositories, excluding personal journal data and integration credentials. Use journal-only fixtures for writing/publishing; create Git repositories only to test repository behavior. External publishing requires explicit authorization.

Retain reproducible desktop review evidence under `.ai-docs/verification/` after cleanup.

## Test changes

Read [testing](docs/testing.md) when adding or migrating tests, choosing a runner, or debugging a failed journey.

- Ownership: choose the smallest existing scenario that proves the behavior. Add regression coverage only for a real gap, extending the existing journey for the same user path. Give overlapping behavior one owning scenario and parameterize only distinct failure modes.
- Assertions: use independent behavioral outcomes rather than implementation, fixture details, DOM structure, or object identity. Measure performance against meaningful bounds under realistic load.
- Pruning: preserve useful existing behavior coverage when removing tests.

## Verification scope

During implementation and ordinary handoffs, verify the feature or change with affected journeys and focused existing tests. Require the selected checks to pass and report their results.

Before creating a PR, run `pnpm verify:release` on the final source and require checks and compilation to pass. Follow the [final-revision verification requirements](docs/testing.md#final-revision-verification). Repeat verification after source edits or a failed run.
