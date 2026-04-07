#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# AirFinder 2 Floorplan Analyzer — One-Click Installer (macOS)
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.sh | bash
# Or:
#   chmod +x install.sh && ./install.sh
# ─────────────────────────────────────────────────────────────────────────────

APP_NAME="Floorplan Analyzer"
REPO_URL="https://github.com/DasGermanPhysicist/floorplan-analysis.git"
INSTALL_DIR="$HOME/FloorplanAnalyzer"
LAUNCH_SCRIPT="$INSTALL_DIR/start.sh"
APP_SHORTCUT="$HOME/Desktop/$APP_NAME.command"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   AirFinder 2 — Floorplan Analyzer Installer            ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Helper functions ─────────────────────────────────────────────────────────

info()  { echo "  ✅  $1"; }
warn()  { echo "  ⚠️   $1"; }
step()  { echo ""; echo "▸ $1 ..."; }

command_exists() { command -v "$1" &>/dev/null; }

# ── Check macOS ──────────────────────────────────────────────────────────────

if [[ "$(uname)" != "Darwin" ]]; then
    echo "❌ This installer is for macOS only."
    echo "   For other platforms, use Docker: docker compose up --build"
    exit 1
fi

# ── Locate Homebrew (if available) ─────────────────────────────────────────

# Ensure brew is in PATH (Apple Silicon / Intel default locations)
if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -f /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
fi

HAS_BREW=false
if command_exists brew; then HAS_BREW=true; fi

ensure_brew() {
    # Try to install Homebrew if we don't have it and we need it
    if $HAS_BREW; then return 0; fi

    step "Installing Homebrew (required for missing dependencies)"
    # Check for sudo access first
    if ! sudo -n true 2>/dev/null; then
        echo ""
        echo "❌ Cannot auto-install dependencies without admin (sudo) access."
        echo ""
        echo "   Please ask an administrator to install the missing tools, or"
        echo "   install Homebrew manually (requires admin password once):"
        echo ""
        echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo ""
        echo "   Then re-run this installer."
        exit 1
    fi

    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    if command_exists brew; then
        HAS_BREW=true
        info "Homebrew installed"
    else
        echo "❌ Homebrew installation failed. Please install manually:"
        echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
}

# ── Check dependencies (install via Homebrew only if missing) ─────────────

MISSING=()

step "Checking Python"
if command_exists python3 && [[ "$(python3 -c 'import sys; print(sys.version_info >= (3,10))')" == "True" ]]; then
    info "Python 3.10+ found: $(python3 --version)"
else
    MISSING+=("python")
fi

step "Checking Node.js"
if command_exists node && [[ "$(node -e 'console.log(parseInt(process.version.slice(1)) >= 18)')" == "true" ]]; then
    info "Node.js 18+ found: $(node --version)"
else
    MISSING+=("node")
fi

step "Checking Poppler (PDF support)"
if command_exists pdftoppm; then
    info "Poppler found"
else
    MISSING+=("poppler")
fi

# Install anything that's missing
if [[ ${#MISSING[@]} -gt 0 ]]; then
    warn "Missing: ${MISSING[*]} — will install via Homebrew"
    ensure_brew
    for dep in "${MISSING[@]}"; do
        case "$dep" in
            python)
                warn "Installing Python via Homebrew..."
                brew install python@3.12
                info "Python installed"
                ;;
            node)
                warn "Installing Node.js via Homebrew..."
                brew install node@20
                info "Node.js installed"
                ;;
            poppler)
                warn "Installing Poppler via Homebrew..."
                brew install poppler
                info "Poppler installed"
                ;;
        esac
    done
else
    info "All system dependencies satisfied"
fi

# ── Clone or update the repository ───────────────────────────────────────────

step "Setting up application in $INSTALL_DIR"
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Existing installation found — pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    if [[ -d "$INSTALL_DIR" ]]; then
        warn "Removing old non-git install directory..."
        rm -rf "$INSTALL_DIR"
    fi
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi
info "Source code ready"

# ── Set up Python virtual environment ────────────────────────────────────────

step "Setting up Python environment"
cd "$INSTALL_DIR/backend"
if [[ ! -d "venv" ]]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
info "Python dependencies installed"

# ── Set up frontend ─────────────────────────────────────────────────────────

step "Building frontend"
cd "$INSTALL_DIR/frontend"
npm ci --silent
npm run build --silent
info "Frontend built"

# ── Copy frontend build to backend serving directory ─────────────────────────

step "Linking frontend to backend"
rm -rf "$INSTALL_DIR/backend/frontend_dist"
cp -r "$INSTALL_DIR/frontend/dist" "$INSTALL_DIR/backend/frontend_dist"
info "Frontend linked for production serving"

# ── Create launch script ────────────────────────────────────────────────────

step "Creating launch script"
cat > "$LAUNCH_SCRIPT" << 'LAUNCH_EOF'
#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/backend"

source venv/bin/activate

# Create required directories
mkdir -p uploads processed saved_projects

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   AirFinder 2 — Floorplan Analyzer                      ║"
echo "║   Open your browser to: http://localhost:8000            ║"
echo "║   Press Ctrl+C to stop the server                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Open browser after a short delay
(sleep 2 && open "http://localhost:8000") &

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
LAUNCH_EOF
chmod +x "$LAUNCH_SCRIPT"
info "Launch script created"

# ── Create desktop shortcut ─────────────────────────────────────────────────

step "Creating desktop shortcut"
cat > "$APP_SHORTCUT" << SHORTCUT_EOF
#!/usr/bin/env bash
"$LAUNCH_SCRIPT"
SHORTCUT_EOF
chmod +x "$APP_SHORTCUT"
info "Desktop shortcut created: ~/Desktop/$APP_NAME.command"

# ── Done! ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║   ✅ Installation complete!                              ║"
echo "║                                                          ║"
echo "║   To start the app:                                      ║"
echo "║   • Double-click '$APP_NAME' on your Desktop   ║"
echo "║   • Or run: ~/FloorplanAnalyzer/start.sh                 ║"
echo "║                                                          ║"
echo "║   The app opens at http://localhost:8000                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Ask if user wants to launch now
read -p "  Launch the app now? (Y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    exec "$LAUNCH_SCRIPT"
fi
