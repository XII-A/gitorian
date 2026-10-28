# Effect patterns

Use the installed Effect v3 API. Upstream main and its LLMS.md describe v4 APIs; verify examples against the pinned reference before applying them here.

## Source reference

Run `pnpm effect:reference` to fetch the upstream release into `.reference/effect`. The command checks the application dependency and upstream commit before accepting the checkout. When Effect changes, update the reference version and commit in `tools/effect-reference.mjs` together with both workspace dependencies.

Treat `.reference/effect` as read-only reference material. Import from the installed `effect` package in application code. Search the reference explicitly with `rg --no-ignore <pattern> .reference/effect/packages/effect`; consult `src/` for signatures, `test/` for behavior, and `dtslint/` for type examples. It is excluded from normal editor search and project tooling. A fresh clone can run checks without fetching this optional reference.

## Choose an existing owner

Read [backend conventions](../src/main/README.md) for the domain map and lifecycle contracts. Follow these examples:

- `src/main/journal-layer.ts` composes domain services; `src/main/index.ts` owns the desktop runtime.
- `src/main/application-work.ts` owns admission, background work and shutdown. Submit accepted work through this service.
- `src/main/shared-requests.ts` owns shared executions and reader cancellation.
- `src/main/http.ts` adapts native asynchronous transport to Effect and retains typed transport/provider failures.
- `tests/effect-fixtures.ts` constructs the same module Layers with disposable adapters and closes their runtimes.

## Compose operations

An Effect value describes work; constructing it does not execute it. In `Effect.gen`, use `yield*` to compose operations and `return yield* Effect.fail(error)` when control flow must terminate. Use named `Effect.fn` boundaries for public operations, following existing services. Keep execution at the owning runtime or fixture boundary.

Use `Effect.tryPromise` for native Promise APIs with an explicit error mapping. Use `Effect.try` for synchronous work that can throw; reserve `Effect.sync` for synchronous work whose thrown errors are defects. A Promise returned from `Effect.sync` is a success value, not an awaited operation.

Preserve named error unions, original causes, and interruption. Normalize native failures at the owning adapter or module interface; avoid narrowing error or requirement channels with assertions. Acquire resources through scoped Layers and finalizers, following existing lifetime ownership. Remote writes retain the publishing module's durable recovery protocol.

Keep synchronous parsing, formatting and SQLite internals ordinary TypeScript. Renderer event handlers and native adapters may use Promises where they meet their host APIs. Existing shared Zod models remain authoritative for validation.

## Verify tooling changes

`pnpm typecheck` uses a pinned native TypeScript compiler through `@effect/tsgo`, with Effect diagnostics enforced in the same pass. TypeScript 5 remains available for JS compiler-API consumers and workspace editor support. Oxlint owns generic lint rules; Effect semantic rules belong to typecheck.

In VS Code, select the workspace TypeScript version to activate `@effect/language-service` diagnostics, refactors and Layer information. Workspace settings point to the installed TypeScript SDK; a separate extension is unnecessary for this plugin. The CLI uses the native compiler directly without patching dependencies or the pnpm store; the editor uses the supported TypeScript 5 plugin. Run `pnpm exec effect-language-service quickfixes --project tsconfig.json` to inspect proposed changes before applying them.

The nested-Effect return suggestion is disabled because credential registration intentionally returns a completion Effect to execute after releasing its lock. Broad native Error/unknown-catch suggestions are disabled because native adapters normalize failures at their owning interface. Keep explicit correctness rules enabled rather than suppressing diagnostics for entire files.

Run the required checks from [testing](testing.md), then build and exercise the real Electron journeys when upgrading compiler or lint dependencies. For diagnostic changes, first verify that a deliberately discarded Effect fails the configured command and that removing it restores success. Use disposable files and retain the command output under `.ai-docs/verification/`.
