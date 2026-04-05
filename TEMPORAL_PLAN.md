# Temporal Scan Comparison — Implementation Plan

## Context

We need to compare point cloud scans of the same structure taken at different times to detect deformation, settlement, and movement at mm precision. This is a new page (`temporal.html`) separate from the main viewer, sharing Potree libs and theme.

Scan data is not yet available — we'll use placeholder paths and swap in real folders later.

---

## Files to Create

```
site/clients/Dev/temporal/
├── temporal.html          # Main page (inline IIFE, same pattern as viewer.html)
├── temporal-projects.js   # Scan group registry (placeholder entries)
├── heatmap-worker.js      # Web Worker: k-d tree + distance computation
└── temporal.css           # Styles (theme vars from custom.css + new heat map UI)
```

---

## Phase 1: Scaffold + Multi-Scan Loading

**Goal**: Open the page, see two point clouds loaded with a sidebar to control them.

1. **temporal.html** — Potree viewer shell (copy structure from viewer.html):
   - Include Potree + THREE + jQuery from `../../libs/potree/`
   - IIFE with Potree init, right-click pan fix, GUI cleanup (same as main viewer)
   - Simplified sidebar: no marks, no members — just Potree panels + our custom panels
   - Enable theme (green accent, dark sidebar, logo)
   - Version footer

2. **temporal-projects.js** — Registry format:
   ```js
   window.TEMPORAL_PROJECTS = {
     "demo": {
       name: "Demo Comparison",
       scans: [
         { id: "scan1", name: "Baseline",  date: "2025-01-15", folder: "../path/to/scan1" },
         { id: "scan2", name: "Follow-up", date: "2025-06-20", folder: "../path/to/scan2" }
       ]
     }
   };
   ```
   URL pattern: `temporal.html?p=demo`

3. **Scan Loading Panel** (sidebar section):
   - Lists each scan with: name, date, color swatch, visibility eye toggle
   - Radio buttons to select Scan A (baseline) and Scan B (comparison)
   - Status indicator per scan (loading / loaded / N points)

4. **Point cloud loading**:
   - Loop `project.scans`, call `Potree.loadPointCloud()` for each
   - Store references in `scans[]` array: `{ id, name, date, pointCloud, loaded: false }`
   - Each scan gets a distinct default tint so you can tell them apart before heat map

**Deliverable**: Page loads, two clouds visible, sidebar shows scan list with toggles.

---

## Phase 2: Heat Map Computation (Web Worker)

**Goal**: Click "Compute", see progress bar, get distance values back.

5. **Force-load utility**:
   ```js
   async function forceLoadAllNodes(pointCloud) {
     // Recursively call .load() on all geometry nodes
     // Poll until Potree.numNodesLoading === 0
     // Temporarily raise point budget to prevent culling
   }
   ```

6. **Position extraction**:
   ```js
   function extractPositions(pointCloud) {
     // Traverse pcoGeometry.root recursively
     // For each loaded node with geometry:
     //   Get attributes.position.array (Float32Array)
     //   Apply pointCloud.matrixWorld to transform to absolute coords
     // Return { positions: Float32Array (x,y,z,x,y,z,...), count: N }
     // Also return nodeMap: array of { nodeRef, startIndex, count }
     //   (needed later to map distances back to the right geometry nodes)
   }
   ```

7. **heatmap-worker.js** — Self-contained, no imports:

   **K-d tree** (~100 lines):
   - Build from Float32Array of Scan A positions
   - Support 1-NN query (point-to-point mode)
   - Support K-NN query (point-to-surface mode)

   **Distance computation**:
   - Point-to-point: `dist = euclidean(pointB, nearestA)`
   - Point-to-surface: find K neighbors → fit local plane (covariance eigenvector, same math as our best-fit plane) → `dist = |dot(pointB - centroid, normal)|`

   **Message protocol**:

   | Direction | Message | Payload |
   |-----------|---------|---------|
   | Main → Worker | `compute` | `scanA.positions`, `scanB.positions`, `settings{mode, k, maxDistance, subsample}` — ArrayBuffers transferred |
   | Main → Worker | `cancel` | (none) |
   | Worker → Main | `progress` | `{percent, phase: 'building-tree'\|'computing'}` — every ~2% |
   | Worker → Main | `complete` | `distances: Float32Array` — transferred back |
   | Worker → Main | `error` | `{message}` |

   **Subsample**: When `subsample > 1`, compute every Nth point, set others to -1. Fast preview.

8. **Orchestration** (main thread):
   ```js
   async function computeHeatMap() {
     showProgress("Loading all points...");
     await forceLoadAllNodes(scanA.pointCloud);
     await forceLoadAllNodes(scanB.pointCloud);

     showProgress("Extracting positions...");
     const dataA = extractPositions(scanA.pointCloud);
     const dataB = extractPositions(scanB.pointCloud);

     showProgress("Computing distances...");
     worker.postMessage({ type:'compute', scanA: dataA, scanB: dataB, settings },
       [dataA.positions.buffer, dataB.positions.buffer]);  // transfer

     // Worker progress updates → update progress bar
     // Worker complete → applyHeatMapColors(distances, dataB.nodeMap)
   }
   ```

