export type Tile = {
  imageIndex: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  source?: unknown;
  name?: string;
  baseConnections?: boolean[] | null;
  /** Monotonic order when the tile was placed; used by reconcile to prefer altering older tiles. */
  placedOrder?: number;
};

export type GridLayout = {
  columns: number;
  rows: number;
  tileSize: number;
};

/** Maximum number of tiles allowed in the tile canvas. Layout logic is capped so we never exceed this. */
export const MAX_TILE_CANVAS_CELLS = 512;

/**
 * Returns cell indices in spiral order: start at upper-left (0,0), go right to the right border,
 * down to the bottom border, up to border-1, then right (inward) to border-1, and repeat inward.
 * Used so draw-tool flood fill behaves as if the draw stroke spiraled from the corner.
 */
export function getSpiralCellOrder(columns: number, rows: number): number[] {
  if (columns <= 0 || rows <= 0) return [];
  const order: number[] = [];
  let minR = 0;
  let minC = 0;
  let maxR = rows - 1;
  let maxC = columns - 1;
  while (minR <= maxR && minC <= maxC) {
    for (let c = minC; c <= maxC; c += 1) {
      order.push(minR * columns + c);
    }
    minR += 1;
    if (minR > maxR) break;
    for (let r = minR; r <= maxR; r += 1) {
      order.push(r * columns + maxC);
    }
    maxC -= 1;
    if (minC > maxC) break;
    for (let c = maxC; c >= minC; c -= 1) {
      order.push(maxR * columns + c);
    }
    maxR -= 1;
    if (minR > maxR) break;
    for (let r = maxR; r >= minR; r -= 1) {
      order.push(r * columns + minC);
    }
    minC += 1;
  }
  return order;
}

/**
 * Returns cell indices in spiral order within a rectangle of the grid, so the
 * rectangle's edges act as borders (spiral starts at upper-left of rect, goes
 * right to rect right edge, down to rect bottom, etc.). Used for draw-tool
 * flood fill over a selected region so the selection gets the same spiral effect.
 */
export function getSpiralCellOrderInRect(
  minRow: number,
  minCol: number,
  maxRow: number,
  maxCol: number,
  gridColumns: number
): number[] {
  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;
  if (numRows <= 0 || numCols <= 0) return [];
  const order = getSpiralCellOrder(numCols, numRows);
  return order.map((localIndex) => {
    const localR = Math.floor(localIndex / numCols);
    const localC = localIndex % numCols;
    return (minRow + localR) * gridColumns + (minCol + localC);
  });
}

/**
 * Returns the squarest (rows, columns) with rows * columns <= maxCells.
 * Used when capping the tile canvas so the grid stays as square as possible.
 */
function getSquarestDimensions(maxCells: number): { rows: number; columns: number } {
  const side = Math.floor(Math.sqrt(maxCells));
  const columns = side;
  const rows = Math.floor(maxCells / columns);
  return { rows, columns };
}

/**
 * Same as getSquarestDimensions but ensures both rows and columns are even.
 * Used for the full tile canvas at highest resolution so layout is always even.
 */
function getSquarestDimensionsEven(maxCells: number): { rows: number; columns: number } {
  const { rows: r, columns: c } = getSquarestDimensions(maxCells);
  let rows = Math.max(2, 2 * Math.floor(r / 2));
  let columns = Math.max(2, 2 * Math.floor(c / 2));
  while (rows * columns > maxCells && (rows > 2 || columns > 2)) {
    if (rows >= columns) rows -= 2;
    else columns -= 2;
  }
  return { rows, columns };
}

export const pickRotation = () => {
  const options = [0, 90, 180, 270];
  return options[Math.floor(Math.random() * options.length)];
};

export const pickNewIndex = (currentIndex: number, sourcesLength: number) => {
  if (sourcesLength <= 1) {
    return currentIndex;
  }

  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * sourcesLength);
  }
  return nextIndex;
};

export const buildInitialTiles = (count: number): Tile[] => {
  if (count <= 0) {
    return [];
  }
  return Array.from({ length: count }, (): Tile => ({
    imageIndex: -1,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
  }));
};

