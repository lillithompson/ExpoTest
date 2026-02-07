# App State Overview

This document is the single source of truth for reconstructing the app from scratch. It describes routes, screens, modals, UI rules, and the behavior and data flow of the tile system.

**Structure**

Main Routes
- `/` (app/index.tsx): File and Modify modes in one screen, controlled by `viewMode`.
- `/tileSetCreator` (app/tileSetCreator/index.tsx): Tile Set list and management.
- `/tileSetCreator/editor` (app/tileSetCreator/editor.tsx): Tile Set details and tile list.
- `/tileSetCreator/modifyTile` (app/tileSetCreator/modifyTile.tsx): Tile editor for a single tile template.
- `/modal` (app/modal.tsx): Example modal route, not used by core flows.

File View (viewMode = "file")
- Status bar background strip at the top (white).
- Header row: Title "File" (press navigates to Tile Set Creator), actions on the right.
- Header actions: New File (plus), Select Mode (checkbox), Settings (cog).
- Select mode bar: Animated bar with Delete button (left), selected count (center), Exit (right).
- File grid: Scrollable list of file cards, sorted by `updatedAt` descending. Cards show previews (thumbnail/preview if available, otherwise live tile grid on native; web uses placeholder).
- File card interactions: Tap opens Modify view; long press opens File Options menu.
- File Options menu: Download (web direct or native overlay), Download SVG (web only), Duplicate, Delete.
- New File modal: Tile size selection grid of [25, 50, 75, 100, 150, 200].
- Settings overlay (file view): Allow Border Connections toggle, Show Debug toggle, background color picker, background line color picker, background line width slider.

Modify View (viewMode = "modify")
- Status bar background strip at the top (white).
- Header row: Back button "< Modify" (saves then returns to File view) and toolbar actions.
- Toolbar actions: Reset, Flood (tap) / Flood Complete (long press), Reconcile (tap) / Controlled Randomize (long press), Mirror Horizontal toggle, Mirror Vertical toggle.
- Canvas frame: Grid background, optional mirror guide lines, optional preview image during hydration.
- Tile grid: Web renders TileCell components. Native renders a single Skia canvas (TileGridCanvas) for all tiles.
- Pattern creation overlays: Top and bottom overlays shown while in pattern creation mode.
- Brush panel: Scrollable two or three row tile palette plus Random, Clone, Erase, and Pattern buttons.
- Pattern chooser modal: Lists patterns for the active category with actions for create and select mode.
- Pattern save modal: Preview of the selection with Save/Cancel.
- Tile Set chooser overlay: Select built-in categories and user tile sets to define the active palette.
- Settings overlay (modify view): Allow Border Connections toggle, Download PNG action, Show Debug toggle, background color and line controls.
- Download overlay (native): ViewShot capture with background toggle and PNG/SVG actions.

Tile Set Creator List (tileSetCreator/index.tsx)
- Header row: Title "Tile Sets" (tap returns to File view), actions for Create and Select Mode.
- Select mode bar: Animated bar with Delete, selected count, Exit.
- Tile set grid: Cards with 2x2 previews (baked or live). Long press (web only) opens download modal.
- Create Tile Set modal: Name input and resolution options 2, 3, 4.
- Download Tile Set modal (web only): Downloads all tiles in the set as a ZIP of SVGs.

Tile Set Editor (tileSetCreator/editor.tsx)
- Header row: Back, tile set name, actions for Add Tile, Select Mode, and Settings.
- Select mode bar: Animated bar with Delete, selected count, Exit.
- Tile grid: Cards with thumbnails or live previews.
- Context menu (web only): Duplicate, Download SVG, Delete, Cancel.
- Settings overlay: Rename tile set.

Tile Modify View (tileSetCreator/modifyTile.tsx)
- Header row and toolbar actions similar to Modify View.
- Grid background and optional debug overlay.
- Brush panel identical to Modify View for editing the tile template.