9. **Progress bar UI**: Bar in sidebar heat map panel. Cancel button. Phase label.

**Deliverable**: Compute runs in background, progress bar fills, distances array returned.

---

## Phase 3: Color Mapping + Visualization

**Goal**: Point cloud turns into a heat map. User can adjust range and filter.

10. **Color ramp function**:
    ```
    0.00 → Blue    (0,0,255)      — no change
    0.25 → Cyan    (0,255,255)
    0.50 → Green   (0,255,0)
    0.75 → Yellow  (255,255,0)
    1.00 → Red     (255,0,0)      — max change
    Beyond max → Gray (128,128,128) — no match
    ```

11. **Apply colors to geometry**:
    - Cache the full `distances` Float32Array on the main thread
    - Using `nodeMap` from extraction, iterate each geometry node
    - For each point: `rgba = distanceToRGBA(distances[globalIndex], minRange, maxRange)`
    - Write into `geometry.attributes.rgba.array`, set `needsUpdate = true`
    - This runs on main thread but is fast (~1-2s for 10M points, or chunked with requestIdleCallback)

12. **Color legend overlay**:
    - Canvas-drawn vertical gradient bar, positioned bottom-right of viewer
    - Scale labels in mm at intervals
    - Updates when range changes

13. **Range controls** (sidebar):
    - Min / Max distance sliders (in mm)
    - Changing these re-runs color mapping on cached distances — no recompute needed
    - "Auto range" button: sets min/max to 5th/95th percentile of computed distances

14. **Threshold filter**:
    - "Show only > X mm" slider
    - Sets alpha to 0 for points below threshold (modifies rgba[3])
    - Or: set point size to 0 for filtered points

15. **Mode toggle**: Point-to-point vs Point-to-surface radio. Changing mode triggers full recompute.

**Deliverable**: Colored heat map on point cloud, adjustable range, threshold filter, legend.

---

## Phase 4: Heat Map Interaction

**Goal**: Click on the heat map to inspect values.

16. **Click-to-inspect**:
    - On click, raycast against Scan B point cloud
    - Find the intersected point's index → look up `distances[index]`
    - Show tooltip/popup near cursor: "Displacement: 3.7 mm"
    - Highlight the clicked point (larger/brighter)

17. **Info panel** (sidebar):
    - Shows last-clicked point's coordinates (Scan B position)
    - Displacement value in mm
    - Nearest point coordinates in Scan A
    - Optional: local surface normal direction

**Deliverable**: Click any point, see its displacement.

---

## Phase 5: Cross-Section + Measurements

**Goal**: Slice through both scans, measure across them.

18. **Port constraint tool** from main viewer:
    - Plane (3 points), best-fit plane (N points), axis (2 points)
    - Constraint sidebar panel with activate/eye/lock/ortho/delete
    - Definition point dragging (same mechanics)

19. **Port plane ortho view**:
    - Ortho camera aligned to plane normal
    - Depth slab clip box (adjustable behind/front)
    - Both scans visible in the slice (different colors or heat map colors)
    - "Exit Plane View" button

20. **Port measurement tool**:
    - D-number labels on measurement points
    - Segment distances (3D, XY, Z) in sidebar
    - Works across both scans — pick on A, pick on B
    - Measurement export to .txt

21. **Port clip box**: Auto-created on load, locked.

**Deliverable**: Full cross-section and measurement capability across both scans.

---

## Phase 6: Export + Polish

22. **CSV heat map export**:
    ```csv
    x,y,z,displacement_mm
    123.456,789.012,34.567,2.34
    ...
    ```
    - Only exports points within current threshold filter
    - Download as `heatmap_<projectId>_<date>.csv`

23. **Session save/load** (temporal-specific format):
    ```json
    {
      "projectId": "demo",
      "scanA": "scan1",
      "scanB": "scan2",
      "heatMapSettings": { "mode": "point-to-surface", "k": 5, "maxDistance": 50, "minRange": 0, "maxRange": 20 },
      "constraints": [...],
      "measurements": [...]
    }
    ```

24. **Keyboard shortcuts**:
    - ESC: cancel constraint/measurement pick
    - Ctrl+Z: undo (constraints + measurements only)
    - F: fit view
    - E: toggle EDL
    - +/-: point budget

25. **Polish**:
    - Loading states and error handling
    - "No data" states for empty panels
    - Tooltip help text on heat map controls

---

## Implementation Dependencies

```
Phase 1 (scaffold + loading)
  → Phase 2 (worker + computation)
    → Phase 3 (color mapping + UI)
      → Phase 4 (interaction)

Phase 1 → Phase 5 (cross-section, can parallel with 2-4)
Phase 3 → Phase 6 (export needs distances)
```

Phases 2-4 are the critical path (heat map). Phase 5 can be worked in parallel once Phase 1 is done.

---

## Open Items

- **Scan folder paths**: Placeholder until user provides the two scan folders
- **Scan point counts**: Unknown until data arrives — affects performance estimates
- **Sidebar layout**: Simplified vs full Potree accordion — decide during Phase 1