export const normalizeTiles = (
  currentTiles: Tile[] | null | undefined,
  cellCount: number,
  _sourcesLength: number
): Tile[] => {
  if (cellCount <= 0) {
    return [] as Tile[];
  }
  if (!Array.isArray(currentTiles)) {
    return buildInitialTiles(cellCount);
  }
  if (currentTiles.length === 0) {
    return buildInitialTiles(cellCount);
  }
  // Densify arrays that have sparse holes (Object.keys detects unset indices) or explicit
  // null/undefined entries (null appears when a previously-sparse array was JSON-serialized
  // and reloaded — JSON.stringify converts undefined/holes to null).
  const hasSparseHoles = Object.keys(currentTiles).length < currentTiles.length;
  const hasNullEntries = !hasSparseHoles && currentTiles.some((t) => t == null);
  const tiles: Tile[] =
    hasSparseHoles || hasNullEntries
      ? Array.from({ length: currentTiles.length }, (_, i) =>
          currentTiles[i] != null
            ? currentTiles[i]!
            : ({ imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false } as Tile)
        )
      : currentTiles;
  if (tiles.length === cellCount) {
    return tiles;
  }
  if (tiles.length < cellCount) {
    const next = [...tiles];
    for (let i = tiles.length; i < cellCount; i += 1) {
      const source = tiles[i % tiles.length];
      next.push({
        imageIndex: source.imageIndex,
        rotation: source.rotation,
        mirrorX: source.mirrorX,
        mirrorY: source.mirrorY,
        name: source.name,
        placedOrder: source.placedOrder,
      });
    }
    return next;
  }
  return tiles.slice(0, cellCount);
};

/**
 * Picks the source to use for displaying a tile. When tile.name is set, uses only
 * the name-based resolver so we never show the wrong tile when tileSources order
 * differs (e.g. Expo Go built-in first vs UGC first). When tile.name is not set,
 * falls back to index-based lookup.
 */
export function resolveDisplaySource<T>(
  tile: Tile,
  resolveByName: (name: string) => T | null | undefined,
  getByIndex: (index: number) => T | null | undefined
): T | null | undefined {
  if (tile.name) {
    return resolveByName(tile.name) ?? null;
  }
  if (tile.imageIndex >= 0) {
    return getByIndex(tile.imageIndex);
  }
  return null;
}

/**
 * Returns index of the source with the given name, or -1. Used so placement and rendering
 * resolve by name first and avoid UGC/built-in index mismatch (e.g. on Expo Go).
 */
export const getTileSourceIndexByName = (
  sources: Array<{ name: string }>,
  sourceName: string
): number => sources.findIndex((s) => s.name === sourceName);

/**
 * Assigns tile.name from sourceNames[tile.imageIndex] when missing.
 * Ensures UGC tiles render by name so index drift (e.g. built-in vs UGC order on Expo Go) does not show wrong tiles.
 */
export const hydrateTilesWithSourceNames = (
  tiles: Tile[],
  sourceNames: string[]
): Tile[] => {
  if (!sourceNames.length) {
    return tiles;
  }
  return tiles.map((tile) => {
    if (!tile || tile.imageIndex < 0 || tile.name) {
      return tile;
    }
    const name = sourceNames[tile.imageIndex];
    return name ? { ...tile, name } : tile;
  });
};

