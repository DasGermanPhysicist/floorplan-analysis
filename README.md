# AirFinder 2 — Floorplan Analyzer

Automated infrastructure placement tool for Link Labs AirFinder 2 indoor asset tracking system.

## Features

- **Multi-Floor PDF Support** — Upload multi-page PDFs, each page becomes a floor
- **Wall & Room Detection** — OpenCV-powered computer vision pipeline
- **Scale Calibration** — Click two known points to set real-world scale
- **Auto-Placement** — Automatically place location beacons, access points, and gateways
- **AP Coverage Guarantee** — Every beacon is within the coverage disc of at least one AP
- **Manual Adjustment** — Drag-and-drop devices, right-click to remove, bulk select/delete
- **Draw & Delete Rooms** — Manually draw room polygons or remove detected rooms
- **Floor Renaming** — Double-click a floor to rename it
- **Room Statistics** — View total rooms, area, and per-floor breakdown
- **Save/Load Projects** — Save your work as a `.zip` and load it later
- **BOM & PDF Export** — Generate Bill of Materials or annotated PDF reports

## Placement Rules (Configurable)

| Device | Default Spacing | Notes |
|--------|----------------|-------|
| Location Beacon | 30–60 ft (default 45) | Per-room placement with grid fill for large rooms |
| Access Point | ~100 ft | Placed to cover all beacons within AP spacing / 2 |
| Gateway | 1:10 AP ratio | K-means clustered among APs |

---

## Installation

### Option 1: One-Click Installer (macOS)

Run a single command — it installs all dependencies, builds the app, and creates a desktop shortcut:

```bash
curl -fsSL https://raw.githubusercontent.com/DasGermanPhysicist/floorplan-analysis/main/install.sh | bash
```

After installation, **double-click "Floorplan Analyzer" on your Desktop** to launch.

> The installer automatically handles Homebrew, Python, Node.js, Poppler, and all dependencies.  
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

1. **Upload** a floorplan (PDF or image) — multi-page PDFs create one floor per page
2. **Calibrate** the scale by clicking two points with a known distance
3. **Adjust** placement rules (beacon spacing, AP spacing, gateway ratio, beacons per room)
4. **Auto-Place** devices on the current floor or all floors at once
5. **Refine** — drag devices, draw/delete rooms, bulk select and remove devices
6. **Export** — download BOM, annotated PDF, or save the full project as a `.zip`

## Tech Stack

- **Backend**: Python, FastAPI, OpenCV, NumPy, SciPy
- **Frontend**: React, Vite, TailwindCSS, Lucide Icons
- **PDF Processing**: pdf2image + Poppler
- **PDF Export**: fpdf2
