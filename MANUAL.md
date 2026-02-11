# App Manual

Welcome! This app lets you create and edit tile-based designs. You can work with **files** (full tile canvases), manage **tile sets** (collections of tile graphics), and use a variety of **brushes and tools** to paint and edit. This manual walks you through every view and tool.

---

## Views

### File view

The **File** view is your home screen. It shows all your saved designs as a grid of cards.

- **Tap a card** to open that design in the Modify view and start editing.
- **Long press a card** to open the file options menu: Download, Download SVG (web), Duplicate, or Delete.
- **New File (＋)** creates a new design. You’ll choose a tile size (25–200 px) and then go straight into editing.
- **Select Mode** lets you select multiple files so you can delete them in one go. Use the bar at the top to Delete, see the count, or Exit select mode.
- **Settings (gear)** opens app settings (see [Settings](#settings) below).

The **File** title at the top is tappable and takes you to the **Tile Sets** area where you manage your tile set library.

---

### Modify view

The **Modify** view is where you edit a single design. You see a grid of cells that you paint with tiles.

- **&lt; Modify** (top left) saves your work and returns you to the File view.
- The **toolbar** at the top has: Reset, Flood, Reconcile, Mirror (see [Tools](#tools)).
- The **brush panel** at the bottom shows the tile palette and brush modes: Random, palette tiles, Clone, Erase, and Pattern.
- **Double tap** or **long press** the **Random** tile in the brush panel to open the **Tile Set chooser** and pick which tile sets appear in your palette.
- **Settings (gear)** in the header opens the Modify-view settings (including Download PNG).

---

### Tile Sets (Tile Set Creator list)

From the File view, tap **File** to open the **Tile Sets** list. Here you manage your tile set library.

- **Tap a tile set card** to open it in the Tile Set Editor.
- **Long press** (on web) opens a download option for that set.
- **Create** starts a new tile set (name + resolution 2, 3, or 4).
- **Select Mode** lets you select multiple sets and delete them.

Tap the **Tile Sets** title to go back to the File view.

---

### Tile Set Editor

Inside a tile set you see all its tiles as cards.

- **Tap a tile** to open the **Modify Tile** view and edit that tile’s graphic.
- **Add Tile** adds a new tile to the set.
- **Select Mode** lets you delete (or duplicate/download, on web) multiple tiles.
- **Settings** lets you rename the tile set.

Use the back button to return to the Tile Sets list.

---

### Modify Tile view

This is the single-tile editor. It works like the main Modify view but for one tile template.

- Same **toolbar** (Reset, Flood, Reconcile, Mirror) and **brush panel** as in the main Modify view.
- Changes are part of the tile set; when you’re done, go back to the Tile Set Editor.

---

## Tools

The in-app manual (Settings → **View manual**) shows the same icons used in the toolbar and brush panel next to each tool.

### Toolbar (Modify and Modify Tile)

- **Reset** (⟳ refresh icon) — Clears the entire grid (or the whole tile in Modify Tile). Use with care.
- **Flood** (fill icon) — **Tap:** Fills the whole grid using the current brush (random, fixed, pattern, or erase). **Long press:** “Flood Complete” — fills only *empty* cells; already placed tiles are left as-is. Helpful for filling gaps without overwriting.
- **Reconcile** (puzzle icon) — **Tap:** Fixes invalid tile connections by replacing bad tiles with compatible ones. Empty cells are never changed. **Long press:** “Controlled Randomize” — replaces tiles with connection-compatible alternatives (same “shape,” different look).
- **Mirror** (single cycling button) — **Tap** to cycle: no mirroring → horizontal → horizontal + vertical → vertical → no mirroring. When any mirroring is on, the icon is blue (same as the guide lines) and guide lines show the mirror axes. Icons: grey horizontal flip when off; horizontal flip (green) for horizontal only; arrow-all for both axes; vertical flip for vertical only.

---

### Brush panel

The strip at the bottom is your **brush panel**: tile palette + special brushes. The in-app manual shows the icon for each.

- **Random** (dice icon) — Places a random compatible tile each time. **Tap** to place one; **double tap** or **long press** to open the Tile Set chooser.
- **Palette tiles** — Each small tile is a fixed brush. **Tap** to select it, then **tap on the grid** to place it. **Double tap** a palette tile to cycle rotation and mirror. **Long press** a palette tile to add or remove it from **Favorites** (with a color tag); favorites appear at the front of the palette.
- **Clone** (copy icon) — **Tap** a cell to set the source; then **tap or drag** elsewhere to paint a copy. Clone “wraps” around the grid. **Long press on the grid** to set a new clone source at that cell.
- **Erase** (eraser icon) — **Tap** a cell to clear it. **Flood** with Erase selected clears the whole grid.
- **Pattern** (grid icon) — Uses a saved pattern. **Long press** or **double tap** the Pattern button to open the **pattern picker**: create new patterns, select one, or enter select mode. When creating a pattern, drag on the grid to define the shape, then save it in a category. Pattern can use mirror and 90° rotation options in the picker.

---

### Pattern creation

- Enter pattern mode and **drag** on the grid to select a region. Top and bottom overlays guide you.
- **Save** stores the pattern in the chosen category; **Cancel** exits without saving.
- Saved patterns appear in the pattern picker and can be applied with the Pattern brush.

---

### Tile Set chooser

- Opened by **double tap** or **long press** on the **Random** brush in the brush panel.
- Shows built-in categories and your **user tile sets**. Select one or more (multi-select) to define the active palette. Selected items are highlighted with a green border.
- Confirm your selection to update the palette used in the current file.

---

## Settings

Opened from the **Settings (gear)** button — in **File** view or in **Modify** view.

- **View manual** — Opens this manual (first option in the list).
- **Allow Border Connections** — When on, tiles at the grid edge can use connections as if they had neighbors. When off, edges behave as “empty” and connections don’t extend past the grid.
- **Show Debug** — Shows a debug overlay on the grid (connection info, etc.). Useful for troubleshooting.
- **Download PNG** — (Modify view only.) Downloads the current canvas as a PNG image.
- **Background Color** — Color of the grid background.
- **Background Line Color** — Color of the grid lines.
- **Line Width** — Thickness of the grid lines.
- **Delete all local data** — Permanently deletes all saved files, tile sets, patterns, and favorites, and resets all settings to their defaults. You’ll get a confirmation before anything is removed.

Settings are saved automatically and apply across the app.

---

## Tips

- Your work is **auto-saved** while you edit. Leaving the Modify view saves in the background.
- **Favorites** keep your most-used tiles at the front of the palette.
- Use **Reconcile** after big changes if you see “error” or broken connections.
- Use **Flood Complete** (long press Flood) to fill only empty cells without touching existing tiles.
- On **web**, you can download a file as PNG or SVG from the file options (long press) or from Modify-view Settings.

Enjoy creating!
