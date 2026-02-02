# App State Overview

This document captures the current structure, views, controls, and behaviors in the app so we can verify understanding and update high‑level instructions later.

## Views

### File View (root)
- **Header (fixed, non-scrolling)**  
  - **Title:** `File` (left-aligned).  
  - **Actions (right-aligned):**
    - **+**: Opens the New File modal (tile size picker).  
    - **Gear**: Opens the Settings modal (global settings).
- **File Grid (scrolling)**  
  - Displays saved tile canvas files as thumbnails.  
  - Thumbnails maintain the canvas aspect ratio based on the file’s grid rows/columns.  
  - Tapping a thumbnail opens that file in Modify view.  
  - Long-pressing a thumbnail opens the File Options modal (Duplicate/Delete/Download).
- **Background:** dark gray, matching the Modify view.

### Modify View
- **Header / Toolbar Row (fixed)**  
  - **Left:** `< Modify` button returns to File view (and persists the current file first).  
  - **Right:** Tool actions (icon buttons):
    - **Tile Set** (grid icon): opens Tile Set chooser overlay.
    - **Reset** (refresh icon): clears all tiles on the canvas.
    - **Flood Complete** (fill icon): fills empty tiles based on current brush (random or fixed), respecting mirrors.
    - **Mirror Horizontal** (flip-horizontal icon): toggles horizontal mirroring.
    - **Mirror Vertical** (flip-vertical icon): toggles vertical mirroring.
- **Tile Canvas**  
  - Displays the tile grid for the active file.  
  - Grid layout uses square tiles and a 0px gap.  
  - Rows/columns are computed to fit the available canvas area given the file's tile size, then stored with the file.  
  - When loading a file, the stored rows/columns and tile size define the grid; tiles are normalized to that cell count.  
  - Supports touch/drag painting and mouse painting.  
  - Shows optional mirror guide lines when mirror toggles are enabled.  
  - Shows clone overlays when Clone tool is active (blue and red outlines).
- **Tile Palette (bottom)**  
  - Two-row grid of tile buttons sized to fill the palette height.  
  - Long-press a tile to rotate it (90° steps).  
  - Double-tap a tile to mirror it horizontally.  
  - Selecting a tile makes it the “fixed” brush with that rotation/mirror.

## Modals and Overlays

### Tile Set Chooser (Modify view)
- List of tile categories.
- Selecting a category updates the active file’s tile set (file-level).
- The selected tile set is stored with the file.

### Settings (File view)
- **Aspect Ratio:** iPhone 15, iPad Pro, or Web.  
  - Only impacts web layout framing.  
- **AllowEdgeConections:** toggle (On/Off).  
  - When Off, edges behave as if surrounded by empty tiles (no connections).  
- **Show Debug:** toggle.  
  - Displays the debug overlay for tile connection visualization.
- Settings are persisted locally across app launches.

### New File Modal (from File view “+”)
- A 2×3 grid of tile size buttons: **25, 50, 75, 100, 150, 200**.  
- Tapping a size creates a new file, closes the modal, and opens Modify view.  
- Tile size is locked to the file once created.

### File Options Modal (long-press a thumbnail)
- **Duplicate:** creates a copy and makes it active.  
- **Delete:** removes the file; if it was the last file, the list becomes empty.  
- **Download:** exports a baked PNG of the canvas.

### Download Overlay (iOS)
- Full-screen transparent black overlay with a preview of the canvas.
- Action bar with **Download** and **Cancel**.
- Download uses a baked PNG captured from a hidden render surface.

## Tools / Brush Modes

### Random (default)
- Single-tap paints a compatible random tile.
- Flood Complete fills empty tiles randomly, respecting mirror settings.

### Fixed (tile palette selection)
- Places the selected tile with its chosen rotation/mirror.
- Flood Complete fills empty tiles with that fixed tile, respecting mirrors.

### Erase
- Tap removes a tile (sets it to blank).

### Clone
- **Activation:** first tap after switching to Clone sets the clone source.  
  - Clone source highlight: **blue outline**.  
  - Clone sample (current source used) highlight: **blue outline at 30% opacity**.  
  - Clone target origin highlight: **red outline**.  
  - Clone cursor highlight: **red outline at 30% opacity**.  
- **Long-press (while in Clone):** changes the clone source without leaving the tool.  
- Clone wraps around the grid horizontally and vertically.

## Persistence and Data Rules

- **Files are auto-saved** on every action. There is no manual save.  
- **Each file stores its own:**
  - tile grid contents
  - grid size (rows/columns)
  - tile set category
  - tile size (locked once created)
  - thumbnail (baked PNG)
- **Tile set is file-level only** (no global tile set setting).  
- **Settings are global** and persisted across app launches (aspect ratio, edge connections, debug, mirror toggles).  
- Thumbnails are baked PNGs, not live renders.

## Navigation Summary

- App opens in **File** view by default.  
- `File` view → tap a thumbnail → `Modify` view.  
- `Modify` view → `< Modify` → `File` view.  
- `+` in File header opens New File modal.  
- Gear in File header opens Settings modal.
