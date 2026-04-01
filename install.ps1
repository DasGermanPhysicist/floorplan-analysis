# ─────────────────────────────────────────────────────────────────────────────
# AirFinder 2 Floorplan Analyzer — One-Click Installer (Windows)
# ─────────────────────────────────────────────────────────────────────────────
# Usage (run in PowerShell as Administrator):
#   Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.ps1'))
# Or:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$APP_NAME = "Floorplan Analyzer"
$REPO_URL = "https://github.com/DasGermanPhysicist/floorplan-analysis.git"
$INSTALL_DIR = "$env:USERPROFILE\FloorplanAnalyzer"
$LAUNCH_SCRIPT = "$INSTALL_DIR\start.bat"
$DESKTOP = [Environment]::GetFolderPath("Desktop")
$SHORTCUT_PATH = "$DESKTOP\$APP_NAME.lnk"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   AirFinder 2 - Floorplan Analyzer Installer (Windows)        " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# ── Helper functions ─────────────────────────────────────────────────────────

function Info($msg)  { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "  [!!]  $msg" -ForegroundColor Yellow }
function Step($msg)  { Write-Host ""; Write-Host "> $msg ..." -ForegroundColor White }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# ── Check Windows ────────────────────────────────────────────────────────────

if ($env:OS -ne "Windows_NT") {
    Write-Host "This installer is for Windows only." -ForegroundColor Red
    Write-Host "For macOS, use: curl -fsSL https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.sh | bash"
    exit 1
}

# ── Check/Install winget ─────────────────────────────────────────────────────

$useWinget = Test-Command "winget"
$useChoco = Test-Command "choco"

if (-not $useWinget -and -not $useChoco) {
    Step "No package manager found"
    Write-Host "  This installer needs 'winget' (built into Windows 10/11) or 'chocolatey'." -ForegroundColor Yellow
    Write-Host "  winget should already be available on Windows 10 (1709+) and Windows 11." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  If winget is not available, install Chocolatey first:" -ForegroundColor Yellow
    Write-Host "    Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Then re-run this installer." -ForegroundColor Yellow
    exit 1
}

if ($useWinget) {
    Info "Using winget as package manager"
} else {
    Info "Using Chocolatey as package manager"
}

# ── Install Git (if missing) ─────────────────────────────────────────────────

