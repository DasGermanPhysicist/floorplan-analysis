import cv2
import numpy as np
from pathlib import Path
from typing import Dict, List, Any, Tuple
from scipy import ndimage


class FloorplanProcessor:
    """Processes a floorplan image to detect walls, rooms, and open areas."""

    # Default room detection parameters
    DEFAULT_ROOM_PARAMS = {
        "sensitivity": 8,          # Adaptive threshold C value (higher = more features detected)
        "min_room_area_pct": 0.002, # Min room area as % of image — lowered to catch small rooms
        "max_room_area_pct": 8.0,   # Max room area as % of image
        "min_dilation": 4,          # Smallest dilation kernel (px) — lower catches smaller rooms
        "max_dilation": 18,         # Largest dilation kernel (px) — higher bridges wider doors
        "num_scales": 5,            # Number of dilation scales between min and max
        "solidity_threshold": 0.20, # Min solidity (contour area / bbox area) to accept a room
        "max_aspect_ratio": 15.0,   # Max bbox aspect ratio — higher to allow corridors
    }

    def __init__(self, file_path: str, project_id: str, output_dir: str,
                 room_detection_params: dict = None, page_number: int = 1):
        self.file_path = file_path
        self.project_id = project_id
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.room_params = {**self.DEFAULT_ROOM_PARAMS, **(room_detection_params or {})}
        self.page_number = page_number

    @staticmethod
    def count_pages(file_path: str) -> int:
        """Return the number of pages in a PDF (1 for image files)."""
        ext = Path(file_path).suffix.lower()
        if ext != ".pdf":
            return 1
        try:
            from pdf2image import pdfinfo_from_path
            info = pdfinfo_from_path(file_path)
            return info.get("Pages", 1)
        except Exception:
            return 1

    def process(self) -> Dict[str, Any]:
        """Main processing pipeline."""
        img = self._load_image()
        if img is None:
            raise ValueError(f"Could not load image from {self.file_path}")

        height, width = img.shape[:2]

        # Save the original image as PNG for the frontend
        image_filename = f"{self.project_id}_original.png"
        image_path = self.output_dir / image_filename
        cv2.imwrite(str(image_path), img)

        # Step 1: Detect the building footprint and mask out title block / margins
        building_mask = self._detect_building_footprint(img)

        # Step 2: Detect structural walls (thick lines only)
        walls_mask, wall_segments = self._detect_walls(img, building_mask)
        walls_filename = f"{self.project_id}_walls.png"
        walls_vis = self._visualize_walls(img, walls_mask, wall_segments)
        cv2.imwrite(str(self.output_dir / walls_filename), walls_vis)

        # Step 3: Detect rooms using watershed segmentation
        rooms, rooms_mask = self._detect_rooms(img, walls_mask, building_mask)
        rooms_filename = f"{self.project_id}_rooms.png"
        rooms_vis = self._visualize_rooms(img, rooms, rooms_mask)
        cv2.imwrite(str(self.output_dir / rooms_filename), rooms_vis)

        # Serialize wall segments
        walls_serialized = []
        for seg in wall_segments:
            walls_serialized.append({
                "x1": int(seg[0][0]), "y1": int(seg[0][1]),
                "x2": int(seg[1][0]), "y2": int(seg[1][1]),
            })

        # Serialize rooms
        rooms_serialized = []
        for i, room in enumerate(rooms):
            rooms_serialized.append({
                "id": f"room_{i}",
                "centroid_x": float(room["centroid"][0]),
                "centroid_y": float(room["centroid"][1]),
                "area_pixels": float(room["area"]),
                "bbox": {
                    "x": int(room["bbox"][0]),
                    "y": int(room["bbox"][1]),
                    "w": int(room["bbox"][2]),
                    "h": int(room["bbox"][3]),
                },
                "contour": [[int(pt[0]), int(pt[1])] for pt in room["contour_simplified"]],
            })

        # Save building mask for placement engine
        np.save(str(self.output_dir / f"{self.project_id}_building_mask.npy"), building_mask)

        return {
            "image_url": f"/processed/{image_filename}",
            "walls_image_url": f"/processed/{walls_filename}",
            "rooms_image_url": f"/processed/{rooms_filename}",
            "width": width,
            "height": height,
            "num_rooms": len(rooms),
            "walls": walls_serialized,
            "rooms": rooms_serialized,
            "walls_mask_path": str(self.output_dir / f"{self.project_id}_walls_mask.npy"),
            "rooms_mask_path": str(self.output_dir / f"{self.project_id}_rooms_mask.npy"),
            "building_mask_path": str(self.output_dir / f"{self.project_id}_building_mask.npy"),
        }

    def _load_image(self) -> np.ndarray:
        """Load the floorplan from file. Convert PDF to image if needed."""
        ext = Path(self.file_path).suffix.lower()

        if ext == ".pdf":
            return self._load_pdf()
        else:
            return cv2.imread(self.file_path)

    def _load_pdf(self) -> np.ndarray:
        """Convert a PDF to an image using pdf2image."""
        try:
            from pdf2image import convert_from_path
            images = convert_from_path(self.file_path, dpi=150, first_page=self.page_number, last_page=self.page_number)
            if not images:
                raise ValueError("No pages found in PDF")
            pil_img = images[0]
            img_array = np.array(pil_img)
            return cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
        except ImportError:
            raise ValueError(
                "pdf2image is not installed. Install poppler and pdf2image to process PDFs."
            )

    def _detect_building_footprint(self, img: np.ndarray) -> np.ndarray:
        """Detect the overall building outline to mask out title blocks and margins.

        Strategy:
        1. Threshold all content and close gaps to form a building blob.
        2. Detect title block / annotation strip on the right or bottom edge
           using column-wise content density analysis.
        3. Cut away the title block region from the mask.
        """
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape

        # Threshold: anything non-white is "content"
        _, content = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

        # Heavy morphological closing to merge nearby content
        close_size = max(w, h) // 40
        kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_size, close_size))
        content_closed = cv2.morphologyEx(content, cv2.MORPH_CLOSE, kernel_close)

        # Find the largest content blob
        contours, _ = cv2.findContours(content_closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return np.ones((h, w), dtype=np.uint8) * 255

        areas = [(cv2.contourArea(c), c) for c in contours]
        areas.sort(key=lambda x: x[0], reverse=True)

        building_mask = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(building_mask, [areas[0][1]], -1, 255, -1)

        # Fill holes
        flood_mask = np.zeros((h + 2, w + 2), np.uint8)
        inv = cv2.bitwise_not(building_mask)
        cv2.floodFill(inv, flood_mask, (0, 0), 0)
        building_mask = cv2.bitwise_or(building_mask, inv)

        # --- Detect and remove title block strip ---
        # Title blocks are typically narrow strips on the right or bottom edge.
        # Detect by checking if the rightmost ~15% of the mask has content
        # that is separated from the main building by a vertical gap.
        building_mask = self._remove_title_block(building_mask, content)

        return building_mask

    def _remove_title_block(self, building_mask: np.ndarray,
                            content: np.ndarray) -> np.ndarray:
        """Remove title block / annotation strip from building mask.

        Detects the title block border — a nearly full-height vertical line
        in the right portion of the image — and cuts everything to its right.
        """
        h, w = building_mask.shape

        # Compute per-column content density across the right 30% of image
        scan_start = int(w * 0.70)
        col_density = np.array([
            np.count_nonzero(content[:, x]) / h for x in range(w)
        ])

        # The title block border is a vertical line with very high density
        # (> 0.5 of the image height). Find it in the right portion.
        # Scan from right to left: find the rightmost high-density spike
        # that has low density on both sides.
        best_cut = w
        for x in range(w - 5, scan_start, -1):
            if col_density[x] > 0.5:
                # Check that the region to the left is mostly empty (< 0.05)
                left_region = col_density[max(scan_start, x - 50):x - 3]
                if len(left_region) > 0 and np.mean(left_region) < 0.05:
                    best_cut = x - 3  # cut just before the border line
                    break

        if best_cut < w:
            building_mask[:, best_cut:] = 0

        return building_mask

    def _detect_walls(self, img: np.ndarray, building_mask: np.ndarray) -> Tuple[np.ndarray, List]:
        """Detect structural walls by isolating thick dark lines."""
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        height, width = gray.shape

        # Step 1: Binary threshold — walls are dark lines on white background
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)
        _, binary = cv2.threshold(blurred, 200, 255, cv2.THRESH_BINARY_INV)

        # Mask to building footprint only
        binary = cv2.bitwise_and(binary, building_mask)

        # Step 2: Remove thin features (text, annotations, furniture symbols)
        # by opening with a small kernel — this removes anything thinner than
        # the kernel size, keeping only thick wall lines.
        wall_thickness = max(3, max(width, height) // 800)  # ~8px for 6600px image
        kernel_open = np.ones((wall_thickness, wall_thickness), np.uint8)
        walls_thick = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_open)

        # Step 3: Extract horizontal and vertical wall segments separately
        # to strengthen axis-aligned walls
        h_len = max(20, width // 100)
        v_len = max(20, height // 100)
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1))
        kernel_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_len))

        horiz = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_h)
        vert = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_v)

        # Combine thick features + strong horizontal/vertical lines
        walls_mask = cv2.bitwise_or(walls_thick, cv2.bitwise_or(horiz, vert))

        # Step 4: Close small gaps in wall lines
        gap_close = max(3, max(width, height) // 500)
        kernel_close = np.ones((gap_close, gap_close), np.uint8)
        walls_mask = cv2.morphologyEx(walls_mask, cv2.MORPH_CLOSE, kernel_close)

        # Mask again to building footprint
        walls_mask = cv2.bitwise_and(walls_mask, building_mask)

        # Detect line segments for visualization
        min_line_length = max(width, height) * 0.015
        lines = cv2.HoughLinesP(
            walls_mask, rho=1, theta=np.pi / 180,
            threshold=40, minLineLength=min_line_length, maxLineGap=15
        )

        wall_segments = []
        if lines is not None:
            for line in lines:
                x1, y1, x2, y2 = line[0]
                wall_segments.append(((x1, y1), (x2, y2)))

        # Save mask
        np.save(str(self.output_dir / f"{self.project_id}_walls_mask.npy"), walls_mask)

        return walls_mask, wall_segments

    def _detect_rooms(self, img: np.ndarray, walls_mask: np.ndarray,
                      building_mask: np.ndarray) -> Tuple[List[Dict], np.ndarray]:
        """Detect rooms using multi-scale adaptive threshold + connected components.

        Uses adaptive thresholding (catches thin partition walls that fixed
        thresholds miss) at multiple dilation scales to find rooms of all sizes.
        Small dilation catches small rooms; larger dilation catches rooms with
        wide doors. Results are merged by centroid proximity.

        Improvements over the basic approach:
        - Watershed separation splits merged room blobs into individual rooms
        - Corridor-aware detection with relaxed aspect ratio
        - Scale-aware dedup radius
        - Fixed-threshold pass to catch rooms with very thin walls
        """
        height, width = walls_mask.shape
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (3, 3), 0)

        dim = max(width, height)
        rp = self.room_params
        min_room_area = (width * height) * (rp["min_room_area_pct"] / 100.0)
        max_room_area = (width * height) * (rp["max_room_area_pct"] / 100.0)
        min_room_dim = max(10, dim // 600)

        # Scale-aware dedup radius — larger images need larger dedup
        dedup_radius = max(20, dim // 200)

        # ── Pass 1: Adaptive threshold (catches thin partition walls) ──
        sensitivity_c = max(1, int(rp["sensitivity"]))
        all_dark_adaptive = cv2.adaptiveThreshold(
            blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV, 25, sensitivity_c
        )
        all_dark_adaptive = cv2.bitwise_and(all_dark_adaptive, building_mask)

        # ── Pass 2: Fixed threshold (catches walls that adaptive misses) ──
        _, all_dark_fixed = cv2.threshold(blurred, 200, 255, cv2.THRESH_BINARY_INV)
        all_dark_fixed = cv2.bitwise_and(all_dark_fixed, building_mask)

        threshold_maps = [all_dark_adaptive, all_dark_fixed]

        # Multi-scale dilation sizes
        n = max(1, int(rp["num_scales"]))
        d_min = max(2, int(rp["min_dilation"]))
        d_max = max(d_min, int(rp["max_dilation"]))
        if n == 1:
            dilation_sizes = [d_min]
        else:
            dilation_sizes = [round(d_min + i * (d_max - d_min) / (n - 1)) for i in range(n)]

        found_centroids = []  # (cx, cy) for dedup
        rooms = []
        rooms_mask = np.zeros((height, width), dtype=np.uint8)

        for dark_map in threshold_maps:
            for dil_px in dilation_sizes:
                kernel_dil = np.ones((dil_px, dil_px), np.uint8)
                dark_dilated = cv2.dilate(dark_map, kernel_dil, iterations=1)

                interior = cv2.bitwise_and(building_mask, cv2.bitwise_not(dark_dilated))

                num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
                    interior, connectivity=4
                )

                for lbl in range(1, num_labels):
                    area = stats[lbl, cv2.CC_STAT_AREA]
                    if area < min_room_area or area > max_room_area:
                        continue

                    cx, cy = centroids[lbl]

                    # Check if this is a large blob that might be merged rooms
                    # If area > 4x the expected average room, try watershed split
                    avg_room_area = (width * height) * 0.002  # rough heuristic
                    room_pixels = (labels == lbl).astype(np.uint8) * 255

                    if area > avg_room_area * 4:
                        sub_rooms = self._watershed_split(room_pixels, min_room_area,
                                                          min_room_dim, dedup_radius,
                                                          found_centroids, rp)
                        for sr in sub_rooms:
                            rooms.append(sr)
                            cv2.drawContours(rooms_mask, [sr["contour"]], -1, 255, -1)
                            found_centroids.append(sr["centroid"])
                        if sub_rooms:
                            continue  # successfully split, skip whole-blob processing

                    # Skip if we already found a room near this centroid
                    is_dup = self._is_duplicate(cx, cy, found_centroids, dedup_radius)
                    if is_dup:
                        continue

                    room = self._extract_room(room_pixels, min_room_area, min_room_dim, rp)
                    if room is not None:
                        rooms.append(room)
                        cv2.drawContours(rooms_mask, [room["contour"]], -1, 255, -1)
                        found_centroids.append(room["centroid"])

        # Save masks
        np.save(str(self.output_dir / f"{self.project_id}_rooms_mask.npy"), rooms_mask)

        return rooms, rooms_mask

    def _is_duplicate(self, cx: float, cy: float, found_centroids: list,
                      dedup_radius: float) -> bool:
        """Check if a centroid is too close to an already-found room."""
        for (rx, ry) in found_centroids:
            if abs(cx - rx) < dedup_radius and abs(cy - ry) < dedup_radius:
                return True
        return False

    def _extract_room(self, room_pixels: np.ndarray, min_room_area: float,
                      min_room_dim: int, rp: dict) -> dict:
        """Extract a single room from a binary mask. Returns None if rejected."""
        contours, _ = cv2.findContours(room_pixels, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        contour = max(contours, key=cv2.contourArea)
        c_area = cv2.contourArea(contour)
        if c_area < min_room_area:
            return None

        bbox_r = cv2.boundingRect(contour)
        bw, bh = bbox_r[2], bbox_r[3]
        if bw < min_room_dim or bh < min_room_dim:
            return None
        bbox_area = bw * bh
        solidity = c_area / bbox_area if bbox_area > 0 else 0
        if solidity < rp["solidity_threshold"]:
            return None
        aspect = max(bw, bh) / (min(bw, bh) + 1)
        if aspect > rp["max_aspect_ratio"]:
            return None

        M = cv2.moments(contour)
        if M["m00"] == 0:
            return None

        mcx = M["m10"] / M["m00"]
        mcy = M["m01"] / M["m00"]

        epsilon = 0.015 * cv2.arcLength(contour, True)
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        simplified_pts = simplified.reshape(-1, 2).tolist()

        return {
            "centroid": (mcx, mcy),
            "area": c_area,
            "bbox": bbox_r,
            "contour": contour,
            "contour_simplified": simplified_pts,
        }

    def _watershed_split(self, blob_mask: np.ndarray, min_room_area: float,
                         min_room_dim: int, dedup_radius: float,
                         found_centroids: list, rp: dict) -> List[Dict]:
        """Use watershed to split a large merged blob into individual rooms.

        1. Distance transform to find room centers
        2. Local maxima become seeds
        3. Watershed segmentation splits the blob
        """
        # Distance transform — peaks are room centers
        dist = cv2.distanceTransform(blob_mask, cv2.DIST_L2, 5)
        if dist.max() == 0:
            return []

        # Adaptive threshold on distance to find peaks
        # Use a fraction of the max distance as threshold
        thresh_val = max(dist.max() * 0.3, 5.0)
        _, sure_fg = cv2.threshold(dist, thresh_val, 255, cv2.THRESH_BINARY)
        sure_fg = sure_fg.astype(np.uint8)

        # Find connected components of sure foreground — these are seeds
        num_seeds, seed_labels = cv2.connectedComponents(sure_fg)

        if num_seeds <= 2:
            # Not enough seeds to split — return empty (will fall through to
            # whole-blob processing)
            return []

        # Watershed markers: 1-based labels for seeds, 0 for unknown
        markers = seed_labels.copy().astype(np.int32)
        # Mark background (outside blob) as 1 so watershed doesn't flood it
        markers[blob_mask == 0] = 1
        # Shift seed labels to start at 2
        markers[markers > 0] = markers[markers > 0] + 1
        markers[blob_mask == 0] = 1

        # Watershed needs a 3-channel image
        blob_bgr = cv2.cvtColor(blob_mask, cv2.COLOR_GRAY2BGR)
        cv2.watershed(blob_bgr, markers)

        rooms = []
        for lbl in range(2, num_seeds + 1):
            lbl_shifted = lbl + 1
            seg_mask = (markers == lbl_shifted).astype(np.uint8) * 255

            # Check area
            seg_area = cv2.countNonZero(seg_mask)
            if seg_area < min_room_area:
                continue

            # Check for duplicate centroids
            M = cv2.moments(seg_mask)
            if M["m00"] == 0:
                continue
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

            if self._is_duplicate(cx, cy, found_centroids, dedup_radius):
                continue
            # Also check against rooms we're about to add in this batch
            if self._is_duplicate(cx, cy, [r["centroid"] for r in rooms], dedup_radius):
                continue

            room = self._extract_room(seg_mask, min_room_area, min_room_dim, rp)
            if room is not None:
                rooms.append(room)

        return rooms

    def _visualize_walls(self, img: np.ndarray, walls_mask: np.ndarray,
                         wall_segments: List) -> np.ndarray:
        """Create a visualization of detected walls overlaid on the original image."""
        vis = img.copy()
        overlay = vis.copy()
        overlay[walls_mask > 0] = [0, 0, 200]
        vis = cv2.addWeighted(overlay, 0.5, vis, 0.5, 0)
        return vis

    def _visualize_rooms(self, img: np.ndarray, rooms: List[Dict],
                         rooms_mask: np.ndarray) -> np.ndarray:
        """Create a visualization of detected rooms with color coding."""
        vis = img.copy()

        np.random.seed(42)
        colors = []
        for _ in range(max(len(rooms), 1)):
            colors.append((
                int(np.random.randint(80, 220)),
                int(np.random.randint(80, 220)),
                int(np.random.randint(80, 220)),
            ))

        for i, room in enumerate(rooms):
            color = colors[i % len(colors)]
            overlay = vis.copy()
            cv2.drawContours(overlay, [room["contour"]], -1, color, -1)
            vis = cv2.addWeighted(overlay, 0.3, vis, 0.7, 0)
            cv2.drawContours(vis, [room["contour"]], -1, color, 2)

            cx, cy = int(room["centroid"][0]), int(room["centroid"][1])
            cv2.circle(vis, (cx, cy), 6, (255, 255, 255), -1)
            cv2.circle(vis, (cx, cy), 6, color, 2)
            cv2.putText(vis, f"R{i}", (cx + 10, cy + 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        return vis
