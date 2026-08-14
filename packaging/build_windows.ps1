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

    pyinstaller packaging/quiltor.spec `
        --distpath packaging/dist `
        --workpath packaging/build `
        --noconfirm

    Write-Host ""
    Write-Host "Built packaging/dist/Quiltor/Quiltor.exe"

    $version = (Get-Content "VERSION" -Raw).Trim()
    $iscc = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if (-not $iscc) {
        $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
        if (Test-Path $candidate) { $iscc = Get-Item $candidate }
    }

    if ($iscc) {
        & $iscc.Path "/DMyAppVersion=$version" "packaging\quiltor.iss"
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
