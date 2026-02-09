# App State Overview

This document is the single source of truth for reconstructing the app from scratch. It describes routes, screens, modals, UI rules, and the behavior and data flow of the tile system.

**Structure**

Root Layout (app/_layout.tsx)
- Persistent mobile web banner: On web, when viewport width < 768 or user agent indicates mobile, a yellow top banner is shown with text "Mobile web partially supported. Use a desktop browser". Hidden on native and on desktop web. Implemented via `getIsMobileWebForWindow` (utils/is-mobile-web.ts), `useIsMobileWeb` (hooks/use-is-mobile-web.ts and .web.ts), and `MobileWebBanner` (components/mobile-web-banner.tsx).

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
- File grid: Scrollable list of file cards, sorted by `updatedAt` descending. Column count is computed from content width so as many columns as fit: on desktop web (width ≥ 768) at least FILE_GRID_MIN_CARD_WIDTH_DESKTOP_WEB (240px) per card for larger thumbnails; otherwise FILE_GRID_MIN_CARD_WIDTH (100px). Cards pack to the upper left with no extra horizontal spread. On web, file thumbnail display size is capped (aspect ratio preserved): 200 px on narrow viewports, 400 px (2×) on desktop (content width ≥ 768). Generated thumbnail resolution is FILE_THUMB_SIZE 200; native ViewShot and web renderTileCanvasToDataUrl use 200. Cards show previews (thumbnail/preview if available, otherwise live tile grid on native; web uses placeholder).
- File card interactions: Tap opens Modify view; long press opens File Options menu.
- File Options menu: Download (web direct or native overlay), Download SVG (web only), Duplicate, Delete.
- New File modal: Tile size selection grid of [25, 50, 75, 100, 150, 200].
- Settings overlay (file view): Allow Border Connections toggle, Show Debug toggle, background color picker, background line color picker, background line width slider. "Delete all local data" button: shows an "are you sure" confirmation (Alert on native, window.confirm on web); on confirm, clears AsyncStorage for files, tile sets, bakes, favorites, and patterns, resets in-memory state via clearAllFiles, reloadTileSets, clearBrushFavorites, and clearAllPatterns, then closes settings and returns to file view.

