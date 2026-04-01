import cv2
import numpy as np
from typing import Dict, List, Any, Optional
import uuid
import math


class PlacementEngine:
    """Computes optimal placement of AirFinder 2 infrastructure.

    All placement is constrained to the building footprint. Devices are only
    placed inside detected rooms or inside the building (not on walls, not
    outside).
    """

    def __init__(self, processed_data: Dict[str, Any], config):
        self.data = processed_data
        self.config = config
        self.width = processed_data["width"]
        self.height = processed_data["height"]
        self.rooms = processed_data.get("rooms", [])
        self.walls = processed_data.get("walls", [])
        self.scale = config.scale_pixels_per_ft  # pixels per foot

        # Load masks
        self.walls_mask = self._load_mask("walls_mask_path")
        self.rooms_mask = self._load_mask("rooms_mask_path")
        self.building_mask = self._load_mask("building_mask_path")

    def _load_mask(self, key: str) -> Optional[np.ndarray]:
        try:
            path = self.data.get(key)
            if path:
                return np.load(path)
        except Exception:
            pass
        return None

    def compute_placements(self) -> Dict[str, List[Dict]]:
        """Compute all device placements."""
        beacons = self._place_beacons()
        access_points = self._place_access_points(beacons)
        gateways = self._place_gateways(access_points)

        return {
            "beacons": beacons,
            "access_points": access_points,
            "gateways": gateways,
        }

    def _place_beacons(self) -> List[Dict]:
        """Place beacons using a two-phase approach:

        Phase 1: Place beacons_per_room in each detected room (centroid + grid fill).
        Phase 2: Fill remaining building interior (hallways, corridors, areas between
                 rooms) with a grid at beacon_spacing to ensure full building coverage.

        This matches real-world placement patterns where beacons cover every room
        AND every corridor/hallway.
        """
        beacons = []
        bpr = max(1, getattr(self.config, 'beacons_per_room', 1))
        beacon_spacing_px = self.config.beacon_spacing_ft * self.scale

        # Track which pixels are "covered" by a beacon
        covered_mask = np.zeros((self.height, self.width), dtype=np.uint8)
        cover_radius = int(beacon_spacing_px * 0.4)  # each beacon covers a disc

        def mark_covered(x, y):
            ix, iy = int(x), int(y)
            y0 = max(0, iy - cover_radius)
            y1 = min(self.height, iy + cover_radius + 1)
            x0 = max(0, ix - cover_radius)
            x1 = min(self.width, ix + cover_radius + 1)
            covered_mask[y0:y1, x0:x1] = 255

        # ── Phase 1: Room-based placement ──
        if self.rooms:
            for room in self.rooms:
                cx, cy = room["centroid_x"], room["centroid_y"]
                if not self._is_inside_building(cx, cy):
                    continue

                placed = []

                if bpr == 1:
                    placed.append((cx, cy))
                else:
                    placed.extend(self._distribute_in_room(room, bpr))

                for px, py in placed:
                    beacons.append({
                        "id": str(uuid.uuid4())[:8],
                        "x": float(px),
                        "y": float(py),
                        "room_id": room["id"],
                        "placement_method": "room_centroid" if len(placed) == 1 else "distributed",
                    })
                    mark_covered(px, py)

                # Grid fill for rooms larger than beacon spacing
                w_px = room["bbox"]["w"]
                h_px = room["bbox"]["h"]
                if w_px > beacon_spacing_px * 1.0 or h_px > beacon_spacing_px * 1.0:
                    extra = self._grid_fill_room(room, beacon_spacing_px)
                    for e in extra:
                        beacons.append(e)
                        mark_covered(e["x"], e["y"])

        # ── Phase 2: Fill uncovered room interior (hallways detected as rooms, gaps) ──
        # Only place inside detected rooms — NOT the entire building footprint.
        half = beacon_spacing_px * 0.5
        x = half
        while x < self.width - half:
            y = half
            while y < self.height - half:
                ix, iy = int(x), int(y)
                # Only place if: inside a detected room, navigable, not already covered
                if (self._is_inside_room(ix, iy) and
                    self._is_navigable(ix, iy) and
                    covered_mask[min(iy, self.height - 1), min(ix, self.width - 1)] == 0):
                    beacons.append({
                        "id": str(uuid.uuid4())[:8],
                        "x": float(x),
                        "y": float(y),
                        "placement_method": "corridor_fill",
                    })
                    mark_covered(x, y)
                y += beacon_spacing_px
            x += beacon_spacing_px

        return beacons

    def _distribute_in_room(self, room: Dict, count: int) -> List[tuple]:
        """Distribute `count` points inside a room, spread across the bbox."""
        bbox = room["bbox"]
        cx, cy = room["centroid_x"], room["centroid_y"]
        w, h = bbox["w"], bbox["h"]

        contour = np.array(room.get("contour", []), dtype=np.int32)
        has_contour = len(contour) >= 3
        if has_contour:
            pts = contour.reshape(-1, 1, 2)

        # Generate candidate positions on a sub-grid inside the room
        # and pick `count` that are most spread out
        candidates = [(cx, cy)]  # always include centroid

        # Generate a grid of candidates inside the room
        margin_x = w * 0.15
        margin_y = h * 0.15
        grid_nx = max(2, int(math.sqrt(count * 3)))
        grid_ny = max(2, int(math.sqrt(count * 3)))

        for gi in range(grid_nx):
            for gj in range(grid_ny):
                gx = bbox["x"] + margin_x + (w - 2 * margin_x) * gi / max(1, grid_nx - 1)
                gy = bbox["y"] + margin_y + (h - 2 * margin_y) * gj / max(1, grid_ny - 1)
                if has_contour:
                    if cv2.pointPolygonTest(pts, (gx, gy), False) >= 0:
                        candidates.append((gx, gy))
                else:
                    candidates.append((gx, gy))

        # Greedy farthest-point sampling to pick `count` well-spread points
        if len(candidates) <= count:
            return candidates

        selected = [candidates[0]]  # start with centroid
        remaining = candidates[1:]

        while len(selected) < count and remaining:
            best_dist = -1
            best_idx = 0
            for i, (rx, ry) in enumerate(remaining):
                min_d = min(math.hypot(rx - sx, ry - sy) for sx, sy in selected)
                if min_d > best_dist:
                    best_dist = min_d
                    best_idx = i
            selected.append(remaining.pop(best_idx))

        return selected

    def _place_access_points(self, beacons: List[Dict]) -> List[Dict]:
        """Place access points so every beacon is within AP coverage radius.

        Uses a greedy set-cover with a minimum-distance constraint between
        selected APs to prevent clustering/overlap.

        Algorithm:
        1. Build candidate AP positions on a grid (step = ap_spacing) inside rooms.
        2. Greedily pick the candidate covering the most uncovered beacons.
        3. After each pick, disable candidates within min_ap_distance of the
           chosen AP to prevent overlap.
        4. Repeat until all beacons are covered.
        5. Any remaining uncovered beacons get an AP placed directly on them.
        """
        ap_spacing_px = self.config.ap_spacing_ft * self.scale
        coverage_radius = ap_spacing_px / 2.0
        # Minimum distance between APs — prevents clustering.
        # Allow some overlap (70% of AP spacing) so coverage gaps don't appear.
        min_ap_distance = ap_spacing_px * 0.7

        if not beacons:
            return self._grid_place_inside_rooms(ap_spacing_px)

        beacon_positions = np.array([[b["x"], b["y"]] for b in beacons])

        # Generate candidate AP positions on a grid inside rooms.
        # Use ap_spacing_px as step (not coverage_radius) to keep the grid sparse.
        candidates = []
        step = ap_spacing_px * 0.5  # half-spacing grid gives good candidate density
        half = step * 0.5
        x = half
        while x < self.width - half:
            y = half
            while y < self.height - half:
                ix, iy = int(x), int(y)
                if self._is_inside_room(ix, iy) and self._is_navigable(ix, iy):
                    candidates.append((float(x), float(y)))
                y += step
            x += step

        # Also add beacon positions as candidates (guarantees coverage fallback)
        for b in beacons:
            candidates.append((float(b["x"]), float(b["y"])))

        if not candidates:
            return []

        cand_arr = np.array(candidates)
        n_cand = len(candidates)

        # Precompute distances: candidates → beacons
        dists_to_beacons = np.sqrt(
            np.sum((cand_arr[:, np.newaxis, :] - beacon_positions[np.newaxis, :, :]) ** 2, axis=2)
        )
        coverage_matrix = dists_to_beacons <= coverage_radius

        # Precompute distances: candidates → candidates (for min-distance constraint)
        # Only compute on demand to save memory for large grids

        uncovered = set(range(len(beacons)))
        selected_positions = []  # list of (x, y)
        eliminated = np.zeros(n_cand, dtype=bool)  # candidates too close to a picked AP

        # Greedy set cover with min-distance constraint
        while uncovered:
            uncov_list = list(uncovered)
            # Mask eliminated candidates
            counts = coverage_matrix[:, uncov_list].sum(axis=1).astype(float)
            counts[eliminated] = -1

            if counts.max() <= 0:
                break

            best_idx = int(np.argmax(counts))
            bx, by = candidates[best_idx]
            selected_positions.append((bx, by))

            # Mark beacons covered by this AP
            covered_by_best = set(
                b for b in uncovered if coverage_matrix[best_idx, b]
            )
            uncovered -= covered_by_best

            # Eliminate candidates too close to the chosen AP
            dists_to_chosen = np.sqrt(
                (cand_arr[:, 0] - bx) ** 2 + (cand_arr[:, 1] - by) ** 2
            )
            eliminated |= (dists_to_chosen < min_ap_distance)

        # Build AP list
        access_points = []
        for (cx, cy) in selected_positions:
            access_points.append({
                "id": str(uuid.uuid4())[:8],
                "x": cx,
                "y": cy,
                "placement_method": "beacon_coverage",
            })

        # Place APs directly at any still-uncovered beacons
        for b_idx in uncovered:
            bx, by = float(beacon_positions[b_idx, 0]), float(beacon_positions[b_idx, 1])
            # Check if an existing AP already covers this beacon (edge case)
            already_covered = any(
                math.hypot(bx - ap["x"], by - ap["y"]) <= coverage_radius
                for ap in access_points
            )
            if not already_covered:
                access_points.append({
                    "id": str(uuid.uuid4())[:8],
                    "x": bx,
                    "y": by,
                    "placement_method": "beacon_direct",
                })

        return access_points

    def _place_gateways(self, access_points: List[Dict]) -> List[Dict]:
        """Place gateways based on gateway-to-AP ratio, clustered among APs.

        Gateways are placed at k-means cluster centers of APs, snapped to
        the nearest point inside a detected room.
        """
        num_aps = len(access_points)
        num_gateways = max(1, math.ceil(num_aps * self.config.gateway_to_ap_ratio))

        if num_aps == 0:
            return []

        gateways = []

        if num_gateways == 1:
            avg_x = float(np.mean([ap["x"] for ap in access_points]))
            avg_y = float(np.mean([ap["y"] for ap in access_points]))
            avg_x, avg_y = self._snap_to_room(avg_x, avg_y)
            gateways.append({
                "id": str(uuid.uuid4())[:8],
                "x": avg_x,
                "y": avg_y,
                "placement_method": "centroid",
            })
        else:
            ap_positions = np.array([[ap["x"], ap["y"]] for ap in access_points])
            gateway_positions = self._kmeans_place(ap_positions, num_gateways)

            for pos in gateway_positions:
                gx, gy = self._snap_to_room(float(pos[0]), float(pos[1]))
                gateways.append({
                    "id": str(uuid.uuid4())[:8],
                    "x": gx,
                    "y": gy,
                    "placement_method": "clustered",
                })

        return gateways

    def _grid_fill_room(self, room: Dict, spacing_px: float) -> List[Dict]:
        """Fill a large room with extra beacons on a grid."""
        extra = []
        bbox = room["bbox"]
        x0 = bbox["x"] + spacing_px / 2
        y0 = bbox["y"] + spacing_px / 2
        x1 = bbox["x"] + bbox["w"]
        y1 = bbox["y"] + bbox["h"]

        contour = np.array(room.get("contour", []), dtype=np.int32)
        has_contour = len(contour) >= 3

        x = x0
        while x < x1:
            y = y0
            while y < y1:
                dist = math.hypot(x - room["centroid_x"], y - room["centroid_y"])
                if dist > spacing_px * 0.7:
                    inside = False
                    if has_contour:
                        pts = contour.reshape(-1, 1, 2)
                        inside = cv2.pointPolygonTest(pts, (x, y), False) >= 0
                    else:
                        inside = (bbox["x"] <= x <= x1 and bbox["y"] <= y <= y1)
                    if inside and self._is_navigable(x, y):
                        extra.append({
                            "id": str(uuid.uuid4())[:8],
                            "x": float(x),
                            "y": float(y),
                            "room_id": room["id"],
                            "placement_method": "grid_fill",
                        })
                y += spacing_px
            x += spacing_px

        return extra

    def _grid_place_inside_building(self, spacing_px: float) -> List[Dict]:
        """Place devices on a grid, only inside the building and not on walls."""
        devices = []
        half = spacing_px * 0.5

        x = half
        while x < self.width - half:
            y = half
            while y < self.height - half:
                ix, iy = int(x), int(y)
                if self._is_inside_building(ix, iy) and self._is_navigable(ix, iy):
                    devices.append({
                        "id": str(uuid.uuid4())[:8],
                        "x": float(x),
                        "y": float(y),
                        "placement_method": "grid",
                    })
                y += spacing_px
            x += spacing_px

        return devices

    def _is_inside_building(self, x: float, y: float) -> bool:
        """Check if a point is within the building footprint."""
        ix, iy = int(x), int(y)
        if ix < 0 or ix >= self.width or iy < 0 or iy >= self.height:
            return False
        if self.building_mask is not None:
            return bool(self.building_mask[
                min(iy, self.building_mask.shape[0] - 1),
                min(ix, self.building_mask.shape[1] - 1)
            ] > 0)
        return True

    def _is_navigable(self, x: float, y: float) -> bool:
        """Check if a point is navigable (inside building, not on a wall)."""
        if not self._is_inside_building(x, y):
            return False
        ix, iy = int(x), int(y)
        if self.walls_mask is not None:
            return bool(self.walls_mask[
                min(iy, self.walls_mask.shape[0] - 1),
                min(ix, self.walls_mask.shape[1] - 1)
            ] == 0)
        return True

    def _is_inside_room(self, x: float, y: float) -> bool:
        """Check if a point falls inside any detected room."""
        ix, iy = int(x), int(y)
        if ix < 0 or ix >= self.width or iy < 0 or iy >= self.height:
            return False
        if self.rooms_mask is not None:
            return bool(self.rooms_mask[
                min(iy, self.rooms_mask.shape[0] - 1),
                min(ix, self.rooms_mask.shape[1] - 1)
            ] > 0)
        # Fallback to building mask
        return self._is_inside_building(x, y)

    def _grid_place_inside_rooms(self, spacing_px: float) -> List[Dict]:
        """Place devices on a grid, only inside detected rooms (not just building)."""
        devices = []
        half = spacing_px * 0.5

        x = half
        while x < self.width - half:
            y = half
            while y < self.height - half:
                ix, iy = int(x), int(y)
                if self._is_inside_room(ix, iy) and self._is_navigable(ix, iy):
                    devices.append({
                        "id": str(uuid.uuid4())[:8],
                        "x": float(x),
                        "y": float(y),
                        "placement_method": "grid",
                    })
                y += spacing_px
            x += spacing_px

        return devices

    def _snap_to_room(self, x: float, y: float, max_search: int = 300) -> tuple:
        """Snap a point to the nearest location inside a detected room."""
        if self._is_inside_room(x, y) and self._is_navigable(x, y):
            return x, y
        for r in range(1, max_search):
            for dx in range(-r, r + 1):
                for dy in [-r, r]:
                    nx, ny = x + dx, y + dy
                    if self._is_inside_room(nx, ny) and self._is_navigable(nx, ny):
                        return float(nx), float(ny)
            for dy in range(-r + 1, r):
                for dx in [-r, r]:
                    nx, ny = x + dx, y + dy
                    if self._is_inside_room(nx, ny) and self._is_navigable(nx, ny):
                        return float(nx), float(ny)
        return x, y

    def _snap_to_navigable(self, x: float, y: float, max_search: int = 200) -> tuple:
        """If (x,y) is not navigable, find the nearest navigable point."""
        if self._is_navigable(x, y):
            return x, y
        # Spiral outward
        for r in range(1, max_search):
            for dx in range(-r, r + 1):
                for dy in [-r, r]:
                    nx, ny = x + dx, y + dy
                    if self._is_navigable(nx, ny):
                        return float(nx), float(ny)
            for dy in range(-r + 1, r):
                for dx in [-r, r]:
                    nx, ny = x + dx, y + dy
                    if self._is_navigable(nx, ny):
                        return float(nx), float(ny)
        return x, y

    def _kmeans_place(self, positions: np.ndarray, k: int) -> np.ndarray:
        """Simple k-means to find k cluster centers from positions."""
        if len(positions) <= k:
            return positions

        indices = np.linspace(0, len(positions) - 1, k, dtype=int)
        centers = positions[indices].copy().astype(float)

        for _ in range(50):
            distances = np.zeros((len(positions), k))
            for i, center in enumerate(centers):
                distances[:, i] = np.sqrt(np.sum((positions - center) ** 2, axis=1))

            assignments = np.argmin(distances, axis=1)

            new_centers = np.zeros_like(centers)
            for i in range(k):
                mask = assignments == i
                if np.any(mask):
                    new_centers[i] = positions[mask].mean(axis=0)
                else:
                    new_centers[i] = centers[i]

            if np.allclose(centers, new_centers, atol=1.0):
                break
            centers = new_centers

        return centers
