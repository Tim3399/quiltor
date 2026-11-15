[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentInstaller
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$CurrentInstaller = (Resolve-Path $CurrentInstaller).Path
$Version = (Get-Content (Join-Path $RepoRoot "VERSION") -Raw).Trim()
$TempBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$Work = Join-Path $TempBase ("quiltor-windows-native-smoke-" + [Guid]::NewGuid().ToString("N"))
$InstallDir = Join-Path $Work "install\Quiltor"
$UserRoot = Join-Path $Work "user"
$PreviousInstaller = Join-Path $Work "previous.exe"
$PreviousMetadata = Join-Path $Work "previous.json"
$AppId = "{6E9F2A3E-6B4B-4C0E-9F44-2B7A6E9C4B5D}"
$UninstallKeyPath = "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\${AppId}_is1"
$ActiveProcess = $null
$Installed = $false
New-Item -ItemType Directory -Path $InstallDir, (Join-Path $UserRoot "home"), (Join-Path $UserRoot "data") -Force | Out-Null

function Get-QuiltorRegistration {
    if (-not (Test-Path -LiteralPath $UninstallKeyPath)) { return $null }
    return Get-ItemProperty -LiteralPath $UninstallKeyPath
}

function Convert-SemanticVersion([string]$Value) {
    $Match = [regex]::Match($Value, '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
    if (-not $Match.Success) { throw "Invalid semantic version: $Value" }
    return [Version]::new(
        [int]$Match.Groups[1].Value,
        [int]$Match.Groups[2].Value,
        [int]$Match.Groups[3].Value
    )
}

function Assert-PreviousOrder([string]$PreviousVersion) {
    if ((Convert-SemanticVersion $PreviousVersion) -ge (Convert-SemanticVersion $Version)) {
        throw "Predecessor version $PreviousVersion is not earlier than current $Version."
    }
}

function Read-PreviousMetadata {
    $Metadata = Get-Content -LiteralPath $PreviousMetadata -Raw | ConvertFrom-Json
    $ExpectedProperties = @("asset", "kind", "schemaVersion", "tag", "version")
    $ActualProperties = @($Metadata.PSObject.Properties.Name | Sort-Object)
    if (@(Compare-Object $ExpectedProperties $ActualProperties).Count -ne 0 -or
        $Metadata.schemaVersion -ne 1 -or $Metadata.kind -ne "windows-installer") {
        throw "Previous release metadata does not match its schema."
    }
    $SelectedVersion = [string]$Metadata.version
    Convert-SemanticVersion $SelectedVersion | Out-Null
    $NormalizedTag = ([string]$Metadata.tag) -replace '^v', ''
    if ($NormalizedTag -ne $SelectedVersion) {
        throw "Selected release tag does not match its semantic version."
    }
    if ($Metadata.asset -ne "Quiltor-Setup-$SelectedVersion.exe") {
        throw "Selected release metadata does not name the canonical installer."
    }
    return $SelectedVersion
}

function Assert-ValidSignature([string]$Path) {
    $Signature = Get-AuthenticodeSignature -FilePath $Path
    if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or -not $Signature.SignerCertificate) {
        throw "Authenticode verification failed for $Path ($($Signature.Status))."
    }
    return $Signature.SignerCertificate.Subject
}

function Invoke-Installer([string]$Path) {
    $Arguments = @(
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/SP-",
        "/NOICONS",
        "/CURRENTUSER",
        "/DIR=`"$InstallDir`""
    )
    $Result = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
    if ($Result.ExitCode -ne 0) { throw "Installer exited with $($Result.ExitCode)." }
    $script:Installed = $true

    $Application = Join-Path $InstallDir "Quiltor.exe"
    $Uninstaller = Join-Path $InstallDir "unins000.exe"
    if (-not (Test-Path $Application -PathType Leaf) -or -not (Test-Path $Uninstaller -PathType Leaf)) {
        throw "Installer did not create the application and native uninstaller."
    }
    Assert-ValidSignature $Application | Out-Null
    $Registration = Get-QuiltorRegistration
    if (-not $Registration) { throw "The fixed Quiltor AppId uninstall registration is missing after install." }
    if ([IO.Path]::GetFullPath($Registration.InstallLocation).TrimEnd('\') -ne [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')) {
        throw "Uninstall registration points outside the isolated install target."
    }
    $RegisteredUninstaller = ([string]$Registration.UninstallString).Trim('"')
    if (-not [string]::Equals($RegisteredUninstaller, $Uninstaller, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Uninstall registration does not point at the isolated native uninstaller."
    }
    return $Registration
}

function Assert-PortFree {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:8843/api/version" -UseBasicParsing -TimeoutSec 1 | Out-Null
        throw "Port 8843 was already serving before the native launch."
    } catch {
        if ($_.Exception.Message -like "Port 8843 was already*") { throw }
    }
}

function Assert-NoInstalledProcess {
    $Prefix = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
    $Processes = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($Processes.Count -ne 0) { throw "A process from the isolated install target is still running." }
}

function New-ProcessToken {
    # 64 hex characters: the shape QUILTOR_MASTER_TOKEN accepts. Generated here, handed to the
    # process through its environment and never printed, so the smoke can open the owner URL
    # without the process having to write its own token anywhere (T-269 S269-4).
    $Bytes = New-Object byte[] 32
    $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
    return ([BitConverter]::ToString($Bytes) -replace '-', '').ToLowerInvariant()
}

function Invoke-LoopbackGet([string]$PathAndQuery, [string]$Cookie) {
    # One request, no redirect followed, so a 302 and its Set-Cookie can be read as they are.
    Add-Type -AssemblyName System.Net.Http
    $Handler = New-Object System.Net.Http.HttpClientHandler
    $Handler.AllowAutoRedirect = $false
    $Handler.UseCookies = $false
    $Client = New-Object System.Net.Http.HttpClient($Handler)
    $Client.Timeout = [TimeSpan]::FromSeconds(5)
    try {
        $Request = New-Object System.Net.Http.HttpRequestMessage(
            [System.Net.Http.HttpMethod]::Get, "http://127.0.0.1:8843$PathAndQuery")
        if ($Cookie) { $Request.Headers.TryAddWithoutValidation("Cookie", $Cookie) | Out-Null }
        $Response = $Client.SendAsync($Request).GetAwaiter().GetResult()
        $SetCookie = @()
        if ($Response.Headers.Contains("Set-Cookie")) { $SetCookie = @($Response.Headers.GetValues("Set-Cookie")) }
        $Location = if ($Response.Headers.Location) { $Response.Headers.Location.OriginalString } else { "" }
        return [pscustomobject]@{ Status = [int]$Response.StatusCode; SetCookie = $SetCookie; Location = $Location }
    } finally {
        $Client.Dispose()
    }
}

function Assert-OwnerTokenPath([string]$Token) {
    # No token: the loopback port alone must not open the owner's worlds.
    $Anonymous = Invoke-LoopbackGet "/api/whoami" ""
    if ($Anonymous.Status -ne 401) { throw "GET /api/whoami without a token answered $($Anonymous.Status), expected 401." }
    # The owner URL the window opens: a redirect that drops the token and sets the cookie.
    $Owner = Invoke-LoopbackGet "/?token=$Token" ""
    if ($Owner.Status -ne 302) { throw "GET /?token=<process token> answered $($Owner.Status), expected 302." }
    if ($Owner.Location -like "*token=*") { throw "The owner redirect still carries the token." }
    if ($Owner.SetCookie.Count -eq 0) { throw "The owner redirect set no session cookie." }
    $Cookie = ($Owner.SetCookie[0] -split ';')[0]
    $Session = Invoke-LoopbackGet "/api/whoami" $Cookie
    if ($Session.Status -ne 200) { throw "GET /api/whoami with the owner cookie answered $($Session.Status), expected 200." }
}

function Start-AndProbe([string]$ExpectedVersion, [bool]$CheckToken = $false) {
    Assert-PortFree
    $OldHome = $env:QUILTOR_HOME
    $OldData = $env:QUILTOR_DATA_DIR
    $OldToken = $env:QUILTOR_MASTER_TOKEN
    $ProcessToken = if ($CheckToken) { New-ProcessToken } else { $null }
    try {
        $env:QUILTOR_HOME = Join-Path $UserRoot "home"
        $env:QUILTOR_DATA_DIR = Join-Path $UserRoot "data"
        if ($CheckToken) { $env:QUILTOR_MASTER_TOKEN = $ProcessToken }
        $script:ActiveProcess = Start-Process -FilePath (Join-Path $InstallDir "Quiltor.exe") -PassThru
    } finally {
        $env:QUILTOR_HOME = $OldHome
        $env:QUILTOR_DATA_DIR = $OldData
        $env:QUILTOR_MASTER_TOKEN = $OldToken
    }

    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
        if ($ActiveProcess.HasExited) { throw "Installed Quiltor exited before its readiness probe." }
        try {
            $Response = Invoke-RestMethod -Uri "http://127.0.0.1:8843/api/version" -TimeoutSec 1
            if ($Response.ok -eq $true -and $Response.version -eq $ExpectedVersion) {
                $Ready = $true
                break
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) { throw "Installed Quiltor did not report expected version $ExpectedVersion." }
    # Only the current build: a predecessor release may predate the token path.
    if ($CheckToken) { Assert-OwnerTokenPath $ProcessToken }
    Start-Sleep -Seconds 2
    if ($ActiveProcess.HasExited) { throw "Installed Quiltor exited immediately after readiness." }
    Stop-Process -Id $ActiveProcess.Id -Force
    $ActiveProcess.WaitForExit(15000) | Out-Null
    $script:ActiveProcess = $null
    Assert-PortFree
    Assert-NoInstalledProcess
}

function Invoke-NativeUninstall {
    $Uninstaller = Join-Path $InstallDir "unins000.exe"
    if (-not (Test-Path $Uninstaller -PathType Leaf)) { throw "Native uninstaller is missing." }
    $Result = Start-Process -FilePath $Uninstaller -ArgumentList @(
        "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"
    ) -Wait -PassThru
    if ($Result.ExitCode -ne 0) { throw "Native uninstaller exited with $($Result.ExitCode)." }
    for ($Attempt = 0; $Attempt -lt 30 -and (Test-Path $InstallDir); $Attempt++) {
        Start-Sleep -Milliseconds 500
    }
    if (Test-Path $InstallDir) { throw "Native uninstaller left the isolated install target behind." }
    if (Get-QuiltorRegistration) { throw "Native uninstaller left its fixed AppId registry entry behind." }
    Assert-PortFree
    Assert-NoInstalledProcess
    $script:Installed = $false
}

try {
    if (Get-QuiltorRegistration) {
        throw "The fixed Quiltor AppId is already registered for this user; refusing to mutate that installation."
    }
    $CurrentPublisher = Assert-ValidSignature $CurrentInstaller
    $Bootstrap = $false
    $PreviousExpectedVersion = $null
    if ($env:QUILTOR_PREVIOUS_INSTALLER) {
        if ([string]::IsNullOrWhiteSpace($env:QUILTOR_PREVIOUS_VERSION)) {
            throw "QUILTOR_PREVIOUS_VERSION is required with QUILTOR_PREVIOUS_INSTALLER."
        }
        Copy-Item -LiteralPath $env:QUILTOR_PREVIOUS_INSTALLER -Destination $PreviousInstaller
        $PreviousExpectedVersion = $env:QUILTOR_PREVIOUS_VERSION
        Assert-PreviousOrder $PreviousExpectedVersion
    } else {
        $NativeErrorPreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
        $OriginalNativeErrorPreference = if ($NativeErrorPreference) { $NativeErrorPreference.Value } else { $null }
        if ($NativeErrorPreference) { Set-Variable PSNativeCommandUseErrorActionPreference $false }
        try {
            & python (Join-Path $RepoRoot "distribution\tooling\previous_release.py") `
                --kind windows-installer --current-version $Version --output $PreviousInstaller `
                --metadata-output $PreviousMetadata
            $LookupStatus = $LASTEXITCODE
        } finally {
            if ($NativeErrorPreference) {
                Set-Variable PSNativeCommandUseErrorActionPreference $OriginalNativeErrorPreference
            }
        }
        if ($LookupStatus -eq 3) {
            $Bootstrap = $true
            Write-Host "BOOTSTRAP: exercising clean install plus same-version reinstall; no predecessor exists."
        } elseif ($LookupStatus -ne 0) {
            throw "Previous stable installer lookup failed; refusing to skip the upgrade gate."
        } else {
            $PreviousExpectedVersion = Read-PreviousMetadata
            Assert-PreviousOrder $PreviousExpectedVersion
        }
    }

    if (-not $Bootstrap) {
        $PreviousPublisher = Assert-ValidSignature $PreviousInstaller
        if ($PreviousPublisher -ne $CurrentPublisher) { throw "Previous and current installers have different signed publishers." }
        $PreviousRegistration = Invoke-Installer $PreviousInstaller
        if ($PreviousRegistration.DisplayVersion -ne $PreviousExpectedVersion) {
            throw "Predecessor installer version does not match the selected release."
        }
        Start-AndProbe $PreviousExpectedVersion
        Set-Content -LiteralPath (Join-Path $UserRoot "data\native-smoke-marker") -Value "upgrade-preserves-user-data"
    } else {
        $BootstrapRegistration = Invoke-Installer $CurrentInstaller
        if ($BootstrapRegistration.DisplayVersion -ne $Version) { throw "Bootstrap install registered the wrong version." }
        Start-AndProbe $Version $true
        Set-Content -LiteralPath (Join-Path $UserRoot "data\native-smoke-marker") -Value "bootstrap-reinstall-preserves-user-data"
    }

    $CurrentRegistration = Invoke-Installer $CurrentInstaller
    if ($CurrentRegistration.DisplayVersion -ne $Version) { throw "Upgrade registered the wrong current version." }
    if (-not (Test-Path (Join-Path $UserRoot "data\native-smoke-marker"))) { throw "Upgrade lost isolated user data." }
    Start-AndProbe $Version $true
    Invoke-NativeUninstall
    Write-Host "Windows native install/upgrade/launch/uninstall smoke passed for $Version"
} finally {
    if ($ActiveProcess -and -not $ActiveProcess.HasExited) {
        Stop-Process -Id $ActiveProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($Installed -and (Test-Path (Join-Path $InstallDir "unins000.exe"))) {
        Start-Process -FilePath (Join-Path $InstallDir "unins000.exe") `
            -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART") -Wait -ErrorAction SilentlyContinue | Out-Null
    }
    $ResolvedTemp = [IO.Path]::GetFullPath($TempBase).TrimEnd('\') + '\'
    $ResolvedWork = [IO.Path]::GetFullPath($Work)
    if (-not $ResolvedWork.StartsWith($ResolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($ResolvedWork).StartsWith("quiltor-windows-native-smoke-"))) {
        throw "Refusing unsafe smoke cleanup target: $ResolvedWork"
    }
    if (Test-Path $ResolvedWork) { Remove-Item -LiteralPath $ResolvedWork -Recurse -Force }
}
