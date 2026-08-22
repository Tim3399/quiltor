# Builds the Windows Quiltor desktop app: the onedir Quiltor.exe bundle, then a
# proper Setup.exe installer around it (Start Menu shortcut, optional Desktop
# shortcut, uninstaller in "Apps & Features") if Inno Setup is installed.
#
#   powershell -ExecutionPolicy Bypass -File distribution/desktop/windows/direct/build.ps1
#
# Requires: a CPython 3.11.9 venv populated from the hash-locked bootstrap and
# Windows x86_64 requirements files (see distribution/README.md). The spec analyzes
# the checked-out src/ tree directly; an editable project install is unnecessary.
# Inno Setup (https://jrsoftware.org/isinfo.php, free) is required for the installer
# step -- the onedir build still gets produced without it, just not wrapped into an
# installer.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$Profile = "windows-direct"
$ArtifactDir = Join-Path $RepoRoot "distribution\artifacts\$Profile"
$BuildDir = Join-Path $RepoRoot "distribution\.build\$Profile"

function Find-SignTool {
    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Path }

    $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path $kits) {
        $candidate = Get-ChildItem -Path $kits -Filter "signtool.exe" -Recurse -File |
            Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }
    return $null
}

function Sign-Artifact([string]$Path) {
    $certificate = $env:QUILTOR_WINDOWS_CERTIFICATE_PATH
    $thumbprint = $env:QUILTOR_WINDOWS_CERTIFICATE_SHA1
    if (-not $certificate -and -not $thumbprint) {
        if ($env:QUILTOR_REQUIRE_SIGNING -eq "1") {
            throw "Release builds require a Windows signing certificate. Unsigned output is local-development only."
        }
        Write-Warning "Unsigned development build: no Windows signing certificate configured."
        return
    }
    if ($certificate -and $thumbprint) {
        throw "Set only one of QUILTOR_WINDOWS_CERTIFICATE_PATH or QUILTOR_WINDOWS_CERTIFICATE_SHA1."
    }

    $signTool = Find-SignTool
    if (-not $signTool) { throw "signtool.exe is required when Windows signing is configured." }
    $timestamp = if ($env:QUILTOR_WINDOWS_TIMESTAMP_URL) {
        $env:QUILTOR_WINDOWS_TIMESTAMP_URL
    } else {
        "https://timestamp.digicert.com"
    }
    $arguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $timestamp)
    if ($certificate) {
        $resolvedCertificate = (Resolve-Path -LiteralPath $certificate).Path
        $arguments += @("/f", $resolvedCertificate)
        if ($env:QUILTOR_WINDOWS_CERTIFICATE_PASSWORD) {
            $arguments += @("/p", $env:QUILTOR_WINDOWS_CERTIFICATE_PASSWORD)
        }
    } else {
        if ($thumbprint -notmatch "^[0-9A-Fa-f]{40}$") {
            throw "QUILTOR_WINDOWS_CERTIFICATE_SHA1 must be a 40-character certificate thumbprint."
        }
        $arguments += @("/sha1", $thumbprint)
    }
    $arguments += $Path
    & $signTool @arguments
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $Path with exit code $LASTEXITCODE." }
    & $signTool verify /pa /v $Path
    if ($LASTEXITCODE -ne 0) { throw "Authenticode verification failed for $Path." }
}

Push-Location $RepoRoot
try {
    if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
        throw "The windows-direct profile currently supports x86_64 only; this host is $env:PROCESSOR_ARCHITECTURE."
    }
    if (-not (Test-Path "distribution/assets/icons/icon.ico")) {
        python distribution/tooling/make_icons.py
    }

    python distribution/tooling/profile_contract.py validate $Profile
    if ($LASTEXITCODE -ne 0) { throw "Distribution profile validation failed." }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm build failed with exit code $LASTEXITCODE." }
    New-Item -ItemType Directory -Path $ArtifactDir -Force | Out-Null
    New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null

    # Pinned, not inherited: a stale shell cannot turn this into a Store artifact.
    $env:QUILTOR_BUILD_PROFILE_ID = $Profile
    pyinstaller distribution/desktop/pyinstaller/quiltor.spec `
        --distpath $ArtifactDir `
        --workpath (Join-Path $BuildDir "pyinstaller") `
        --noconfirm
    # $ErrorActionPreference does not apply to native commands: without this the
    # script would keep going after a failed freeze, hand ISCC an empty folder,
    # and still exit 0 -- a green CI job with no installer in it.
    if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed with exit code $LASTEXITCODE." }

    Write-Host ""
    $application = Join-Path $ArtifactDir "Quiltor\Quiltor.exe"
    Write-Host "Built $application"
    Sign-Artifact $application

    $version = (Get-Content "VERSION" -Raw).Trim()
    $isccCmd = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    $isccPath = $null
    if ($isccCmd) {
        $isccPath = $isccCmd.Path
    } else {
        $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
        if (Test-Path $candidate) { $isccPath = $candidate }
    }

    if ($isccPath) {
        & $isccPath `
            "/DMyAppVersion=$version" `
            "/DBuildDir=$ArtifactDir\Quiltor" `
            "/DOutputDir=$ArtifactDir" `
            "/DIconPath=$RepoRoot\distribution\assets\icons\icon.ico" `
            "/DLicensePath=$RepoRoot\LICENSE" `
            "/DThirdPartyNoticesPath=$RepoRoot\THIRD-PARTY-NOTICES.md" `
            "distribution\desktop\windows\direct\quiltor.iss"
        if ($LASTEXITCODE -ne 0) { throw "ISCC.exe failed with exit code $LASTEXITCODE." }
        $installer = Join-Path $ArtifactDir "Quiltor-Setup-$version.exe"
        Sign-Artifact $installer
        Write-Host ""
        Write-Host "Built $installer"
    } else {
        if ($env:QUILTOR_REQUIRE_SIGNING -eq "1") {
            throw "Inno Setup is required for a release build; no publishable installer was produced."
        }
        Write-Host ""
        Write-Host "Inno Setup (ISCC.exe) not found -- skipping the installer step."
        Write-Host "Install it from https://jrsoftware.org/isinfo.php and re-run to get Quiltor-Setup-$version.exe."
    }
} finally {
    Pop-Location
}
