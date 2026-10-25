# Release description template

Use this guide when creating or updating a release description. Write the finished description in `.github/release-notes.md`; the release workflow copies that file into the draft release.

## Writing rules

- Group changes under **New**, **Updates**, and **Fixes**, in that order. Omit empty sections.
- Keep at most six change bullets in total. Combine related changes and choose the changes that matter most to someone using the app.
- Write one short sentence per bullet using familiar words. Describe what someone can do or what works better.
- Keep implementation details, PR numbers, test results, and maintainer tasks in development documentation.
- End with supported machines and one installation instruction. Match the operating systems, architectures, and exact installer filenames to the release assets. `.exe` is for Windows; use the appropriate installer format if other operating systems are added.
- Replace every placeholder and check each claim against the changes included in this version. Use the release title for the version number.

## Copy and fill in

```markdown
## New

- [New feature and what you can do with it.]

## Updates

- [What is easier, clearer, or faster.]

## Fixes

- [What now works correctly.]

## Supported machines and installation

[Operating system versions and machine architecture.]

Download and run `[installer filename]` from **Assets** below to install Gitorian.

See the [installation details](https://github.com/XII-A/gitorian#downloads) for unsigned installer warnings and checksums.
```

## Maintainer verification

Before publishing, download and test the exact draft assets on a disposable account or machine. Record the release tag, tested Windows version, actions, results, and anything untested under `.ai-docs/verification/`.

- Validate the installer against the attached `SHA256SUMS`.
- Install, launch, and confirm the displayed app version.
- Import a disposable Git repository and inspect activity and a diff.
- Write a draft, restart the app, and confirm it persists.
- Export and import a backup using disposable journal data.
- Test GitHub and Notion if claiming those integrations were verified. External publishing requires explicit authorization.
- Verify uninstall behavior.

Publish the same verified draft manually. Keep verification evidence separate from the release description. Do not rebuild or replace tested assets. Draft downloads require repository write access; do not grant write access merely to share an installer.

The manual **Verify exact draft assets** workflow performs the installer, packaged-app, local Git/diff, writing restart, backup round-trip, and uninstall checks on a fresh hosted Windows runner. Run it from `main` with the unpublished tag after draft upload. It downloads that draft's attached assets and checks SHA256SUMS and the update-feed SHA512 before installing. Review the retained `exact-draft-verification` artifact, including `run.json`, Windows version, screenshots, persisted writing and unchanged installer hash, before publishing. The workflow never publishes and does not verify live provider integrations. Its driver refuses personal desktops and runners with an existing Gitorian installation or profile.