Core Behaviors and Tool Rules
- Tile connectivity is driven by `tile_########.png/svg` naming (see AI_ASSET_RULES). Connections are used to validate random placements and compatibility.
- Allow Border Connections: When off, edges behave as if neighbors are empty and connections cannot extend past the grid.
- Random brush tap: Attempts to place a compatible tile at the tapped cell. If no legal placement is found and legal placement is required, the tap does nothing. Otherwise an error tile is placed.
- Random brush double tap: Opens the Tile Set chooser.
- Random brush long press: Opens the Tile Set chooser.
- Fixed brush tap: Places the selected tile with current rotation/mirror and mirrors to linked cells when mirror toggles are enabled.
- Fixed brush double tap (palette): Cycles rotation three times, then mirror X, then mirror Y.
- Fixed brush long press (palette): Opens Favorites dialog to add/remove the tile with a color tag.
- Erase brush: Tap clears a tile. Flood clears all tiles.
- Clone brush: First tap sets clone source. Drag paints clones relative to the anchor cell. Long press on canvas resets clone source to the pressed cell. Clone wraps around grid edges.
- Pattern brush: Uses a pattern anchor cell to map pattern tiles by offset. Pattern mirrors can be toggled in the pattern picker. Pattern rotation is 90-degree increments. Pattern brush long press/double tap opens the pattern picker.
- Pattern creation: Drag-select in the grid to define a pattern. Save dialog prompts to store it in category storage.
- Flood (tap): Fills all cells based on brush mode (random, fixed, pattern, erase). Respects mirror toggles.
- Flood Complete (long press): Fills only empty cells. When mirrors are enabled, it treats mirrors as a unit and expands driven indices if any mirrored target is filled.
- Reconcile (tap): Iteratively replaces invalid tiles with compatible candidates to reduce invalid connections.
- Controlled Randomize (long press): Replaces tiles with connection-compatible equivalents based on their current connection signature.

**UI**

