# AirFinder 2 — Floorplan Analyzer

Automated infrastructure placement tool for Link Labs AirFinder 2 indoor asset tracking system.

## Features

- **Multi-Floor PDF Support** — Upload multi-page PDFs, each page becomes a floor
- **Wall & Room Detection** — OpenCV-powered computer vision pipeline
- **Skip Analysis Mode** — Upload without room detection for manual-only placement
- **Per-Floor Scale Calibration** — Calibrate each floor independently, or use one scale for all
- **Feet / Meters Toggle** — Switch display units; backend stays in feet internally
- **Auto-Placement** — Automatically place location beacons, access points, and gateways (with confirmation dialog)
- **AP Coverage Guarantee** — Every beacon is within the coverage disc of at least one AP
- **Manual Adjustment** — Drag-and-drop devices, right-click to remove, bulk select/delete
- **Draw & Delete Rooms** — Manually draw room polygons or remove detected rooms
- **Layer Visibility** — Toggle beacons, APs, gateways, rooms, and AP coverage circles on/off
- **Distinct Device Shapes** — Diamond (beacon), rounded square (AP), triangle (gateway)
- **Ruler / Measure Tool** — Click two points to measure distance in current units
- **Keyboard Shortcuts** — Quick keys for tabs, placement, measure, save (click ⌨ in header)
- **Autosave** — Session auto-saved to browser; restored on reload within 4 hours
- **Floor Renaming** — Double-click a floor to rename it
- **Room Statistics** — View total rooms, area, and per-floor breakdown
- **Save/Load Projects** — Save your work as a `.zip` and load it later
- **BOM & PDF Export** — Generate Bill of Materials or annotated PDF reports

## Placement Rules (Configurable)

| Device | Default Spacing | Notes |
|--------|----------------|-------|
| Location Beacon | 20–80 ft / 6–25 m (default 45 ft) | Per-room placement with grid fill for large rooms |
| Access Point | 50–200 ft / 15–60 m (default 100 ft) | Placed to cover all beacons within AP spacing / 2 |
| Gateway | 1:5 – 1:50 AP ratio (default 1:10) | K-means clustered among APs |

---

## Installation

### Option 1: One-Click Installer

#### macOS

```bash
curl -fsSL https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.sh | bash
```

#### Windows (run PowerShell as Administrator)

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.ps1'))
```

After installation, **double-click "Floorplan Analyzer" on your Desktop** to launch.

> Both installers handle all dependencies (Python, Node.js, Poppler) automatically.  
> To update: re-run the same command — it pulls the latest version.

### Option 2: Docker — One Command, Any OS

Works on macOS, Linux, and Windows. Requires only [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/DasGermanPhysicist/floorplan-analysis.git
cd floorplan-analysis
docker compose up --build
```

Open **http://localhost:8000** — that's it!

> Data persists in Docker volumes between restarts.  
> To stop: `docker compose down` · To reset all data: `docker compose down -v`

### Option 3: Manual Setup (Development)

#### Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **Poppler** for PDF processing:
  - macOS: `brew install poppler`
  - Ubuntu/Debian: `sudo apt-get install poppler-utils`
  - Windows: [Download Poppler for Windows](https://github.com/oschwartz10612/poppler-windows/releases)

#### Steps

```bash
# 1. Clone the repo
git clone https://github.com/DasGermanPhysicist/floorplan-analysis.git
cd floorplan-analysis

# 2. Backend
cd backend
python -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Workflow

1. **Upload** a floorplan (PDF or image) — optionally skip room analysis for manual-only mode
2. **Calibrate** the scale by clicking two points with a known distance (per-floor or shared)
3. **Adjust** placement rules on the Place tab (beacon spacing, AP spacing, gateway ratio, units)
4. **Auto-Place** devices on the current floor or all floors at once
5. **Refine** — drag devices, draw/delete rooms, bulk select and remove, use the ruler to verify
6. **Review** — toggle layer visibility, check device counts, measure distances
7. **Export** — download BOM, annotated PDF, or save the full project as a `.zip`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` / `2` / `3` | Switch to Setup / Place / Review tab |
| `B` | Toggle beacon placement tool |
| `A` | Toggle access point placement tool |
| `G` | Toggle gateway placement tool |
| `M` | Toggle ruler / measure tool |
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + Shift + Z` | Redo |
| `Esc` | Cancel current mode |
| `Delete` | Delete selected devices |
| `⌘/Ctrl + S` | Save project |

## Tech Stack

- **Backend**: Python, FastAPI, OpenCV, NumPy, SciPy
- **Frontend**: React, Vite, TailwindCSS, Lucide Icons
- **PDF Processing**: pdf2image + Poppler
- **PDF Export**: fpdf2