export const computeGridLayout = (
  availableWidth: number,
  availableHeight: number,
  gridGap: number,
  preferredTileSize: number
): GridLayout => {
  if (availableWidth <= 0 || availableHeight <= 0 || preferredTileSize <= 0) {
    return { columns: 0, rows: 0, tileSize: 0 };
  }

  const maxColumns = Math.max(
    1,
    Math.floor((availableWidth + gridGap) / (Math.max(1, preferredTileSize) + gridGap))
  );
  const candidates: GridLayout[] = [];

  for (let columns = 2; columns <= maxColumns; columns += 1) {
    if (columns % 2 === 1) {
      continue;
    }
    const rawTileSize = (availableWidth - gridGap * (columns - 1)) / columns;
    const tileSize = Math.floor(rawTileSize);
    if (tileSize <= 0) {
      continue;
    }
    let rows = Math.max(
      1,
      Math.floor((availableHeight + gridGap) / (tileSize + gridGap))
    );
    if (rows > 1 && rows % 2 === 1) {
      rows -= 1;
    }
    if (rows < 2) {
      continue;
    }
    if (rows * columns > MAX_TILE_CANVAS_CELLS) {
      const { rows: sqRows, columns: sqCols } = getSquarestDimensionsEven(MAX_TILE_CANVAS_CELLS);
      rows = sqRows;
      const cappedColumns = sqCols;
      const cappedTileSize = Math.floor(
        Math.min(
          (availableWidth - gridGap * (cappedColumns - 1)) / cappedColumns,
          (availableHeight - gridGap * (sqRows - 1)) / sqRows
        )
      );
      if (cappedTileSize > 0 && sqRows >= 2) {
        candidates.push({ columns: cappedColumns, rows: sqRows, tileSize: cappedTileSize });
      }
      continue;
    }
    candidates.push({ columns, rows, tileSize });
  }

  if (candidates.length === 0) {
    let columns = Math.max(2, 2 * Math.floor(maxColumns / 2));
    const rawTileSize = (availableWidth - gridGap * (columns - 1)) / columns;
    let tileSize = Math.floor(rawTileSize);
    let rows = Math.max(
      2,
      Math.floor((availableHeight + gridGap) / (tileSize + gridGap))
    );
    if (rows % 2 === 1) rows -= 1;
    if (rows < 2) rows = 2;
    if (rows * columns > MAX_TILE_CANVAS_CELLS) {
      const sq = getSquarestDimensionsEven(MAX_TILE_CANVAS_CELLS);
      columns = sq.columns;
      rows = sq.rows;
      tileSize = Math.floor(
        Math.min(
          (availableWidth - gridGap * (columns - 1)) / columns,
          (availableHeight - gridGap * (rows - 1)) / rows
        )
      );
    }
    return { columns, rows, tileSize };
  }

  candidates.sort(
    (a, b) => Math.abs(a.tileSize - preferredTileSize) - Math.abs(b.tileSize - preferredTileSize)
  );
  return candidates[0];
};

export const computeFixedGridLayout = (
  availableWidth: number,
  availableHeight: number,
  gridGap: number,
  rows: number,
  columns: number
): GridLayout => {
  if (availableWidth <= 0 || availableHeight <= 0 || rows <= 0 || columns <= 0) {
    return { columns, rows, tileSize: 0 };
  }
  let cappedRows = rows;
  let cappedColumns = columns;
  if (cappedRows * cappedColumns > MAX_TILE_CANVAS_CELLS) {
    const sq = getSquarestDimensions(MAX_TILE_CANVAS_CELLS);
    cappedRows = sq.rows;
    cappedColumns = sq.columns;
  }
  const maxTileWidth = (availableWidth - gridGap * Math.max(0, cappedColumns - 1)) / cappedColumns;
  const maxTileHeight = (availableHeight - gridGap * Math.max(0, cappedRows - 1)) / cappedRows;
  const tileSize = Math.max(0, Math.floor(Math.min(maxTileWidth, maxTileHeight)));
  return { columns: cappedColumns, rows: cappedRows, tileSize };
};

/**
 * Background grid resolution levels: level 1 = one grid cell per tile (full resolution).
 * Each level halves the resolution (level 2 = 2×2 tiles per cell, level 3 = 4×4, etc.).
 * Returns the maximum level such that the level grid has at least one complete cell
 * (same k-range as getLevelGridInfo: only fully contained cells).
 */
export function getMaxGridResolutionLevel(columns: number, rows: number): number {
  if (columns <= 0 || rows <= 0) return 0;
  let level = 1;
  while (true) {
    if (level >= 2) {
      const cellTiles = Math.pow(2, level - 1);
      const centerCol = Math.floor(columns / 2);
      const centerRow = Math.floor(rows / 2);
      const vRange = getLevelKRange(centerCol, columns, cellTiles);
      const hRange = getLevelKRange(centerRow, rows, cellTiles);
      if (!vRange || !hRange) {
        return level - 1;
      }
    }
    level += 1;
    if (level > 32) break;
  }
  return level - 1;
}

export type GridLevelLinePositions = {
  verticalPx: number[];
  horizontalPx: number[];
};

/**
 * Returns pixel positions for grid lines at the given resolution level.
 * Level 1 = all tile boundaries. Level 2+ = coarser grid with 2^(level-1) tiles
 * per cell; lines are drawn only at level-1 boundaries so they always align.
 * Grid is built from the center out (center = where mirror lines cross); partial
 * cells at the edges are left. The center horizontal and vertical lines are
 * grid lines at all levels.
 */
