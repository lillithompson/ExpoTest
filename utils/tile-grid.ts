export type Tile = {
  imageIndex: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  source?: unknown;
  name?: string;
  baseConnections?: boolean[] | null;
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
 * Returns the squarest (rows, columns) with rows * columns <= maxCells.
 * Used when capping the tile canvas so the grid stays as square as possible.
 */
function getSquarestDimensions(maxCells: number): { rows: number; columns: number } {
  const side = Math.floor(Math.sqrt(maxCells));
  const columns = side;
  const rows = Math.floor(maxCells / columns);
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
  if (currentTiles.length === cellCount) {
    return currentTiles;
  }
  if (currentTiles.length < cellCount) {
    const next = [...currentTiles];
    for (let i = currentTiles.length; i < cellCount; i += 1) {
      const source = currentTiles[i % currentTiles.length];
      next.push({
        imageIndex: source.imageIndex,
        rotation: source.rotation,
        mirrorX: source.mirrorX,
        mirrorY: source.mirrorY,
        name: source.name,
      });
    }
    return next;
  }
  return currentTiles.slice(0, cellCount);
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
      const { rows: sqRows, columns: sqCols } = getSquarestDimensions(MAX_TILE_CANVAS_CELLS);
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
    let columns = Math.max(1, maxColumns);
    const rawTileSize = (availableWidth - gridGap * (columns - 1)) / columns;
    let tileSize = Math.floor(rawTileSize);
    let rows = Math.max(
      1,
      Math.floor((availableHeight + gridGap) / (tileSize + gridGap))
    );
    if (rows * columns > MAX_TILE_CANVAS_CELLS) {
      const sq = getSquarestDimensions(MAX_TILE_CANVAS_CELLS);
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
