# Run after the repository is public. Without -Apply this only previews the payloads.
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$repository = 'XII-A/gitorian'
$repoJson = gh api "repos/$repository"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect repository.' }
$repo = $repoJson | ConvertFrom-Json
if ($repo.private) { throw 'GitHub Free protections require a public repository. Visibility was not changed.' }
$files = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'rulesets') -Filter '*.json'
if (-not $Apply) {
    foreach ($file in $files) { Get-Content -LiteralPath $file.FullName }
    Write-Output 'Preview only. Run again with -Apply to activate rules and external workflow approval.'
    exit 0
}
$existingJson = gh api --paginate --slurp "repos/$repository/rulesets?per_page=100"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing rulesets.' }
$existing = @($existingJson | ConvertFrom-Json | ForEach-Object { $_ } | ForEach-Object { $_ })
foreach ($file in $files) {
    $rule = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $match = @($existing | Where-Object { $_.name -eq $rule.name })
    if ($match.Count -gt 1) { throw "Duplicate rulesets named $($rule.name); inspect manually." }
    if ($match.Count -eq 1) {
        gh api --method PUT "repos/$repository/rulesets/$($match[0].id)" --input $file.FullName
    } else {
        gh api --method POST "repos/$repository/rulesets" --input $file.FullName
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not apply $($rule.name)." }
}
gh api --method PUT "repos/$repository/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors
if ($LASTEXITCODE -ne 0) { throw 'Could not enable approval for external contributor workflows.' }
gh api "repos/$repository/rulesets"
if ($LASTEXITCODE -ne 0) { throw 'Could not verify rulesets.' }