export function getGridLevelLinePositions(
  columns: number,
  rows: number,
  level: number,
  tileSize: number,
  gridGap: number
): GridLevelLinePositions {
  const stride = tileSize + gridGap;
  if (columns <= 0 || rows <= 0 || level < 1 || stride <= 0) {
    return { verticalPx: [], horizontalPx: [] };
  }
  if (level === 1) {
    const verticalPx = Array.from(
      { length: Math.max(0, columns - 1) },
      (_, i) => (i + 1) * stride
    );
    const horizontalPx = Array.from(
      { length: Math.max(0, rows - 1) },
      (_, i) => (i + 1) * stride
    );
    return { verticalPx, horizontalPx };
  }
  const cellTiles = Math.pow(2, level - 1);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const verticalIndices: number[] = [];
  for (let k = Math.ceil((1 - centerCol) / cellTiles); k <= Math.floor((columns - 1 - centerCol) / cellTiles); k += 1) {
    const pos = centerCol + k * cellTiles;
    if (pos >= 1 && pos <= columns - 1) {
      verticalIndices.push(pos);
    }
  }
  verticalIndices.sort((a, b) => a - b);
  const horizontalIndices: number[] = [];
  for (let k = Math.ceil((1 - centerRow) / cellTiles); k <= Math.floor((rows - 1 - centerRow) / cellTiles); k += 1) {
    const pos = centerRow + k * cellTiles;
    if (pos >= 1 && pos <= rows - 1) {
      horizontalIndices.push(pos);
    }
  }
  horizontalIndices.sort((a, b) => a - b);
  return {
    verticalPx: verticalIndices.map((t) => t * stride),
    horizontalPx: horizontalIndices.map((t) => t * stride),
  };
}

export type LevelCellBounds = {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  /** True when bounds are clamped to canvas edge (partial cell). */
  isPartial?: boolean;
  /** Unclamped bounds — only present when isPartial is true. */
  fullMinCol?: number;
  fullMaxCol?: number;
  fullMinRow?: number;
  fullMaxRow?: number;
};

export type LevelGridInfo = {
  levelCols: number;
  levelRows: number;
  /** Bounds of each complete cell in level-1 tile coordinates (row-major: index = row * levelCols + col). */
  cells: LevelCellBounds[];
};

/**
 * Computes the k-range for center-out cells along one axis, including partial
 * edge cells with ≥50% overlap (so 2D area overlap ≥ 25%).
 * Cell k spans [center + k*cellTiles, center + (k+1)*cellTiles - 1].
 * Returns { kMin, kMax } or null if no cells fit.
 */
export function getLevelKRange(
  center: number,
  size: number,
  cellTiles: number
): { kMin: number; kMax: number } | null {
  if (size <= 0 || cellTiles <= 0) return null;
  // Find k range where cell has ANY overlap with [0, size-1]
  // Cell k: start = center + k*cellTiles, end = center + (k+1)*cellTiles - 1
  // Overlap exists when start <= size-1 AND end >= 0
  // start <= size-1  =>  k <= (size - 1 - center) / cellTiles
  // end >= 0         =>  k >= (0 - center - cellTiles + 1) / cellTiles = (-center) / cellTiles - 1 + 1/cellTiles
  // We iterate from the smallest k with any overlap and filter by ≥50% per-dimension overlap.
  const kAnyMin = Math.ceil(-center / cellTiles - 1 + 1 / cellTiles);
  const kAnyMax = Math.floor((size - 1 - center) / cellTiles);
  let kMin: number | null = null;
  let kMax: number | null = null;
  for (let k = kAnyMin; k <= kAnyMax; k++) {
    const start = center + k * cellTiles;
    const end = start + cellTiles - 1;
    const clampedStart = Math.max(0, start);
    const clampedEnd = Math.min(size - 1, end);
    const overlap = clampedEnd - clampedStart + 1;
    if (overlap / cellTiles >= 0.5) {
      if (kMin === null) kMin = k;
      kMax = k;
    }
  }
  if (kMin === null || kMax === null) return null;
  return { kMin, kMax };
}

/**
 * Returns the old (complete-cells-only) k-range for backward compatibility / migration.
 */
