import os
import uuid
import json
import zipfile
import io
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List

from app.floorplan_processor import FloorplanProcessor
from app.placement_engine import PlacementEngine

app = FastAPI(title="AirFinder 2 Floorplan Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
PROCESSED_DIR = Path("processed")
PROCESSED_DIR.mkdir(exist_ok=True)
PROJECTS_DIR = Path("saved_projects")
PROJECTS_DIR.mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.mount("/processed", StaticFiles(directory="processed"), name="processed")

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}

# Frontend dist path — SPA catch-all route is registered at the end of this file
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend_dist"


# ── Pydantic models ──────────────────────────────────────────────────────────

class PlacementConfig(BaseModel):
    beacon_spacing_ft: float = 45.0
    ap_spacing_ft: float = 100.0
    gateway_to_ap_ratio: float = 0.1
    scale_pixels_per_ft: Optional[float] = None
    beacons_per_room: int = 1
    unit: str = "ft"  # Display unit preference (ft or m) — not used in placement math


class ScaleCalibration(BaseModel):
    project_id: str
    pixel_distance: float
    real_distance_ft: float
    floor_index: int = 0


class RoomDetectionParams(BaseModel):
    sensitivity: float = 8
    min_room_area_pct: float = 0.005
    max_room_area_pct: float = 6.0
    min_dilation: int = 6
    max_dilation: int = 20
    num_scales: int = 5
    solidity_threshold: float = 0.25
    max_aspect_ratio: float = 10.0


class ManualPlacement(BaseModel):
    project_id: str
    floor_index: int = 0
    device_type: str
    x: float
    y: float
    action: str
    device_id: Optional[str] = None


class FloorRename(BaseModel):
    project_id: str
    floor_index: int
    name: str


class BulkDelete(BaseModel):
    project_id: str
    floor_index: int = 0
    device_ids: List[str]


class DrawRoom(BaseModel):
    project_id: str
    floor_index: int = 0
    contour: List[List[float]]  # [[x,y], ...]


class DeleteRoom(BaseModel):
    project_id: str
    floor_index: int = 0
    room_id: str


# ── Helpers ──────────────────────────────────────────────────────────────────

class NumpySafeEncoder(json.JSONEncoder):
    """JSON encoder that handles numpy types."""
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

EMPTY_PLACEMENTS = {"beacons": [], "access_points": [], "gateways": []}


def _serialize_floor(floor: dict) -> dict:
    """Return a JSON-safe representation of a single floor."""
    p = floor["processed"]
    result = {
        "floor_index": floor["floor_index"],
        "name": floor["name"],
        "image_url": p["image_url"],
        "walls_image_url": p.get("walls_image_url"),
        "rooms_image_url": p.get("rooms_image_url"),
        "width": p["width"],
        "height": p["height"],
        "rooms_detected": p["num_rooms"],
        "walls": p.get("walls", []),
        "rooms": p.get("rooms", []),
        "placements": floor["placements"],
        "room_detection_params": floor["room_detection_params"],
    }
    if floor.get("scale_pixels_per_ft") is not None:
        result["scale_pixels_per_ft"] = floor["scale_pixels_per_ft"]
    return result


def _get_floor(project: dict, floor_index: int) -> dict:
    for f in project["floors"]:
        if f["floor_index"] == floor_index:
            return f
    raise HTTPException(404, f"Floor {floor_index} not found")


# In-memory project store
projects = {}


# ── Restore state (undo/redo sync) ──────────────────────────────────────────

class RestoreRequest(BaseModel):
    project_id: str
    floors: list  # full floors array from frontend snapshot


