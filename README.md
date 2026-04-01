# AirFinder 2 — Floorplan Analyzer

Automated infrastructure placement tool for Link Labs AirFinder 2 indoor asset tracking system.

## Features

- **Floorplan Upload** — Upload PDF or image floorplans
- **Wall & Room Detection** — OpenCV-powered computer vision pipeline
- **Scale Calibration** — Click two known points to set real-world scale
- **Auto-Placement** — Automatically place location beacons, access points, and gateways
- **Manual Adjustment** — Drag-and-drop to move devices, right-click to remove
- **BOM Export** — Generate Bill of Materials in JSON or CSV

## Placement Rules (Configurable)

| Device | Default Spacing | Notes |
|--------|----------------|-------|
| Location Beacon | 30–60 ft (default 45) | One per room, or grid-based |
| Access Point | ~100 ft | Grid coverage |
| Gateway | 1:10 AP ratio | Clustered placement |

## Prerequisites

- **Python 3.10+** with pip
- **Node.js 18+** with npm
- **Poppler** (for PDF processing): `brew install poppler` on macOS

## Quick Start

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend (in a separate terminal)
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173

## Workflow

1. Upload a floorplan (PDF or image)
2. Calibrate the scale by clicking two points with a known distance
3. Adjust placement rules (beacon spacing, AP spacing, gateway ratio)
4. Click "Auto-Place All Devices"
5. Drag devices to adjust, right-click to remove, use manual placement tools to add
6. Export the Bill of Materials