export function getLevelKRangeComplete(
  center: number,
  size: number,
  cellTiles: number
): { kMin: number; kMax: number } | null {
  const kMin = Math.ceil(-center / cellTiles);
  const kMax = Math.floor((size - center) / cellTiles) - 1;
  if (kMax < kMin) return null;
  return { kMin, kMax };
}

/**
 * Computes the coordinate offset from level-N (coarser) cells to level-M (finer) cells.
 * Level-N cell (j, i) maps to level-M cells at rows [j*scale+C_row .. j*scale+C_row+scale-1]
 * and cols [i*scale+C_col .. i*scale+C_col+scale-1].
 */
export function getLevelNtoMOffsets(
  columns: number,
  rows: number,
  levelN: number,
  levelM: number
): { scale: number; C_row: number; C_col: number } | null {
  if (levelN <= levelM || levelN < 2 || levelM < 1) return null;
  const cellTilesN = Math.pow(2, levelN - 1);
  const cellTilesM = Math.pow(2, levelM - 1);
  const scale = Math.round(cellTilesN / cellTilesM);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const vRangeN = getLevelKRange(centerCol, columns, cellTilesN);
  const vRangeM = getLevelKRange(centerCol, columns, cellTilesM);
  const hRangeN = getLevelKRange(centerRow, rows, cellTilesN);
  const hRangeM = getLevelKRange(centerRow, rows, cellTilesM);
  if (!vRangeN || !vRangeM || !hRangeN || !hRangeM) return null;
  return {
    scale,
    C_row: hRangeN.kMin * scale - hRangeM.kMin,
    C_col: vRangeN.kMin * scale - vRangeM.kMin,
  };
}

/**
 * Returns the pattern tiling origin for flood fill at `editingLevel`, expressed in
 * editingLevel coordinate space. The origin is the cell in editingLevel that corresponds
 * to the coarsest-level grid's (row=0, col=0), ensuring all levels tile in lockstep.
 */
export function getPatternFloodOrigin(
  gridCols: number,
  gridRows: number,
  pat: { createdAtLevel?: number; layerTiles?: Record<number, unknown> },
  editingLevel: number
): { row: number; col: number } {
  const createdAt = pat.createdAtLevel ?? 1;
  const allLevels = [
    createdAt,
    ...Object.keys(pat.layerTiles ?? {}).map(Number),
  ];
  const coarsestLevel = Math.max(...allLevels);
  if (coarsestLevel <= editingLevel) return { row: 0, col: 0 };
  const offsets = getLevelNtoMOffsets(gridCols, gridRows, coarsestLevel, editingLevel);
  if (!offsets) return { row: 0, col: 0 };
  return { row: offsets.C_row, col: offsets.C_col };
}

/**
 * Returns the grid of cells for a given level (center-out), including partial
 * edge cells that have ≥25% area overlap with the canvas (≥50% per dimension).
 * Used for resolution layers: these cells are editable at this level.
 */
export function getLevelGridInfo(
  columns: number,
  rows: number,
  level: number
): LevelGridInfo | null {
  if (columns <= 0 || rows <= 0 || level < 1) return null;
  if (level === 1) {
    const cells: LevelCellBounds[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        cells.push({ minCol: c, maxCol: c, minRow: r, maxRow: r });
      }
    }
    return { levelCols: columns, levelRows: rows, cells };
  }
  const cellTiles = Math.pow(2, level - 1);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const vRange = getLevelKRange(centerCol, columns, cellTiles);
  const hRange = getLevelKRange(centerRow, rows, cellTiles);
  if (!vRange || !hRange) return null;
  const levelCols = vRange.kMax - vRange.kMin + 1;
  const levelRows = hRange.kMax - hRange.kMin + 1;
  const cells: LevelCellBounds[] = [];
  for (let j = 0; j < levelRows; j += 1) {
    const fullMinRow = centerRow + (hRange.kMin + j) * cellTiles;
    const fullMaxRow = fullMinRow + cellTiles - 1;
    const clampedMinRow = Math.max(0, fullMinRow);
    const clampedMaxRow = Math.min(rows - 1, fullMaxRow);
    const rowPartial = fullMinRow !== clampedMinRow || fullMaxRow !== clampedMaxRow;
    for (let i = 0; i < levelCols; i += 1) {
      const fullMinCol = centerCol + (vRange.kMin + i) * cellTiles;
      const fullMaxCol = fullMinCol + cellTiles - 1;
      const clampedMinCol = Math.max(0, fullMinCol);
      const clampedMaxCol = Math.min(columns - 1, fullMaxCol);
      const colPartial = fullMinCol !== clampedMinCol || fullMaxCol !== clampedMaxCol;
      const isPartial = rowPartial || colPartial;
      const cell: LevelCellBounds = {
        minCol: clampedMinCol,
        maxCol: clampedMaxCol,
        minRow: clampedMinRow,
        maxRow: clampedMaxRow,
      };
      if (isPartial) {
        cell.isPartial = true;
        cell.fullMinCol = fullMinCol;
        cell.fullMaxCol = fullMaxCol;
        cell.fullMinRow = fullMinRow;
        cell.fullMaxRow = fullMaxRow;
      }
      cells.push(cell);
    }
  }
  return { levelCols, levelRows, cells };
}