@app.post("/api/restore-state")
async def restore_state(req: RestoreRequest):
    """Sync backend in-memory state with frontend after undo/redo."""
    project = projects.get(req.project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    for floor_data in req.floors:
        idx = floor_data.get("floor_index", 0)
        floor = None
        for f in project["floors"]:
            if f["floor_index"] == idx:
                floor = f
                break
        if not floor:
            continue
        # Restore placements
        if "placements" in floor_data:
            floor["placements"] = floor_data["placements"]
        # Restore rooms
        if "rooms" in floor_data:
            floor["processed"]["rooms"] = floor_data["rooms"]
            floor["processed"]["num_rooms"] = len(floor_data["rooms"])
        # Restore per-floor scale
        if "scale_pixels_per_ft" in floor_data:
            floor["scale_pixels_per_ft"] = floor_data["scale_pixels_per_ft"]

    return {"status": "ok"}


# ── Upload & multi-page processing ──────────────────────────────────────────

@app.post("/api/upload")
async def upload_floorplan(
    file: UploadFile = File(...),
    skip_analysis: bool = Query(False),
):
    """Upload a floorplan image or PDF. Multi-page PDFs create multiple floors."""
    project_id = str(uuid.uuid4())[:8]
    ext = Path(file.filename).suffix.lower()

    if ext not in [".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tiff"]:
        raise HTTPException(400, "Unsupported file type. Use PDF, PNG, JPG, BMP, or TIFF.")

    upload_path = UPLOAD_DIR / f"{project_id}{ext}"
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)

    num_pages = FloorplanProcessor.count_pages(str(upload_path))
    floors = []
    default_rdp = RoomDetectionParams().model_dump()

    for page in range(1, num_pages + 1):
        floor_id = f"{project_id}_f{page}"
        processor = FloorplanProcessor(
            str(upload_path), floor_id, str(PROCESSED_DIR), page_number=page,
        )
        if skip_analysis:
            result = processor.process_image_only()
        else:
            result = processor.process()
        floors.append({
            "floor_index": page - 1,
            "name": f"Floor {page}",
            "processed": result,
            "placements": {**EMPTY_PLACEMENTS},
            "room_detection_params": {**default_rdp},
        })

    projects[project_id] = {
        "id": project_id,
        "filename": file.filename,
        "upload_path": str(upload_path),
        "floors": floors,
        "config": PlacementConfig().model_dump(),
    }

    return JSONResponse({
        "project_id": project_id,
        "filename": file.filename,
        "num_floors": len(floors),
        "floors": [_serialize_floor(f) for f in floors],
        "config": PlacementConfig().model_dump(),
    })


# ── Add floors to existing project ─────────────────────────────────────────

@app.post("/api/add-floors")
async def add_floors(
    file: UploadFile = File(...),
    project_id: str = Query(...),
    skip_analysis: bool = Query(False),
):
    """Upload an additional file and append its pages as new floors to an existing project."""
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    ext = Path(file.filename).suffix.lower()

    if ext not in [".pdf", ".png", ".jpg", ".jpeg", ".bmp", ".tiff"]:
        raise HTTPException(400, "Unsupported file type. Use PDF, PNG, JPG, BMP, or TIFF.")

    # Save the new file
    file_id = str(uuid.uuid4())[:8]
    upload_path = UPLOAD_DIR / f"{file_id}{ext}"
    content = await file.read()
    with open(upload_path, "wb") as f:
        f.write(content)

    num_pages = FloorplanProcessor.count_pages(str(upload_path))
    existing_count = len(project["floors"])
    default_rdp = RoomDetectionParams().model_dump()
    new_floors = []

    for page in range(1, num_pages + 1):
        floor_index = existing_count + page - 1
        floor_id = f"{project_id}_f{floor_index + 1}"
        processor = FloorplanProcessor(
            str(upload_path), floor_id, str(PROCESSED_DIR), page_number=page,
        )
        if skip_analysis:
            result = processor.process_image_only()
        else:
            result = processor.process()
        floor = {
            "floor_index": floor_index,
            "name": f"Floor {floor_index + 1}",
            "processed": result,
            "placements": {**EMPTY_PLACEMENTS},
            "room_detection_params": {**default_rdp},
        }
        project["floors"].append(floor)
        new_floors.append(floor)

    return JSONResponse({
        "project_id": project_id,
        "num_floors": len(project["floors"]),
        "floors": [_serialize_floor(f) for f in project["floors"]],
        "new_floor_indices": list(range(existing_count, existing_count + len(new_floors))),
    })