Visual Rules
- Backgrounds: Main screen background is dark gray (#3f3f3f). File and Tile Set list headers are near-black (#202125). Tile Set editor uses a light header (#E2E3E9).
- Panels and overlays: Modal panels are white with dark borders (#1f1f1f). Backdrops are translucent black (rgba(0,0,0,0.7)).
- Highlights: Selection and active states use green (#22c55e). Destructive actions use red (#dc2626).
- Grid visuals: Grid background and line colors are configurable. Line width is configurable. Mirror guides appear as thin lines over the grid.
- Typography: Uses ThemedText variants for title, default, and semi-bold text. All main labels are uppercase or title case, not icon-only.
- Icons: MaterialCommunityIcons for toolbar and header actions.
- Cards and thumbnails: Dark frames with borders; selection adds a green border and thicker stroke.

Layout Rules
- Headers are fixed height (50). Tool buttons are square (40). Brush panel height is 160 with 1px row gaps.
- File grids are 3 columns on mobile with side padding (12) and gaps (12).
- Tile palette can be 2 or 3 rows on iOS depending on available height.

**Infrastructure**

Persistence and Storage
- Files stored in AsyncStorage key `tile-files-v1` and active file id in `tile-files-active-v1`.
- Settings stored in AsyncStorage key `tile-settings-v1` (mirror toggles, border rules, background colors, line width, tile set selections).
- Patterns stored in AsyncStorage key `tile-patterns-v1`.
- Tile sets stored in AsyncStorage key `tile-sets-v1`; baked tile sources cached in `tile-sets-bakes-v1`.
- Brush favorites stored in AsyncStorage key `tile-brush-favorites-v1`.
- File hydration sanitizes stored data: `tiles` is coerced to an array and `grid` requires numeric `rows`/`columns`, otherwise defaults are applied.

File Data Model
- Each file stores: id, name, tiles array, grid rows/columns, category and categories, tileSetIds, sourceNames, preferredTileSize, lineWidth, lineColor, thumbnailUri, previewUri, updatedAt.
- Tile placement uses `imageIndex`, `rotation`, `mirrorX`, `mirrorY`. Empty tiles are `imageIndex = -1`; error tiles are `imageIndex = -2`.
- Tiles can also carry a `name` for the original tile source; rendering prefers `name` to avoid index drift when tile set sources change.

Autosave and Preview Pipeline
- Autosave is debounced (150ms). Web preview capture is additionally delayed (800ms).
- On native, saving uses ViewShot capture and writes PNGs to cache `tile-previews/` for full preview and thumbnail.
- On web, previews and thumbnails are generated via `renderTileCanvasToDataUrl`.
- Leaving Modify view triggers a full save via `persistActiveFileNow`.

Hydration and Rendering
- File changes run through a hydrate pipeline that suspends rendering and uses `loadToken`/`loadedToken` gating.
- During hydration, preview images are shown and can overlay the grid until tiles are applied, referenced user tile sets are baked, tile/source updates have been stable briefly, and the grid has stabilized (double RAF), preventing interim `tile_error` flashes.

Tile Source Mapping
- Active palette sources are built from selected categories plus baked user tile sets.
- Each file stores `sourceNames` so tile indices remain stable even if available sources change.
- If a file has no `sourceNames`, it is seeded from the current selection and stored back into the file.
- When palette sources expand, `sourceNames` are extended and persisted.
- File source initialization is guarded to run once per active file id and can defer until baked tile sets are ready.
- When a file references user tile sets (via `tileSetIds`) but baked sources are not ready yet, source seeding is deferred to avoid remapping tiles to the wrong sources.
- Palette selection maps tiles to file indices by tile name (not palette position) so adding/removing tile sets does not shift existing mappings.
- Mapping prefers the active file's `sourceNames` when available to keep palette interactions aligned during hydration.
- `normalizeTiles` guards against undefined/null tile arrays and falls back to empty tiles for the current grid size.

Tile Set Baking and Caching
- Tile sets are baked into SVGs. Web stores data URIs; native writes files under `documentDirectory/tile-sets/<setId>/`.
- Bake signatures and per-tile signatures prevent redundant work. A memory cache stores SVG XML for reuse during baking.
- While baking on native, placeholder baked sources (with error tiles) can be published early to stabilize source name ordering; these are replaced once SVGs finish writing.
- Baked tile names include the tile `updatedAt` timestamp; legacy baked sources are kept so existing placed tiles keep rendering even if tiles are edited or deleted. The palette only shows current baked names.

SVG Loading and Caching (TileAsset)
- SVG XML is cached in-memory (`svgXmlCache`) by URI. SVG overrides are cached in `svgOverrideCache`.
- SVGs are loaded via `FileSystem.readAsStringAsync` on native and `fetch` on web.
- `prefetchTileAssets` warms the cache for palette and file sources during Modify view.
- In-flight SVG reads are de-duplicated, and XML is cached under both original and resolved URIs.

Skia Rendering (Native)
- Native grid rendering uses a single Skia canvas (components/tile-grid-canvas.native.tsx) to draw all tiles when running in a dev build or standalone app.
- SVG XML is loaded via `getSvgXmlWithOverrides` and parsed to Skia SVGs, then drawn with transforms for rotation and mirroring.
- Clone overlays and debug dots are drawn directly in Skia.
- Skia requires `@shopify/react-native-skia` with peer deps React >= 19 and React Native >= 0.78.
- Expo Go falls back to the React TileCell grid for compatibility.

**Rendering**
- Web: Tile grid is rendered as React components (TileCell per cell). For live editing, TileCell uses PNG atlas sprites (TileAtlasSprite) generated by useTileAtlas; SVGs are used as a fallback while the atlas loads. Pointer events are handled on the grid container.
- Native (Expo Go): Falls back to the same React TileCell grid as web for compatibility.
- Native (dev build / standalone): Tile grid is rendered by a single Skia Canvas (TileGridCanvas). Each tile is drawn as an SVG image with transforms applied in Skia. Clone overlays and debug dots are drawn directly on the Canvas. The Canvas is mounted inside a ViewShot container to support preview captures.
- Preview rendering: During file hydration, the grid is hidden and a PNG preview is shown (if available). Preview/thumbnail capture uses ViewShot on native and `renderTileCanvasToDataUrl` on web.

Performance and Interaction
- Touch and mouse inputs track interaction start/end for perf logging.
- Clone and pattern tools use anchors and wrap-around indexing for consistent offsets.
- Mirroring is applied by deriving driven cells and mapping to mirrored targets.
- Tile placement compatibility uses cached connection tables (buildCompatibilityTables) to avoid recomputing connection transforms per brush action.