/**
 * Migrates a legacy layer tile array (from the old complete-cells-only k-range) to the
 * new expanded grid that includes partial edge cells. Old interior cells are mapped to
 * their new positions; new partial cells get empty tiles.
 * Returns the remapped tile array sized to the new grid, or null if no migration is needed
 * (already correct size or unrecognized).
 */
export function migrateLegacyLayerTiles(
  oldTiles: Tile[],
  columns: number,
  rows: number,
  level: number
): Tile[] | null {
  if (level < 2) return null;
  const cellTiles = Math.pow(2, level - 1);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  // Old (complete-only) ranges
  const oldVRange = getLevelKRangeComplete(centerCol, columns, cellTiles);
  const oldHRange = getLevelKRangeComplete(centerRow, rows, cellTiles);
  // New (with partials) ranges
  const newVRange = getLevelKRange(centerCol, columns, cellTiles);
  const newHRange = getLevelKRange(centerRow, rows, cellTiles);
  if (!oldVRange || !oldHRange || !newVRange || !newHRange) return null;
  const oldCols = oldVRange.kMax - oldVRange.kMin + 1;
  const oldRows = oldHRange.kMax - oldHRange.kMin + 1;
  const oldCount = oldCols * oldRows;
  const newCols = newVRange.kMax - newVRange.kMin + 1;
  const newRows = newHRange.kMax - newHRange.kMin + 1;
  const newCount = newCols * newRows;
  // Already the right size — no migration needed
  if (oldTiles.length === newCount) return null;
  // Doesn't match old count either — can't migrate, fall back
  if (oldTiles.length !== oldCount) return null;
  // Offset of old grid origin within new grid
  const colOffset = oldVRange.kMin - newVRange.kMin;
  const rowOffset = oldHRange.kMin - newHRange.kMin;
  const emptyTile: Tile = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
  const newTiles: Tile[] = Array.from({ length: newCount }, () => ({ ...emptyTile }));
  for (let oldR = 0; oldR < oldRows; oldR++) {
    for (let oldC = 0; oldC < oldCols; oldC++) {
      const newR = oldR + rowOffset;
      const newC = oldC + colOffset;
      if (newR >= 0 && newR < newRows && newC >= 0 && newC < newCols) {
        newTiles[newR * newCols + newC] = oldTiles[oldR * oldCols + oldC];
      }
    }
  }
  return newTiles;
}

/**
 * Migrates legacy locked cell indices from the old (complete-only) grid to the new
 * expanded grid. Returns remapped indices, or null if no migration is needed.
 */
export function migrateLegacyLockedCells(
  oldLockedCells: number[],
  columns: number,
  rows: number,
  level: number
): number[] | null {
  if (level < 2 || oldLockedCells.length === 0) return null;
  const cellTiles = Math.pow(2, level - 1);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const oldVRange = getLevelKRangeComplete(centerCol, columns, cellTiles);
  const oldHRange = getLevelKRangeComplete(centerRow, rows, cellTiles);
  const newVRange = getLevelKRange(centerCol, columns, cellTiles);
  const newHRange = getLevelKRange(centerRow, rows, cellTiles);
  if (!oldVRange || !oldHRange || !newVRange || !newHRange) return null;
  const oldCols = oldVRange.kMax - oldVRange.kMin + 1;
  const newCols = newVRange.kMax - newVRange.kMin + 1;
  // If same grid size, no migration needed
  if (oldCols === newCols && (oldVRange.kMin === newVRange.kMin) && (oldHRange.kMin === newHRange.kMin)) return null;
  const colOffset = oldVRange.kMin - newVRange.kMin;
  const rowOffset = oldHRange.kMin - newHRange.kMin;
  const newRows = newHRange.kMax - newHRange.kMin + 1;
  return oldLockedCells
    .map((idx) => {
      const oldR = Math.floor(idx / oldCols);
      const oldC = idx % oldCols;
      const newR = oldR + rowOffset;
      const newC = oldC + colOffset;
      if (newR >= 0 && newR < newRows && newC >= 0 && newC < newCols) {
        return newR * newCols + newC;
      }
      return -1;
    })
    .filter((idx) => idx >= 0);
}