# ── Reprocess rooms on a specific floor ─────────────────────────────────────

@app.post("/api/reprocess")
async def reprocess_rooms(
    project_id: str, params: RoomDetectionParams,
    floor_index: int = Query(0),
):
    """Re-run room detection on one floor with updated parameters."""
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    floor = _get_floor(project, floor_index)
    room_params = params.model_dump()

    floor_id = f"{project_id}_f{floor_index + 1}"
    processor = FloorplanProcessor(
        project["upload_path"], floor_id, str(PROCESSED_DIR),
        room_detection_params=room_params,
        page_number=floor_index + 1,
    )
    result = processor.process()

    floor["processed"] = result
    floor["room_detection_params"] = room_params
    floor["placements"] = {**EMPTY_PLACEMENTS}

    return JSONResponse(_serialize_floor(floor))


# ── Scale calibration (per-floor with global fallback) ───────────────────────

@app.post("/api/calibrate-scale")
async def calibrate_scale(calibration: ScaleCalibration):
    if calibration.project_id not in projects:
        raise HTTPException(404, "Project not found")
    project = projects[calibration.project_id]
    scale = calibration.pixel_distance / calibration.real_distance_ft

    # Store on the specific floor
    floor = _get_floor(project, calibration.floor_index)
    floor["scale_pixels_per_ft"] = scale

    # Also set as global default (used by floors without their own calibration)
    project["config"]["scale_pixels_per_ft"] = scale

    return {"scale_pixels_per_ft": scale, "floor_index": calibration.floor_index}


# ── Auto-place on a specific floor ──────────────────────────────────────────

@app.post("/api/auto-place")
async def auto_place(
    project_id: str, config: Optional[PlacementConfig] = None,
    floor_index: int = Query(0),
):
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    if config:
        project["config"] = config.model_dump()

    floor = _get_floor(project, floor_index)

    # Use floor-specific scale if available, otherwise global config
    cfg_dict = dict(project["config"])
    floor_scale = floor.get("scale_pixels_per_ft")
    if floor_scale:
        cfg_dict["scale_pixels_per_ft"] = floor_scale

    cfg = PlacementConfig(**cfg_dict)
    if not cfg.scale_pixels_per_ft:
        raise HTTPException(400, "Scale not calibrated. Please calibrate first.")

    engine = PlacementEngine(processed_data=floor["processed"], config=cfg)
    placements = engine.compute_placements()
    floor["placements"] = placements

    return JSONResponse({
        "project_id": project_id,
        "floor_index": floor_index,
        "placements": placements,
        "summary": {
            "beacons": len(placements["beacons"]),
            "access_points": len(placements["access_points"]),
            "gateways": len(placements["gateways"]),
        },
    })


# ── Manual placement on a specific floor ─────────────────────────────────────

@app.post("/api/manual-adjust")
async def manual_adjust(adjustment: ManualPlacement):
    if adjustment.project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[adjustment.project_id]
    floor = _get_floor(project, adjustment.floor_index)

    device_list_key = {
        "beacon": "beacons",
        "access_point": "access_points",
        "gateway": "gateways",
    }.get(adjustment.device_type)
    if not device_list_key:
        raise HTTPException(400, "Invalid device type")

    devices = floor["placements"][device_list_key]

    if adjustment.action == "add":
        new_id = str(uuid.uuid4())[:8]
        devices.append({"id": new_id, "x": adjustment.x, "y": adjustment.y})
        return {"action": "added", "device_id": new_id}
    elif adjustment.action == "remove":
        floor["placements"][device_list_key] = [
            d for d in devices if d["id"] != adjustment.device_id
        ]
        return {"action": "removed", "device_id": adjustment.device_id}
    elif adjustment.action == "move":
        for d in devices:
            if d["id"] == adjustment.device_id:
                d["x"] = adjustment.x
                d["y"] = adjustment.y
                return {"action": "moved", "device_id": adjustment.device_id}
        raise HTTPException(404, "Device not found")


