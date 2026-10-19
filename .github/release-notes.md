## Downloads and support

This release candidate targets **Windows 10/11 x64**. Download the `windows-x64-setup.exe` installer and `SHA256SUMS` attached to this release. Git must be installed and available on `PATH` to import local repositories.

Windows ARM64, Linux, and macOS installers are not included in this release. macOS signing and notarization are not configured.

## Installation and checksums

This early build is **unsigned**. Windows or your browser may warn about an unknown publisher or uncommon download. Only install if you trust this repository and have verified the checksum; do not disable system security globally.

In PowerShell, from the folder containing both downloaded files:

```powershell
$line = (Get-Content ./SHA256SUMS -Raw).Trim()
$expected, $file = $line -split '  ', 2
$actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'Checksum mismatch. Do not install.' }
```

Run the installer, launch weekly-j, and select repositories in Settings. Installation does not connect GitHub or Notion automatically. See the [README](https://github.com/XII-A/weekly-j#readme) for integration setup, permissions, backups, and data storage.

## Known issues

- Unsigned installers may trigger SmartScreen/browser warnings.
- Early software: back up your journal before updating. The local SQLite database is not encrypted.
- GitHub sign-in requires your own device-flow-enabled OAuth client ID and requests the broad `repo` scope.
- Notion supports a subset of block types. Check the remote page before retrying an uncertain publish result.
- Large diffs and API activity are subject to limits. Updates are installed manually.

## Maintainer verification — complete before publishing

This draft is not a statement that installation has been verified. Download and test these exact release assets on a Windows x64 test account or machine. Draft assets are visible only to users with repository write access; do not grant write access merely to share a draft.

- [ ] Download the attached installer and validate it against the attached `SHA256SUMS`.
- [ ] Install, launch, and confirm the displayed app version.
- [ ] Import a disposable Git repository and inspect activity and a diff.
- [ ] Write a draft, restart the app, and confirm it persists.
- [ ] Export/import a backup using disposable journal data.
- [ ] Test GitHub and Notion if claiming those integrations were verified; record anything untested.
- [ ] Verify uninstall behavior and document the tested Windows version.
- [ ] Replace this checklist with test results before manually publishing. Do not rebuild or replace tested assets.