/** Zoom region in level-1 tile coordinates. */
export type ZoomRegion = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
};

/**
 * Returns true if the zoom region contains partial cells at the given level (center-out grid).
 * Level 1 (one tile per cell) never has partial cells. Level 2+ has partial cells when the
 * zoom rect does not align to that level's cell boundaries (e.g. zoom cuts through 2×2 or 4×4 cells).
 * When true, that layer should be greyed out in the layer menu when zoomed (not editable in zoom).
 */
export function zoomRegionHasPartialCellsAtLevel(
  zoomRegion: ZoomRegion,
  columns: number,
  rows: number,
  level: number
): boolean {
  if (level <= 1 || columns <= 0 || rows <= 0) return false;
  const cellTiles = Math.pow(2, level - 1);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  const minColAlign = mod(zoomRegion.minCol - centerCol, cellTiles) === 0;
  const minRowAlign = mod(zoomRegion.minRow - centerRow, cellTiles) === 0;
  const width = zoomRegion.maxCol - zoomRegion.minCol + 1;
  const height = zoomRegion.maxRow - zoomRegion.minRow + 1;
  const widthAlign = mod(width, cellTiles) === 0;
  const heightAlign = mod(height, cellTiles) === 0;
  return !(minColAlign && minRowAlign && widthAlign && heightAlign);
}

/**
 * Converts a point (x, y) in level-1 pixel coordinates to the level-L cell index
 * when (x,y) lies inside a complete level-L cell. Returns null if the point is
 * in a partial cell or outside the grid. Used for hit-testing when editing a higher layer.
 * level1Rows is used to resolve the horizontal mirror boundary: points on the center row
 * are assigned to the cell above the line so mirroring is not offset.
 */
export function getLevelCellIndexForPoint(
  x: number,
  y: number,
  levelInfo: LevelGridInfo,
  level1TileSize: number,
  gridGap: number,
  level1Rows: number
): number | null {
  const stride = level1TileSize + gridGap;
  const centerRow = Math.floor(level1Rows / 2);
  const boundaryY = centerRow * stride;
  const onBoundaryRow = y >= boundaryY && y < boundaryY + stride;
  for (let i = 0; i < levelInfo.cells.length; i += 1) {
    const { minCol, maxCol, minRow, maxRow } = levelInfo.cells[i];
    if (onBoundaryRow && maxRow >= centerRow) continue;
    const left = minCol * stride;
    const top = minRow * stride;
    const w = (maxCol - minCol + 1) * level1TileSize + (maxCol - minCol) * gridGap;
    const h = (maxRow - minRow + 1) * level1TileSize + (maxRow - minRow) * gridGap;
    const inX = x >= left && x < left + w;
    if (onBoundaryRow && maxRow === centerRow - 1 && inX && y >= boundaryY && y < boundaryY + stride) return i;
    if (inX && y >= top && y <= top + h) return i;
  }
  return null;
}

/** Stroke colors for emphasized layers by resolution: highest (L1) = cyan, then yellow, red, violet for coarser. */
export const EMPHASIZE_STROKE_COLORS: Record<number, string> = {
  1: '#00ffff', // cyan – highest resolution (finest)
  2: '#eab308', // yellow – mid
  3: '#dc2626', // red – lower
  4: '#8b5cf6', // violet – coarsest
};

export const getEmphasizeStrokeColor = (internalLevel: number): string =>
  EMPHASIZE_STROKE_COLORS[internalLevel] ?? EMPHASIZE_STROKE_COLORS[4];