# ── Rename floor ─────────────────────────────────────────────────────────────

@app.post("/api/rename-floor")
async def rename_floor(body: FloorRename):
    if body.project_id not in projects:
        raise HTTPException(404, "Project not found")
    floor = _get_floor(projects[body.project_id], body.floor_index)
    floor["name"] = body.name
    return {"floor_index": body.floor_index, "name": body.name}


# ── Auto-place on ALL floors ─────────────────────────────────────────────────

@app.post("/api/auto-place-all")
async def auto_place_all(
    project_id: str, config: Optional[PlacementConfig] = None,
):
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    if config:
        project["config"] = config.model_dump()

    cfg = PlacementConfig(**project["config"])
    if not cfg.scale_pixels_per_ft:
        raise HTTPException(400, "Scale not calibrated. Please calibrate first.")

    results = []
    for floor in project["floors"]:
        engine = PlacementEngine(processed_data=floor["processed"], config=cfg)
        placements = engine.compute_placements()
        floor["placements"] = placements
        results.append({
            "floor_index": floor["floor_index"],
            "name": floor["name"],
            "summary": {
                "beacons": len(placements["beacons"]),
                "access_points": len(placements["access_points"]),
                "gateways": len(placements["gateways"]),
            },
        })

    return JSONResponse({
        "project_id": project_id,
        "floors": [_serialize_floor(f) for f in project["floors"]],
        "results": results,
    })


# ── Bulk delete devices ──────────────────────────────────────────────────────

@app.post("/api/bulk-delete")
async def bulk_delete(body: BulkDelete):
    if body.project_id not in projects:
        raise HTTPException(404, "Project not found")

    floor = _get_floor(projects[body.project_id], body.floor_index)
    ids_to_remove = set(body.device_ids)
    removed = 0

    for key in ["beacons", "access_points", "gateways"]:
        before = len(floor["placements"][key])
        floor["placements"][key] = [
            d for d in floor["placements"][key] if d["id"] not in ids_to_remove
        ]
        removed += before - len(floor["placements"][key])

    return {"removed": removed, "placements": floor["placements"]}


# ── Floorplan statistics ─────────────────────────────────────────────────────

@app.get("/api/statistics/{project_id}")
async def get_statistics(project_id: str):
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    scale = project["config"].get("scale_pixels_per_ft")

    floor_stats = []
    all_areas_px = []

    for floor in project["floors"]:
        rooms = floor["processed"].get("rooms", [])
        areas_px = [r["area_pixels"] for r in rooms]
        all_areas_px.extend(areas_px)

        fs = {
            "floor_index": floor["floor_index"],
            "name": floor["name"],
            "num_rooms": len(rooms),
            "total_area_px": sum(areas_px) if areas_px else 0,
        }

        if areas_px:
            fs["largest_room_px"] = max(areas_px)
            fs["smallest_room_px"] = min(areas_px)
            fs["avg_room_px"] = sum(areas_px) / len(areas_px)
        else:
            fs["largest_room_px"] = 0
            fs["smallest_room_px"] = 0
            fs["avg_room_px"] = 0

        # If scale is calibrated, add sq ft values
        if scale:
            px_per_sqft = scale * scale
            fs["total_area_sqft"] = round(fs["total_area_px"] / px_per_sqft, 1)
            fs["largest_room_sqft"] = round(fs["largest_room_px"] / px_per_sqft, 1)
            fs["smallest_room_sqft"] = round(fs["smallest_room_px"] / px_per_sqft, 1)
            fs["avg_room_sqft"] = round(fs["avg_room_px"] / px_per_sqft, 1)

        floor_stats.append(fs)

    total_rooms = sum(f["num_rooms"] for f in floor_stats)
    total = {
        "total_rooms": total_rooms,
        "total_area_px": sum(all_areas_px) if all_areas_px else 0,
    }
    if all_areas_px:
        total["largest_room_px"] = max(all_areas_px)
        total["smallest_room_px"] = min(all_areas_px)
        total["avg_room_px"] = round(sum(all_areas_px) / len(all_areas_px), 1)
    if scale and all_areas_px:
        px_per_sqft = scale * scale
        total["total_area_sqft"] = round(total["total_area_px"] / px_per_sqft, 1)
        total["largest_room_sqft"] = round(total["largest_room_px"] / px_per_sqft, 1)
        total["smallest_room_sqft"] = round(total["smallest_room_px"] / px_per_sqft, 1)
        total["avg_room_sqft"] = round(total["avg_room_px"] / px_per_sqft, 1)

    return JSONResponse({
        "project_id": project_id,
        "calibrated": scale is not None,
        "scale_pixels_per_ft": scale,
        "total": total,
        "floors": floor_stats,
    })


