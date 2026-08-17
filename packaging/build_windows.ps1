# Builds the Windows Quiltor desktop app: the onedir Quiltor.exe bundle, then a
# proper Setup.exe installer around it (Start Menu shortcut, optional Desktop
# shortcut, uninstaller in "Apps & Features") if Inno Setup is installed.
#
#   powershell -ExecutionPolicy Bypass -File packaging/build_windows.ps1
#
# Requires: a Python 3.11+ venv with `pip install -e ".[desktop]"` and `pip install
# pyinstaller` already done in it (see README section "Desktop app" for the one-time
# setup), and Inno Setup (https://jrsoftware.org/isinfo.php, free) for the installer
# step -- the onedir build still gets produced without it, just not wrapped into an
# installer.

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $RepoRoot
try {
    if (-not (Test-Path "packaging/icons/icon.ico")) {
        python packaging/make_icons.py
    }

    npm run build

    # Pinned, not inherited: this script builds the Inno Setup installer, and a
    # QUILTOR_EDITION left over in the shell from testing the Store code paths
    # would otherwise silently produce an MSIX-shaped build here.
    $env:QUILTOR_EDITION = "direct"
    pyinstaller packaging/quiltor.spec `
        --distpath packaging/dist `
        --workpath packaging/build `
        --noconfirm
    # $ErrorActionPreference does not apply to native commands: without this the
    # script would keep going after a failed freeze, hand ISCC an empty folder,
    # and still exit 0 -- a green CI job with no installer in it.
    if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed with exit code $LASTEXITCODE." }

    Write-Host ""
    Write-Host "Built packaging/dist/Quiltor/Quiltor.exe"

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
        & $isccPath "/DMyAppVersion=$version" "packaging\quiltor.iss"
        if ($LASTEXITCODE -ne 0) { throw "ISCC.exe failed with exit code $LASTEXITCODE." }
        Write-Host ""
        Write-Host "Built packaging/dist/Quiltor-Setup-$version.exe"
    } else {
        Write-Host ""
        Write-Host "Inno Setup (ISCC.exe) not found -- skipping the installer step."
        Write-Host "Install it from https://jrsoftware.org/isinfo.php and re-run to get Quiltor-Setup-$version.exe."
    }
} finally {
    Pop-Location
}