Modify View (viewMode = "modify")
- Status bar background strip at the top (white).
- Header row: Back button "< Modify" (returns to File view immediately; save runs in background) and toolbar actions.
- Toolbar actions: Reset, Flood (tap) / Flood Complete (long press), Reconcile (tap) / Controlled Randomize (long press), Mirror Horizontal toggle, Mirror Vertical toggle.
- Canvas frame: Grid background, optional mirror guide lines, optional preview image during hydration.
- Tile grid: Web renders TileCell components; mouse and touch are both supported so that tap and drag work on desktop and mobile browsers (e.g. Safari on iOS). Native renders a single Skia canvas (TileGridCanvas) for all tiles.
- Pattern creation overlays: Top and bottom overlays shown while in pattern creation mode.
- Brush panel: Scrollable two or three row tile palette plus Random, Clone, Erase, and Pattern buttons. Palette tiles use an absolutely positioned 4px border overlay (dark when unselected, green when selected) and a full-size (itemSize × itemSize) content wrapper so tile images stay centered with no shift on selection or when switching from cached/loading image to atlas canvas.
- Pattern chooser modal: Lists patterns for the active category with actions for create and select mode.
- Pattern save modal: Preview of the selection with Save/Cancel.
- Tile Set chooser overlay: Grid of thumbnails (first tile per set) with name below. Built-in categories then user tile sets. Selected items are brighter with green border (#22c55e, 2px); multi-select to define the active palette.
- Settings overlay (modify view): Allow Border Connections toggle, Download PNG action, Show Debug toggle, background color and line controls.
- Download overlay (native): ViewShot capture with background toggle and PNG/SVG actions.

Tile Set Creator List (tileSetCreator/index.tsx)
- Header row: Title "Tile Sets" (tap returns to File view), actions for Create and Select Mode.
- Select mode bar: Animated bar with Delete, selected count, Exit.
- Tile set grid: Cards with 2x2 previews (baked image or, on native, live grid). On web, a dark placeholder is shown until the baked preview is ready (no live grid) to avoid a white-border flash; baked previews are cached in a module-level map so they persist across navigations and are not regenerated when returning to the list. Long press (web only) opens download modal.
- Create Tile Set modal: Name input and resolution options 2, 3, 4.
- Download Tile Set modal (web only): Downloads all tiles in the set as a ZIP of SVGs.

Tile Set Editor (tileSetCreator/editor.tsx)
- Header row: Back, tile set name, actions for Add Tile, Select Mode, and Settings.
- Select mode bar: Animated bar with Delete, selected count, Exit.
- Tile grid: Cards with thumbnails or live previews.
- Context menu (web only): Duplicate, Download SVG, Delete, Cancel.
- Settings overlay: Rename tile set.

Tile Modify View (tileSetCreator/modifyTile.tsx)
- Header row: back button label "Modify Tile" (upper left); toolbar actions similar to Modify View.
- Grid background and optional debug overlay.
- Brush panel: 3 rows on web (reserves ≥32% content height for larger tiles), 4 rows on iOS; for editing the tile template.

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
- Clone brush: First tap sets clone source. Drag paints clones relative to the anchor cell. Long press on canvas resets clone source to the pressed cell. Clone wraps around grid edges. On mobile web (e.g. iOS Safari), synthesized mouse events after a touch are ignored so one tap does not set both source and anchor; only the touch is handled.
- Pattern brush: Uses a pattern anchor cell to map pattern tiles by offset. Pattern mirrors can be toggled in the pattern picker. Pattern rotation is 90-degree increments. Pattern brush long press/double tap opens the pattern picker.
- Pattern creation: Drag-select in the grid to define a pattern. Save dialog prompts to store it in category storage.
- Flood (tap): Fills all cells based on brush mode (random, fixed, pattern, erase). Respects mirror toggles.
- Flood Complete (long press): Fills only empty cells. When mirrors are enabled, it treats mirrors as a unit and expands driven indices if any mirrored target is filled.
- Reconcile (tap): Iteratively replaces invalid tiles with compatible candidates to reduce invalid connections. Uninitialized (empty) tiles are never changed; edges to uninitialized neighbors are treated as 00000000 connectivity when validating and picking replacements.
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
- Tile palette can be 2 or 3 rows on iOS depending on available height. On mobile web, content width uses the visual viewport and the brush panel is constrained to 100% width with minWidth: 0 so the palette is not laid out with an incorrect width (e.g. half-scrolled off screen).
- Tile canvas layout is capped at 512 cells: `computeGridLayout` and `computeFixedGridLayout` (utils/tile-grid.ts) never return a grid with more than 512 tiles; when capping is needed, dimensions are chosen to be as square as possible (e.g. 22×23). The hook (use-tile-grid) also clamps `totalCells` to this limit.

**Infrastructure**

Persistence and Storage
- Files stored in AsyncStorage key `tile-files-v1` and active file id in `tile-files-active-v1`.
- Settings stored in AsyncStorage key `tile-settings-v1` (mirror toggles, border rules, background colors, line width, tile set selections).
- Patterns stored in AsyncStorage key `tile-patterns-v1`.
- Tile sets stored in AsyncStorage key `tile-sets-v1`; baked tile sources cached in `tile-sets-bakes-v1`.
- Brush favorites stored in AsyncStorage key `tile-brush-favorites-v1`.
- Delete all local data (File > Settings): `utils/clear-local-data.ts` clears the above storage keys (including tile-patterns-v1); app then resets files (useTileFiles.clearAllFiles), tile sets (useTileSets.reloadTileSets), favorites (clearBrushFavorites from tile-brush-panel), and patterns (useTilePatterns.clearAllPatterns).
- File hydration sanitizes stored data: `tiles` is coerced to an array and `grid` requires numeric `rows`/`columns`, otherwise defaults are applied.

File Data Model
- Each file stores: id, name, tiles array, grid rows/columns, category and categories, tileSetIds, sourceNames, preferredTileSize, lineWidth, lineColor, thumbnailUri, previewUri, updatedAt.
- Tile placement uses `imageIndex`, `rotation`, `mirrorX`, `mirrorY`. Empty tiles are `imageIndex = -1`; error tiles are `imageIndex = -2`.
- Tiles can also carry a `name` for the original tile source; rendering prefers `name` to avoid index drift when tile set sources change.

Autosave and Preview Pipeline
- Autosave is debounced (150ms). Web preview capture is additionally delayed (800ms).
- On native, saving uses ViewShot capture and writes PNGs to cache `tile-previews/` for full preview and thumbnail.
- On web, previews and thumbnails are generated via `renderTileCanvasToDataUrl`.
- Leaving Modify view starts a full save via `persistActiveFileNow` in the background (navigation is immediate).

Hydration and Rendering
- File changes run through a hydrate pipeline that suspends rendering and uses `loadToken`/`loadedToken` gating.
- During hydration, preview images are shown and can overlay the grid until tiles are applied, referenced user tile sets are baked, tile/source updates have been stable briefly, and the grid has stabilized (double RAF), preventing interim `tile_error` flashes.

Tile Source Mapping
- Active palette sources are built from selected categories plus baked user tile sets.
- Each file stores `sourceNames` so tile indices remain stable even if available sources change.
- File source resolution uses an "effective" source list: the active file's `sourceNames` unless the local `fileSourceNames` contains new entries (e.g., freshly added UGC tiles), in which case the local list is used to render immediately.
- If a file has no `sourceNames`, it is seeded from the current selection and stored back into the file.
- When palette sources expand, `sourceNames` are extended and persisted.
- File source initialization is guarded to run once per active file id and can defer until baked tile sets are ready.
- When a file references user tile sets (via `tileSetIds`) but baked sources are not ready yet, source seeding is deferred to avoid remapping tiles to the wrong sources.
- Palette selection maps tiles to file indices by tile name (not palette position) so adding/removing tile sets does not shift existing mappings.
- Fixed brush carries the selected source `sourceName`; placement in useTileGrid resolves index by name when `sourceName` is set so the correct UGC tile is placed even when React state (e.g. `fileSourceNames`) updates asynchronously (fixes iOS Expo Go bug where UGC tiles rendered as built-in). The app also passes `getFixedBrushSourceName` (a ref-backed getter) so placement always reads the current selected source name and is not affected by stale closures on tap (Expo Go / React Native).
- Hydration uses the file's own `sourceNames` when present: `pendingRestoreRef` stores `sourceNames` from the file being loaded, and `hydrateTilesWithSourceNames` assigns `tile.name` from that list so rendering (which prefers `tile.name`) shows the correct UGC tile even when `tileSources` order differs on Expo Go (e.g. built-in first).
- Mapping prefers the active file's `sourceNames` when available to keep palette interactions aligned during hydration.
- Palette order follows the current selection (user tile sets first, then built-in categories). Favorites are sorted to the front of the palette.
- `normalizeTiles` guards against undefined/null tile arrays and falls back to empty tiles for the current grid size.
- On native, user tile names (`tileset-<id>:<file>.svg`) are resolved to a direct file path under `documentDirectory/tile-sets/<setId>/` if the baked source is missing, `tile_error`, or points outside the tile-sets directory.

Tile Set Baking and Caching
- Tile sets are baked into SVGs. Web stores data URIs; native writes files under `documentDirectory/tile-sets/<setId>/`.
- Bake signatures and per-tile signatures prevent redundant work. A memory cache stores SVG XML for reuse during baking.
- While baking on native, placeholder baked sources (with error tiles) can be published early to stabilize source name ordering; these are replaced once SVGs finish writing.
- Baked tile names include the tile `updatedAt` timestamp; legacy baked sources are kept so existing placed tiles keep rendering even if tiles are edited or deleted. The palette only shows current baked names.

SVG Loading and Caching (TileAsset)
- SVG XML is cached in-memory (`svgXmlCache`) by URI. SVG overrides are cached in `svgOverrideCache`.
- SVGs are loaded via `FileSystem.readAsStringAsync` on native and `fetch` on web.
- On native, UGC tile file URIs (file:// and path contains `/tile-sets/`) never use the shared cache: `isUgcTileFileUri` (utils/tile-uri.ts) identifies them; TileAsset skips svgOverrideCache/svgXmlCache read and does not write loaded XML to the cache for these URIs. This prevents wrong-tile display when a cached built-in tile would otherwise be returned for a UGC placement (e.g. on Expo Go).
- TileAtlasSprite keys TileAsset by source URI (`key={sourceUri ?? name}`) so each distinct source gets a fresh instance and no stale cached content is reused when the source changes.
- `prefetchTileAssets` warms the cache for palette and file sources during Modify view.
- In-flight SVG reads are de-duplicated, and XML is cached under both original and resolved URIs.

Skia Rendering (Native)
- Native grid rendering uses a single Skia canvas (components/tile-grid-canvas.native.tsx) to draw all tiles when running in a dev build or standalone app.
- SVG XML is loaded via `getSvgXmlWithOverrides` and parsed to Skia SVGs, then drawn with transforms for rotation and mirroring.
- Clone overlays and debug dots are drawn directly in Skia.
- Skia requires `@shopify/react-native-skia` with peer deps React >= 19 and React Native >= 0.78.
- Expo Go falls back to the React TileCell grid for compatibility.
- Native Skia rendering prefers `tile.name` when present (falling back to `imageIndex`) to avoid visual drift after source list changes.

**Rendering**
- Web: Tile grid is rendered as React components (TileCell per cell). For live editing, TileCell uses PNG atlas sprites (TileAtlasSprite) generated by useTileAtlas; SVGs are used as a fallback while the atlas loads. Pointer events are handled on the grid container. When the tile canvas is narrower than the content area, it is centered horizontally (gridCanvasWebCenter wrapper with width 100% and alignItems center). The same centering is applied on web in the Modify Tile view (tileSetCreator/modifyTile.tsx).
- Native (Expo Go): Falls back to the same React TileCell grid as web for compatibility. TileCell never uses index-based resolution when `tile.name` is set: it uses `resolveSourceForName(tile.name)` then `resolveUgcSourceFromName(tile.name)` for UGC names, so stale `tileSources` order on Expo Go cannot show built-in tiles for UGC placements.
- Native (dev build / standalone): Tile grid is rendered by a single Skia Canvas (TileGridCanvas). Each tile is drawn as an SVG image with transforms applied in Skia. Clone overlays and debug dots are drawn directly on the Canvas. The Canvas is mounted inside a ViewShot container to support preview captures.
- Preview rendering: During file hydration, the grid is hidden and a PNG preview is shown (if available). Preview/thumbnail capture uses ViewShot on native and `renderTileCanvasToDataUrl` on web. On native, the grid preview image uses `expo-image` (not React Native `Image`) so that `file://` URIs from the cache directory display reliably on iOS Expo Go. Each save writes preview/thumb to unique paths (`${fileId}-${timestamp}-full.png` and `-thumb.png`) and deletes the previous file for that document, so the cached image always reflects the latest state (no stale image cache). The modify view delays `gridStabilized` until the tile canvas has painted: on dev/standalone the Skia TileGridCanvas reports `onPaintReady`; on Expo Go a timeout is used (1.8s). Timeouts are 2.5s (Skia) and 1.8s (Expo Go) to avoid a blank canvas while tiles load.
- File list thumbnails: When a file has `thumbnailUri` or `previewUri`, the app shows that cached thumbnail via `TileAsset` (same on all platforms). When there is no cached thumbnail, native shows the live tile grid as fallback.
- UGC file thumbnails (Expo Go iOS): Line width must match built-in tile sets. `strokeScaleByName` (from user tile set resolution) scales stroke for palette and canvas. When showing the fallback grid (no cached thumbnail) on native, each tile uses scaled `strokeWidth` (file.lineWidth * strokeScaleByName); download overlay tiles use scaled strokeWidth as well. Generated file thumbnails (web `renderTileCanvasToDataUrl`) and downloaded PNG (web via `downloadFile`) and SVG (native overlay and web file menu) now pass `strokeScaleByName` so UGC line widths in exports match the main canvas. Tile set creator (modifyTile) thumbnail generation also passes a per-set `strokeScaleByName` (from `tileSet.resolution`) so tile-entry thumbnails use consistent stroke scale. Export (renderTileCanvasToDataUrl and renderTileCanvasToSvg) uses name-based resolution when `tile.name` is set: source and scale are resolved by `tile.name` so UGC tiles get the correct stroke scale in thumbnails even when palette order differs from the file’s source order.

Performance and Interaction
- Touch and mouse inputs track interaction start/end for perf logging.
- Clone and pattern tools use anchors and wrap-around indexing for consistent offsets.
- Mirroring is applied by deriving driven cells and mapping to mirrored targets.
- Tile placement compatibility uses cached connection tables (buildCompatibilityTables) to avoid recomputing connection transforms per brush action.
- When `DEBUG_FILE_CHECK` is on, the Settings overlay includes a "Check UGC File" button that alerts whether the first UGC tile name resolves to an on-device SVG file path.

Testing
- Unit tests for tile resolution and hydration live in `utils/__tests__/tile-grid.test.ts`. They assert: `hydrateTilesWithSourceNames` assigns `tile.name` from the file's sourceNames so UGC index 0 gets the UGC name; `resolveDisplaySource` uses only name-based resolution when `tile.name` is set (never index, so wrong tile cannot show); `getTileSourceIndexByName` resolves by name; `normalizeTiles` preserves `tile.name`. Run with `npm test` (or `npm run test:watch`). Run tests when changing tile-grid utils or UGC/placement/hydration logic.
- Unit tests for UGC URI detection live in `utils/__tests__/tile-uri.test.ts`. They assert: `isUgcTileFileUri` returns false on web; on native it returns true only for file:// URIs whose path contains `/tile-sets/`, so the TileAsset cache-bypass rule is well-defined and regression-safe. Run tests when changing utils/tile-uri.ts or TileAsset cache behavior.
- Unit tests for the cached canvas preview flow live in `utils/__tests__/preview-state.test.ts`. They assert: `getFilePreviewUri` uses `previewUri ?? thumbnailUri` so the correct cached image is used when opening a file; `hasCachedThumbnail` is true only when the file has `thumbnailUri` or `previewUri` (so the file list always shows the cached thumbnail when present—no platform/tiles branching); `hasPreview` and `showPreview` ensure the preview is shown when we have a URI and the live grid is not visible (or we're clearing); `isOwnPreviewUri` restricts delete to URIs under the preview dir; `buildPreviewPath` produces unique paths per save so the image cache shows the latest state. The app uses `utils/preview-state.ts` for this logic. Run tests when changing preview/load behavior or preview path handling.
- Unit tests for the file load/hydration flow live in `utils/__tests__/load-state.test.ts`. They assert: `canApplyEmptyNewFileRestore` is true for empty new files (rows/cols 0) when `tileSize > 0` so the apply effect can run and the file becomes editable (avoids "cached preview stuck" bugs); `canApplyNonEmptyRestore` covers the non-empty branch; `isLoadComplete` is true only when `loadedToken === loadToken` and `!hydrating` and `loadToken !== 0`, so deferring `setLoadedToken` or `setHydrating` incorrectly leaves the file non-editable. The app uses `utils/load-state.ts` for apply-effect conditions in the modify view. When `gridLayout.tileSize` is 0 (e.g. after reload or return from Tile Set Creator before layout runs), the apply effect uses a fallback shape from the pending restore’s `preferredTileSize` so files still become editable instead of staying on the full-screen cache. Run tests when changing load/hydration or navigation timing.