# ── Delete a room ────────────────────────────────────────────────────────────

@app.post("/api/delete-room")
async def delete_room(body: DeleteRoom):
    if body.project_id not in projects:
        raise HTTPException(404, "Project not found")

    floor = _get_floor(projects[body.project_id], body.floor_index)
    rooms = floor["processed"].get("rooms", [])
    original_len = len(rooms)
    rooms = [r for r in rooms if r["id"] != body.room_id]

    if len(rooms) == original_len:
        raise HTTPException(404, f"Room {body.room_id} not found")

    floor["processed"]["rooms"] = rooms
    floor["processed"]["num_rooms"] = len(rooms)

    # Update rooms mask: remove deleted room's pixels
    rooms_mask_path = floor["processed"].get("rooms_mask_path")
    if rooms_mask_path and os.path.exists(rooms_mask_path):
        rooms_mask = np.load(rooms_mask_path)
        # Room labels in mask are 1-indexed by original order; rebuild from remaining contours
        h, w = rooms_mask.shape[:2]
        new_mask = np.zeros((h, w), dtype=np.uint8)
        for i, room in enumerate(rooms):
            contour = room.get("contour")
            if contour:
                pts = np.array(contour, dtype=np.int32)
                cv2.fillPoly(new_mask, [pts], i + 1)
        np.save(rooms_mask_path, new_mask)

    # Regenerate rooms visualization
    img_url = floor["processed"].get("image_url")
    if img_url:
        img_path = str(PROCESSED_DIR / Path(img_url).name)
        img = cv2.imread(img_path)
        if img is not None:
            rooms_vis_url = floor["processed"].get("rooms_image_url")
            if rooms_vis_url:
                rooms_vis_path = str(PROCESSED_DIR / Path(rooms_vis_url).name)
                # Draw rooms overlay
                overlay = img.copy()
                for i, room in enumerate(rooms):
                    contour = room.get("contour")
                    if contour:
                        pts = np.array(contour, dtype=np.int32)
                        color = [
                            int(80 + (i * 47) % 176),
                            int(80 + (i * 83) % 176),
                            int(80 + (i * 131) % 176),
                        ]
                        cv2.fillPoly(overlay, [pts], color)
                        cv2.polylines(overlay, [pts], True, (0, 0, 0), 2)
                result = cv2.addWeighted(img, 0.6, overlay, 0.4, 0)
                cv2.imwrite(rooms_vis_path, result)

    return JSONResponse(_serialize_floor(floor))


# ── Draw a new room ──────────────────────────────────────────────────────────

