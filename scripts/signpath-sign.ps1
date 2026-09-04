<#
.SYNOPSIS
  Submits a zip of PE files to SignPath through its REST API and unpacks the signed result.

.DESCRIPTION
  Uses the official SignPath PowerShell module (Submit-SigningRequest). Reads credentials from the
  environment so nothing is echoed: SIGNPATH_API_TOKEN, SIGNPATH_ORGANIZATION_ID, SIGNPATH_PROJECT_SLUG,
  SIGNING_POLICY. The artifact configuration must describe a zip-file containing pe-file entries
  (see docs/SIGNING.md).

.EXAMPLE
  ./scripts/signpath-sign.ps1 -InputZip sign/pass1.zip -OutputDir sign/pass1-signed -ArtifactConfiguration executables
#>
param(
  [Parameter(Mandatory)] [string] $InputZip,
  [Parameter(Mandatory)] [string] $OutputDir,
  [Parameter(Mandatory)] [string] $ArtifactConfiguration
)

$ErrorActionPreference = 'Stop'

foreach ($name in 'SIGNPATH_API_TOKEN', 'SIGNPATH_ORGANIZATION_ID', 'SIGNPATH_PROJECT_SLUG', 'SIGNING_POLICY') {
  if ([string]::IsNullOrWhiteSpace((Get-Item "env:$name" -ErrorAction SilentlyContinue).Value)) {
    throw "signpath-sign: environment variable $name is not set"
  }
}

if (-not (Get-Module -ListAvailable -Name SignPath)) {
  Write-Host 'signpath-sign: installing SignPath PowerShell module'
  Install-Module -Name SignPath -Scope CurrentUser -Force -AllowClobber
}
Import-Module SignPath

$signedZip = [System.IO.Path]::ChangeExtension((Resolve-Path $InputZip).Path, '.signed.zip')
Write-Host "signpath-sign: submitting $InputZip (policy $env:SIGNING_POLICY, configuration $ArtifactConfiguration)"

$request = Submit-SigningRequest `
  -OrganizationId $env:SIGNPATH_ORGANIZATION_ID `
  -ApiToken $env:SIGNPATH_API_TOKEN `
  -ProjectSlug $env:SIGNPATH_PROJECT_SLUG `
  -SigningPolicySlug $env:SIGNING_POLICY `
  -ArtifactConfigurationSlug $ArtifactConfiguration `
  -InputArtifactPath (Resolve-Path $InputZip).Path `
  -Description "GitHub Actions run $env:GITHUB_RUN_ID ($env:GITHUB_REF_NAME)" `
  -WaitForCompletion `
  -WaitForCompletionTimeoutInSeconds 900 `
  -OutputArtifactPath $signedZip `
  -Force

Write-Host "signpath-sign: signing request $($request.Id) finished with status $($request.Status)"
if (-not (Test-Path $signedZip)) { throw 'signpath-sign: signed artifact was not downloaded' }

New-Item -ItemType Directory -Force $OutputDir | Out-Null
Expand-Archive -Path $signedZip -DestinationPath $OutputDir -Force
Get-ChildItem $OutputDir -Filter *.exe | ForEach-Object {
  $sig = Get-AuthenticodeSignature $_.FullName
  Write-Host ("signpath-sign: {0} -> {1} ({2})" -f $_.Name, $sig.Status, $sig.SignerCertificate.Subject)
  if ($sig.Status -eq 'NotSigned') { throw "signpath-sign: $($_.Name) came back unsigned" }
}
