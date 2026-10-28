# Coding standards

## Before implementation

Read the conventions for each affected area:

- Renderer UI: [frontend](docs/frontend.md).
- Main-process services, application work, or native adapters: [backend](src/main/README.md).
- Effect code or tooling: [Effect patterns](docs/effect.md).

Define observable outcomes before implementation. For complex features, cover realistic failure, recovery, and persistence scenarios where relevant. When isolated tests are necessary, list failure modes and independent expected outcomes, then write tests before implementation.

## Feature verification

Automate consequential behavior: activity descriptions and PR metadata, writing/editing, failure/recovery, persistence, repository acquisition and external-provider contracts. Give each outcome one owning scenario at the module interface. Use real Electron journeys when native input, clipboard, preload or persistence is essential; use Vitest for domain/storage and inexpensive DOM behavior.

Review shader appearance, animation timing, hover geometry, input transitions and visual polish manually before a PR. These are not automated release gates. Retain automated keyboard selection, cancellation, editing and focus outcomes when they protect user actions. Test count is not a target; each scenario must name a distinct failure it catches.

Use [verify-gitorian](.agents/skills/verify-gitorian/SKILL.md) for feature changes and update affected feature recipes and entry points. Prefer real Electron UI journeys through preload and the local store; use Vitest for domain/storage behavior and DOM interactions that need no desktop.

Use disposable profiles and fixture repositories, excluding personal journal data and integration credentials. Use journal-only fixtures for writing/publishing; create Git repositories only to test repository behavior. External publishing requires explicit authorization.

Retain reproducible E2E evidence under `.ai-docs/verification/` after cleanup: commands, preconditions/fixtures, actions, resulting UI, side effects, and exit status.

## Test changes

Read [testing](docs/testing.md) when adding or migrating tests, choosing a runner, or debugging a failed journey.

- Ownership: choose the smallest existing scenario that proves the behavior. Add regression coverage only for a real gap, extending the existing journey for the same user path. Give overlapping behavior one owning scenario and parameterize only distinct failure modes.
- Assertions: use independent behavioral outcomes rather than implementation, fixture details, DOM structure, or object identity. Measure performance against meaningful bounds under realistic load.
- Pruning: preserve useful existing behavior coverage when removing tests.

## Handoff

During iteration, run affected journeys and focused existing tests. Before handoff, run `pnpm verify:release` on the final source, following the [final-revision verification requirements](docs/testing.md#final-revision-verification). Repeat verification after source edits or failures.