@app.post("/api/draw-room")
async def draw_room(body: DrawRoom):
    if body.project_id not in projects:
        raise HTTPException(404, "Project not found")

    if len(body.contour) < 3:
        raise HTTPException(400, "A room needs at least 3 points")

    floor = _get_floor(projects[body.project_id], body.floor_index)
    rooms = floor["processed"].get("rooms", [])

    # Generate room data
    pts = np.array(body.contour, dtype=np.float32)
    area = float(cv2.contourArea(pts.astype(np.int32)))
    M = cv2.moments(pts.astype(np.int32))
    cx = float(M["m10"] / M["m00"]) if M["m00"] else float(pts[:, 0].mean())
    cy = float(M["m01"] / M["m00"]) if M["m00"] else float(pts[:, 1].mean())
    x, y, w, h = cv2.boundingRect(pts.astype(np.int32))

    new_id = f"room_{len(rooms)}_{str(uuid.uuid4())[:4]}"
    new_room = {
        "id": new_id,
        "centroid_x": cx,
        "centroid_y": cy,
        "area_pixels": area,
        "bbox": {"x": int(x), "y": int(y), "w": int(w), "h": int(h)},
        "contour": [[float(p[0]), float(p[1])] for p in body.contour],
    }
    rooms.append(new_room)
    floor["processed"]["rooms"] = rooms
    floor["processed"]["num_rooms"] = len(rooms)

    # Update rooms mask
    rooms_mask_path = floor["processed"].get("rooms_mask_path")
    if rooms_mask_path and os.path.exists(rooms_mask_path):
        rooms_mask = np.load(rooms_mask_path)
        contour_int = np.array(body.contour, dtype=np.int32)
        cv2.fillPoly(rooms_mask, [contour_int], len(rooms))
        np.save(rooms_mask_path, rooms_mask)

    # Regenerate rooms visualization
    img_url = floor["processed"].get("image_url")
    if img_url:
        img_path = str(PROCESSED_DIR / Path(img_url).name)
        img = cv2.imread(img_path)
        if img is not None:
            rooms_vis_url = floor["processed"].get("rooms_image_url")
            if rooms_vis_url:
                rooms_vis_path = str(PROCESSED_DIR / Path(rooms_vis_url).name)
                overlay = img.copy()
                for i, room in enumerate(rooms):
                    contour = room.get("contour")
                    if contour:
                        cpts = np.array(contour, dtype=np.int32)
                        color = [
                            int(80 + (i * 47) % 176),
                            int(80 + (i * 83) % 176),
                            int(80 + (i * 131) % 176),
                        ]
                        cv2.fillPoly(overlay, [cpts], color)
                        cv2.polylines(overlay, [cpts], True, (0, 0, 0), 2)
                result = cv2.addWeighted(img, 0.6, overlay, 0.4, 0)
                cv2.imwrite(rooms_vis_path, result)

    return JSONResponse(_serialize_floor(floor))


# ── Get full project state ───────────────────────────────────────────────────

@app.get("/api/project/{project_id}")
async def get_project(project_id: str):
    if project_id not in projects:
        raise HTTPException(404, "Project not found")
    project = projects[project_id]
    return JSONResponse({
        "project_id": project_id,
        "filename": project["filename"],
        "num_floors": len(project["floors"]),
        "floors": [_serialize_floor(f) for f in project["floors"]],
        "config": project["config"],
    })


# ── BOM export (all floors) ─────────────────────────────────────────────────

@app.get("/api/export/{project_id}")
async def export_bom(project_id: str):
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    floor_details = []
    totals = {"beacons": 0, "access_points": 0, "gateways": 0}

    for floor in project["floors"]:
        pl = floor["placements"]
        nb = len(pl.get("beacons", []))
        na = len(pl.get("access_points", []))
        ng = len(pl.get("gateways", []))
        totals["beacons"] += nb
        totals["access_points"] += na
        totals["gateways"] += ng
        floor_details.append({
            "floor_index": floor["floor_index"],
            "name": floor["name"],
            "beacons": nb,
            "access_points": na,
            "gateways": ng,
            "total": nb + na + ng,
            "placement_details": pl,
        })

    bom = {
        "project_id": project_id,
        "filename": project["filename"],
        "items": [
            {"device": "Location Beacon", "model": "AirFinder 2 Location Beacon", "quantity": totals["beacons"]},
            {"device": "Access Point", "model": "AirFinder 2 Access Point", "quantity": totals["access_points"]},
            {"device": "Gateway", "model": "AirFinder 2 Gateway", "quantity": totals["gateways"]},
        ],
        "total_devices": sum(totals.values()),
        "floor_details": floor_details,
    }
    return JSONResponse(bom)


