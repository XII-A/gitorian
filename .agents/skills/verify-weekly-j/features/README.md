# weekly-j verification map

Read the matching feature recipe before changing or verifying behavior. Each recipe lists user entry points; report coverage per entry point, including failures or missing preconditions.

The artifact-backed baseline is `pnpm build`, `pnpm verify doctor`, then `pnpm verify repository-import`. It uses an empty temporary profile, real Git folders, no integration credentials, and unique persistent evidence. Follow [the skill](../SKILL.md) for isolation, proof standards, and cleanup.

- [Connections](connections.md): heading connect controls, GitHub code morph, Notion token validation, simulated success/failure, retry, persistence, and hold-to-disconnect.
- [Repository import](repository-import.md): fully automated real desktop journey, cancellation, search, selection, stopped tracking, single-folder entry, scan failure, and persisted side effects.
- [Weekly activity](weekly-activity.md): current and earlier weeks, empty refresh, unavailable sources, and retry.
- [Writing](writing.md): hub/workspace entry, template, autosave, reload recovery, and citation.
- [Inspecting changes](inspecting-changes.md): hub details, workspace inspector, file filtering, pop-out, and docking.

Legacy `pnpm smoke` and `pnpm smoke:week-history` are diagnostic harnesses; they do not yet provide the import runner's full artifact/cleanup contract. Before using those commands from the Codex host, temporarily remove `ELECTRON_RUN_AS_NODE` from the child environment (restore it afterward), as the import runner does automatically. Keep their stdout/stderr and add screenshot/action capture for the feature being changed. Fixtures and programmatic corruption/recovery setup must be distinguished from user actions. A sample workspace can prove UI behavior but cannot prove real publishing or durable real-profile writes.