Step "Checking Git"
if (Test-Command "git") {
    Info "Git found: $(git --version)"
} else {
    Warn "Git not found - installing..."
    if ($useWinget) {
        winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    } else {
        choco install git -y
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Info "Git installed"
}

# ── Install Python (if missing or too old) ───────────────────────────────────

Step "Checking Python"
$pythonOk = $false
if (Test-Command "python") {
    $pyVer = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    if ($pyVer) {
        $major, $minor = $pyVer.Split(".")
        if ([int]$major -ge 3 -and [int]$minor -ge 10) {
            $pythonOk = $true
            Info "Python $pyVer found"
        }
    }
}
if (-not $pythonOk) {
    Warn "Python 3.10+ not found - installing Python 3.12..."
    if ($useWinget) {
        winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
    } else {
        choco install python312 -y
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Info "Python installed"
}

# ── Install Node.js (if missing or too old) ──────────────────────────────────

Step "Checking Node.js"
$nodeOk = $false
if (Test-Command "node") {
    $nodeVer = node -e "console.log(process.version.slice(1).split('.')[0])" 2>$null
    if ($nodeVer -and [int]$nodeVer -ge 18) {
        $nodeOk = $true
        Info "Node.js v$nodeVer found"
    }
}
if (-not $nodeOk) {
    Warn "Node.js 18+ not found - installing Node.js 20..."
    if ($useWinget) {
        winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    } else {
        choco install nodejs-lts -y
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Info "Node.js installed"
}

# ── Install Poppler (PDF support) ────────────────────────────────────────────

Step "Checking Poppler (PDF support)"
$popplerOk = Test-Command "pdftoppm"
if (-not $popplerOk) {
    # Also check common install locations
    $popplerPaths = @(
        "$env:ProgramFiles\poppler*\Library\bin",
        "$env:ProgramFiles\poppler*\bin",
        "C:\poppler*\bin",
        "C:\poppler*\Library\bin"
    )
    foreach ($p in $popplerPaths) {
        $resolved = Resolve-Path $p -ErrorAction SilentlyContinue
        if ($resolved) {
            $env:Path += ";$resolved"
            $popplerOk = $true
            break
        }
    }
}

if ($popplerOk) {
    Info "Poppler found"
} else {
    Warn "Poppler not found - installing..."
    if ($useChoco) {
        choco install poppler -y
    } else {
        # winget doesn't have poppler — download manually
        $popplerUrl = "https://github.com/oschwartz10612/poppler-windows/releases/download/v24.08.0-0/Release-24.08.0-0.zip"
        $popplerZip = "$env:TEMP\poppler.zip"
        $popplerDir = "C:\poppler"

        Write-Host "  Downloading Poppler..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $popplerUrl -OutFile $popplerZip -UseBasicParsing
        Write-Host "  Extracting to $popplerDir..." -ForegroundColor Gray
        Expand-Archive -Path $popplerZip -DestinationPath $popplerDir -Force
        Remove-Item $popplerZip -Force

        # Find the bin directory inside the extracted folder
        $binDir = Get-ChildItem -Path $popplerDir -Recurse -Directory -Filter "bin" | Select-Object -First 1
        if ($binDir) {
            # Add to system PATH permanently
            $currentPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
            if ($currentPath -notlike "*$($binDir.FullName)*") {
                [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$($binDir.FullName)", "Machine")
            }
            $env:Path += ";$($binDir.FullName)"
        }
    }
    Info "Poppler installed"
}

# ── Clone or update the repository ───────────────────────────────────────────

Step "Setting up application in $INSTALL_DIR"
if (Test-Path "$INSTALL_DIR\.git") {
    Info "Existing installation found - pulling latest..."
    Push-Location $INSTALL_DIR
    git pull origin main
    Pop-Location
} else {
    if (Test-Path $INSTALL_DIR) {
        Warn "Removing old non-git install directory..."
        Remove-Item -Recurse -Force $INSTALL_DIR
    }
    git clone $REPO_URL $INSTALL_DIR
}
Info "Source code ready"

# ── Set up Python virtual environment ────────────────────────────────────────

Step "Setting up Python environment"
Push-Location "$INSTALL_DIR\backend"
if (-not (Test-Path "venv")) {
    python -m venv venv
}
& "$INSTALL_DIR\backend\venv\Scripts\Activate.ps1"
python -m pip install --upgrade pip -q
pip install -r requirements.txt -q
Info "Python dependencies installed"
Pop-Location

# ── Set up frontend ─────────────────────────────────────────────────────────

Step "Building frontend"
Push-Location "$INSTALL_DIR\frontend"
npm ci --silent
npm run build --silent
Info "Frontend built"
Pop-Location

# ── Copy frontend build to backend serving directory ─────────────────────────

Step "Linking frontend to backend"
$frontendDist = "$INSTALL_DIR\backend\frontend_dist"
if (Test-Path $frontendDist) {
    Remove-Item -Recurse -Force $frontendDist
}
Copy-Item -Recurse "$INSTALL_DIR\frontend\dist" $frontendDist
Info "Frontend linked for production serving"

# ── Create launch script (batch file) ───────────────────────────────────────

Step "Creating launch script"
$launchContent = @"
@echo off
title $APP_NAME
cd /d "%~dp0backend"

call venv\Scripts\activate.bat

if not exist uploads mkdir uploads
if not exist processed mkdir processed
if not exist saved_projects mkdir saved_projects

echo.
echo ================================================================
echo    AirFinder 2 - Floorplan Analyzer
echo    Open your browser to: http://localhost:8000
echo    Press Ctrl+C to stop the server
echo ================================================================
echo.

start "" "http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000
"@
Set-Content -Path $LAUNCH_SCRIPT -Value $launchContent -Encoding ASCII
Info "Launch script created"

# ── Create desktop shortcut ──────────────────────────────────────────────────

Step "Creating desktop shortcut"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($SHORTCUT_PATH)
$Shortcut.TargetPath = $LAUNCH_SCRIPT
$Shortcut.WorkingDirectory = $INSTALL_DIR
$Shortcut.Description = "Launch $APP_NAME"
$Shortcut.IconLocation = "shell32.dll,21"
$Shortcut.Save()
Info "Desktop shortcut created: $SHORTCUT_PATH"

# ── Done! ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "   Installation complete!                                       " -ForegroundColor Green
Write-Host "                                                                " -ForegroundColor Green
Write-Host "   To start the app:                                            " -ForegroundColor Green
Write-Host "   * Double-click '$APP_NAME' on your Desktop       " -ForegroundColor Green
Write-Host "   * Or run: $LAUNCH_SCRIPT                " -ForegroundColor Green
Write-Host "                                                                " -ForegroundColor Green
Write-Host "   The app opens at http://localhost:8000                       " -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""

$response = Read-Host "  Launch the app now? (Y/n)"
if ($response -eq "" -or $response -eq "Y" -or $response -eq "y") {
    & $LAUNCH_SCRIPT
}