# ── PDF export (floorplan with device overlays) ─────────────────────────────

@app.get("/api/export-pdf/{project_id}")
async def export_pdf(project_id: str):
    """Export annotated floorplans as a multi-page PDF."""
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(False)

    for floor in project["floors"]:
        p = floor["processed"]
        img_path = str(PROCESSED_DIR / Path(p["image_url"]).name)

        # Render device overlays onto the image
        img = cv2.imread(img_path)
        if img is None:
            continue

        for device_type, color, label in [
            ("beacons", (255, 130, 50), "B"),
            ("access_points", (50, 200, 80), "AP"),
            ("gateways", (200, 80, 240), "GW"),
        ]:
            for d in floor["placements"].get(device_type, []):
                cx, cy = int(d["x"]), int(d["y"])
                cv2.circle(img, (cx, cy), 14, color, -1)
                cv2.circle(img, (cx, cy), 14, (255, 255, 255), 2)
                cv2.putText(img, label, (cx - 8, cy + 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        # Write annotated image to temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.close()
        cv2.imwrite(tmp.name, img)

        h_img, w_img = img.shape[:2]
        # Fit to A3 landscape (420×297mm) with margins
        page_w, page_h = 420, 297
        margin = 10
        scale_x = (page_w - 2 * margin) / w_img
        scale_y = (page_h - 2 * margin - 10) / h_img  # 10mm for title
        scale = min(scale_x, scale_y)

        pdf.add_page("L", format="A3")
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 8, f"{floor['name']} - {project['filename']}")
        pdf.ln(8)
        pdf.image(tmp.name, x=margin, y=margin + 10,
                  w=w_img * scale, h=h_img * scale)
        os.unlink(tmp.name)

    buf = io.BytesIO()
    pdf.output(buf)
    buf.seek(0)

    return StreamingResponse(
        buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=floorplan_{project_id}.pdf"},
    )


# ── Save project ─────────────────────────────────────────────────────────────

@app.get("/api/save-project/{project_id}")
async def save_project(project_id: str):
    """Download full project state as a .zip file."""
    if project_id not in projects:
        raise HTTPException(404, "Project not found")

    project = projects[project_id]
    buf = io.BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Project metadata (JSON-safe subset)
        meta = {
            "id": project["id"],
            "filename": project["filename"],
            "config": project["config"],
            "floors": [],
        }
        for floor in project["floors"]:
            floor_meta = {
                "floor_index": floor["floor_index"],
                "name": floor["name"],
                "scale_pixels_per_ft": floor.get("scale_pixels_per_ft"),
                "room_detection_params": floor["room_detection_params"],
                "placements": floor["placements"],
                "processed_keys": {
                    "image_url": floor["processed"]["image_url"],
                    "walls_image_url": floor["processed"].get("walls_image_url"),
                    "rooms_image_url": floor["processed"].get("rooms_image_url"),
                    "width": floor["processed"]["width"],
                    "height": floor["processed"]["height"],
                    "num_rooms": floor["processed"]["num_rooms"],
                    "walls": floor["processed"].get("walls", []),
                    "rooms": floor["processed"].get("rooms", []),
                },
            }
            meta["floors"].append(floor_meta)

            # Add mask .npy files
            for mask_key in ["walls_mask_path", "rooms_mask_path", "building_mask_path"]:
                mask_path = floor["processed"].get(mask_key)
                if mask_path and os.path.exists(mask_path):
                    zf.write(mask_path, f"masks/{os.path.basename(mask_path)}")

            # Add processed images
            for url_key in ["image_url", "walls_image_url", "rooms_image_url"]:
                url = floor["processed"].get(url_key)
                if url:
                    img_file = str(PROCESSED_DIR / Path(url).name)
                    if os.path.exists(img_file):
                        zf.write(img_file, f"images/{Path(url).name}")

        # Add the original upload
        if os.path.exists(project["upload_path"]):
            zf.write(project["upload_path"], f"upload/{Path(project['upload_path']).name}")

        zf.writestr("project.json", json.dumps(meta, indent=2, cls=NumpySafeEncoder))

    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=project_{project_id}.zip"},
    )


# ── Load project ─────────────────────────────────────────────────────────────

@app.post("/api/load-project")
async def load_project(file: UploadFile = File(...)):
    """Upload a saved project .zip and restore it."""
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(400, "Empty file uploaded")
    buf = io.BytesIO(content)

    try:
        zf_test = zipfile.ZipFile(io.BytesIO(content), "r")
        zf_test.close()
    except zipfile.BadZipFile:
        raise HTTPException(400, "Uploaded file is not a valid .zip project file")

    with zipfile.ZipFile(buf, "r") as zf:
        meta = json.loads(zf.read("project.json"))

        project_id = meta["id"]

        # Extract upload file
        upload_files = [n for n in zf.namelist() if n.startswith("upload/")]
        upload_path = None
        if upload_files:
            upload_name = upload_files[0]
            upload_path = str(UPLOAD_DIR / Path(upload_name).name)
            with open(upload_path, "wb") as f:
                f.write(zf.read(upload_name))

        # Extract images
        for name in zf.namelist():
            if name.startswith("images/"):
                dest = str(PROCESSED_DIR / Path(name).name)
                with open(dest, "wb") as f:
                    f.write(zf.read(name))

        # Extract masks
        for name in zf.namelist():
            if name.startswith("masks/"):
                dest = str(PROCESSED_DIR / Path(name).name)
                with open(dest, "wb") as f:
                    f.write(zf.read(name))

        # Reconstruct floors
        floors = []
        for fm in meta["floors"]:
            pk = fm["processed_keys"]
            floor_id = f"{project_id}_f{fm['floor_index'] + 1}"
            processed = {
                **pk,
                "walls_mask_path": str(PROCESSED_DIR / f"{floor_id}_walls_mask.npy"),
                "rooms_mask_path": str(PROCESSED_DIR / f"{floor_id}_rooms_mask.npy"),
                "building_mask_path": str(PROCESSED_DIR / f"{floor_id}_building_mask.npy"),
            }
            floor_obj = {
                "floor_index": fm["floor_index"],
                "name": fm["name"],
                "processed": processed,
                "placements": fm.get("placements", {**EMPTY_PLACEMENTS}),
                "room_detection_params": fm.get("room_detection_params", RoomDetectionParams().model_dump()),
            }
            if fm.get("scale_pixels_per_ft") is not None:
                floor_obj["scale_pixels_per_ft"] = fm["scale_pixels_per_ft"]
            floors.append(floor_obj)

        projects[project_id] = {
            "id": project_id,
            "filename": meta["filename"],
            "upload_path": upload_path or "",
            "floors": floors,
            "config": meta.get("config", PlacementConfig().model_dump()),
        }

    return JSONResponse({
        "project_id": project_id,
        "filename": meta["filename"],
        "num_floors": len(floors),
        "floors": [_serialize_floor(f) for f in floors],
        "config": projects[project_id]["config"],
    })


# ── Serve frontend SPA (must be LAST so API routes take priority) ────────────

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="frontend_assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """SPA catch-all: serve index.html for any non-API, non-static route."""
        from fastapi.responses import FileResponse
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
