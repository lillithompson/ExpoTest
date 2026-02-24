/**
 * Tests for tile-grid utils. These guard UGC vs built-in tile resolution:
 * - Hydration must assign tile.name from the file's sourceNames so rendering uses name, not index.
 * - When source order differs (e.g. Expo Go built-in first vs UGC first), index-only resolution shows wrong tiles.
 */
import type { Tile } from '../tile-grid';
import {
    buildInitialTiles,
    getGridLevelLinePositions,
    getLevelCellIndexForPoint,
    getLevelGridInfo,
    getLevelKRange,
    getMaxGridResolutionLevel,
    getSpiralCellOrder,
    getSpiralCellOrderInRect,
    getTileSourceIndexByName,
    hydrateTilesWithSourceNames,
    migrateLegacyLayerTiles,
    migrateLegacyLockedCells,
    normalizeTiles,
    resolveDisplaySource,
    zoomRegionHasPartialCellsAtLevel,
} from '../tile-grid';

describe('hydrateTilesWithSourceNames', () => {
  it('assigns name from sourceNames[tile.imageIndex] when tile has no name', () => {
    const ugcSourceNames = [
      'ugc-tile-0.svg',
      'ugc-tile-1.svg',
      'built-in-0.svg',
    ];
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 90, mirrorX: true, mirrorY: false },
      { imageIndex: 2, rotation: 180, mirrorX: false, mirrorY: true },
    ];
    const result = hydrateTilesWithSourceNames(tiles, ugcSourceNames);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('ugc-tile-0.svg');
    expect(result[1].name).toBe('ugc-tile-1.svg');
    expect(result[2].name).toBe('built-in-0.svg');
    expect(result[0].rotation).toBe(0);
    expect(result[1].mirrorX).toBe(true);
  });

  it('leaves tiles with imageIndex < 0 unchanged', () => {
    const sourceNames = ['a.svg', 'b.svg'];
    const tiles: Tile[] = [
      { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, sourceNames);
    expect(result[0].name).toBeUndefined();
    expect(result[1].name).toBeUndefined();
  });

  it('does not overwrite existing tile.name', () => {
    const sourceNames = ['wrong.svg', 'also-wrong.svg'];
    const tiles: Tile[] = [
      {
        imageIndex: 0,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        name: 'ugc-correct.svg',
      },
    ];
    const result = hydrateTilesWithSourceNames(tiles, sourceNames);
    expect(result[0].name).toBe('ugc-correct.svg');
  });

  it('returns same array when sourceNames is empty', () => {
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, []);
    expect(result).toBe(tiles);
    expect(result[0].name).toBeUndefined();
  });

  it('uses file sourceNames order so UGC index 0 is UGC name not built-in', () => {
    const fileSourceNames = [
      'tileset-123:ugc_0.svg',
      'tileset-123:ugc_1.svg',
      'tile_00000000.svg',
    ];
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, fileSourceNames);
    expect(result[0].name).toBe('tileset-123:ugc_0.svg');
    expect(result[1].name).toBe('tileset-123:ugc_1.svg');
  });
});

describe('normalizeTiles', () => {
  it('preserves tile.name when extending array', () => {
    const current: Tile[] = [
      {
        imageIndex: 1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        name: 'ugc.svg',
      },
    ];
    const result: Tile[] = normalizeTiles(current, 3, 10);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('ugc.svg');
    expect(result[1].name).toBe('ugc.svg');
    expect(result[2].name).toBe('ugc.svg');
  });
});

describe('resolveDisplaySource', () => {
  it('uses name-based resolution when tile.name is set (never index)', () => {
    const ugcName = 'tileset-123:ugc_0.svg';
    const tile: Tile = {
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      name: ugcName,
    };
    const byIndex = (i: number) => ({ name: i === 0 ? 'built-in-0.svg' : 'other.svg' });
    const byName = (name: string) => (name === ugcName ? { name: ugcName } : null);
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toEqual({ name: ugcName });
  });

  it('returns null when tile.name is set but resolveByName returns null (do not use index)', () => {
    const tile: Tile = {
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      name: 'ugc-tile.svg',
    };
    const byIndex = () => ({ name: 'wrong-built-in.svg' });
    const byName = () => null;
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toBeNull();
  });

  it('uses index when tile.name is not set', () => {
    const tile: Tile = {
      imageIndex: 1,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    };
    const byIndex = (i: number) => ({ name: `source-${i}.svg` });
    const byName = () => null;
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toEqual({ name: 'source-1.svg' });
  });
});

describe('getTileSourceIndexByName', () => {
  it('resolves index by name so UGC name finds UGC slot not built-in index', () => {
    const sources = [
      { name: 'tile_00000000.svg' },
      { name: 'tile_00000001.svg' },
      { name: 'tileset-123:ugc_0.svg' },
      { name: 'tileset-123:ugc_1.svg' },
    ];
    expect(getTileSourceIndexByName(sources, 'tileset-123:ugc_0.svg')).toBe(2);
    expect(getTileSourceIndexByName(sources, 'tileset-123:ugc_1.svg')).toBe(3);
    expect(getTileSourceIndexByName(sources, 'tile_00000000.svg')).toBe(0);
  });

  it('returns -1 when name is not in list', () => {
    const sources = [{ name: 'a.svg' }];
    expect(getTileSourceIndexByName(sources, 'missing.svg')).toBe(-1);
  });
});

describe('buildInitialTiles', () => {
  it('builds empty tiles with imageIndex -1', () => {
    const tiles: Tile[] = buildInitialTiles(4);
    expect(tiles).toHaveLength(4);
    tiles.forEach((t) => {
      expect(t.imageIndex).toBe(-1);
      expect(t.name).toBeUndefined();
    });
  });
});

describe('getSpiralCellOrder', () => {
  it('starts at upper-left (index 0) and goes right then down then up then inward', () => {
    const order = getSpiralCellOrder(4, 3);
    expect(order[0]).toBe(0);
    expect(order).toHaveLength(12);
    expect(order).toEqual([0, 1, 2, 3, 7, 11, 10, 9, 8, 4, 5, 6]);
  });

  it('returns empty for zero dimensions', () => {
    expect(getSpiralCellOrder(0, 3)).toEqual([]);
    expect(getSpiralCellOrder(2, 0)).toEqual([]);
  });

  it('covers every cell exactly once', () => {
    const cols = 5;
    const rows = 4;
    const order = getSpiralCellOrder(cols, rows);
    const set = new Set(order);
    expect(order).toHaveLength(cols * rows);
    expect(set.size).toBe(cols * rows);
    for (let i = 0; i < cols * rows; i += 1) {
      expect(set.has(i)).toBe(true);
    }
  });
});

describe('getSpiralCellOrderInRect', () => {
  it('returns spiral order within rect so selection edges act as borders', () => {
    const gridColumns = 6;
    const order = getSpiralCellOrderInRect(1, 1, 3, 4, gridColumns);
    expect(order).toHaveLength(12);
    expect(order[0]).toBe(1 * gridColumns + 1);
    const set = new Set(order);
    for (let row = 1; row <= 3; row += 1) {
      for (let col = 1; col <= 4; col += 1) {
        expect(set.has(row * gridColumns + col)).toBe(true);
      }
    }
    expect(set.size).toBe(12);
  });

  it('returns empty for invalid rect', () => {
    expect(getSpiralCellOrderInRect(2, 0, 1, 3, 4)).toEqual([]);
    expect(getSpiralCellOrderInRect(0, 2, 3, 1, 4)).toEqual([]);
  });

  it('returns only indices inside the zoom rect (no index outside)', () => {
    const gridColumns = 6;
    const minRow = 1;
    const minCol = 1;
    const maxRow = 4;
    const maxCol = 4;
    const order = getSpiralCellOrderInRect(minRow, minCol, maxRow, maxCol, gridColumns);
    const zoomSet = new Set(order);
    const totalCells = 6 * 6;
    for (let index = 0; index < totalCells; index += 1) {
      const row = Math.floor(index / gridColumns);
      const col = index % gridColumns;
      const inside =
        row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
      expect(zoomSet.has(index)).toBe(inside);
    }
  });
});

describe('zoom region flood invariant', () => {
  it('when only zoom-rect indices are modified, tiles outside zoom are unchanged', () => {
    const gridColumns = 6;
    const gridRows = 6;
    const totalCells = gridColumns * gridRows;
    const minRow = 1;
    const minCol = 1;
    const maxRow = 4;
    const maxCol = 4;
    const zoomIndices = new Set(
      getSpiralCellOrderInRect(minRow, minCol, maxRow, maxCol, gridColumns)
    );
    const beforeTiles = Array.from({ length: totalCells }, (_, i) => ({
      imageIndex: i % 3,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    }));
    const afterTiles = beforeTiles.map((t, i) =>
      zoomIndices.has(i)
        ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
        : { ...t }
    );
    for (let index = 0; index < totalCells; index += 1) {
      if (!zoomIndices.has(index)) {
        expect(afterTiles[index]).toEqual(beforeTiles[index]);
      }
    }
  });
});

describe('grid resolution level', () => {
  it('getMaxGridResolutionLevel returns 2 for 1×1 (partial cell at L2) and 0 for empty', () => {
    expect(getMaxGridResolutionLevel(1, 1)).toBe(2);
    expect(getMaxGridResolutionLevel(0, 8)).toBe(0);
    expect(getMaxGridResolutionLevel(10, 0)).toBe(0);
  });

  it('getMaxGridResolutionLevel: with partial cells; 10×8 and 8×8 max L4, 4×4 max L3', () => {
    expect(getMaxGridResolutionLevel(10, 8)).toBe(4);
    expect(getMaxGridResolutionLevel(8, 8)).toBe(4);
    expect(getMaxGridResolutionLevel(4, 4)).toBe(3);
  });

  it('getMaxGridResolutionLevel for 14×24: max level 4 (partial 8×8 cells fit)', () => {
    expect(getMaxGridResolutionLevel(14, 24)).toBe(4);
  });

  it('getMaxGridResolutionLevel: 10×1 and 1×8 have level 2 (partial cells with ≥50% overlap)', () => {
    expect(getMaxGridResolutionLevel(10, 1)).toBe(2);
    expect(getMaxGridResolutionLevel(1, 8)).toBe(2);
  });

  it('getGridLevelLinePositions level 1 matches tile boundaries', () => {
    const tileSize = 50;
    const gap = 0;
    const { verticalPx, horizontalPx } = getGridLevelLinePositions(4, 3, 1, tileSize, gap);
    expect(verticalPx).toEqual([50, 100, 150]);
    expect(horizontalPx).toEqual([50, 100]);
  });

  it('getGridLevelLinePositions level 2 for 10×8: center-out; center at 5,4; lines at 1,3,5,7,9 and 2,4,6', () => {
    const tileSize = 50;
    const gap = 0;
    const { verticalPx, horizontalPx } = getGridLevelLinePositions(10, 8, 2, tileSize, gap);
    // centerCol=5, centerRow=4, cellTiles=2. Vertical: 5±0,±2,±4 → 1,3,5,7,9. Horizontal: 4±0,±2 → 2,4,6.
    expect(verticalPx).toHaveLength(5);
    expect(verticalPx).toEqual([1 * 50, 3 * 50, 5 * 50, 7 * 50, 9 * 50]);
    expect(horizontalPx).toHaveLength(3);
    expect(horizontalPx).toEqual([2 * 50, 4 * 50, 6 * 50]);
  });

  it('getGridLevelLinePositions level 3 for 10×8: center-out; lines at 1,5,9 and 4 (center row)', () => {
    const tileSize = 50;
    const gap = 0;
    const { verticalPx, horizontalPx } = getGridLevelLinePositions(10, 8, 3, tileSize, gap);
    // centerCol=5, centerRow=4, cellTiles=4. Vertical: 5±0,±4 → 1,5,9. Horizontal: 4±0 → 4.
    expect(verticalPx).toEqual([1 * 50, 5 * 50, 9 * 50]);
    expect(horizontalPx).toEqual([4 * 50]);
  });

  it('getGridLevelLinePositions level 4 for 10×8: center line only (5 and 4)', () => {
    const { verticalPx, horizontalPx } = getGridLevelLinePositions(10, 8, 4, 50, 0);
    // cellTiles=8; center ± 8 is out of range. Only center 5 and 4.
    expect(verticalPx).toEqual([5 * 50]);
    expect(horizontalPx).toEqual([4 * 50]);
  });

  it('getLevelGridInfo level 2 for 10×8: 6×4 grid including partial edge cells', () => {
    const info = getLevelGridInfo(10, 8, 2);
    expect(info).not.toBeNull();
    expect(info!.levelCols).toBe(6);
    expect(info!.levelRows).toBe(4);
    expect(info!.cells).toHaveLength(24);
    // First cell is partial (only col 0 visible, full cell is [-1, 0])
    expect(info!.cells[0].minCol).toBe(0);
    expect(info!.cells[0].maxCol).toBe(0);
    expect(info!.cells[0].minRow).toBe(0);
    expect(info!.cells[0].maxRow).toBe(1);
    expect(info!.cells[0].isPartial).toBe(true);
    expect(info!.cells[0].fullMinCol).toBe(-1);
    expect(info!.cells[0].fullMaxCol).toBe(0);
    // Second cell (interior) is complete
    expect(info!.cells[1]).toEqual({ minCol: 1, maxCol: 2, minRow: 0, maxRow: 1 });
    expect(info!.cells[1].isPartial).toBeUndefined();
    // Last cell in first row is partial (col 9 visible, full cell is [9, 10])
    expect(info!.cells[5].minCol).toBe(9);
    expect(info!.cells[5].maxCol).toBe(9);
    expect(info!.cells[5].isPartial).toBe(true);
    expect(info!.cells[5].fullMaxCol).toBe(10);
  });

  it('getLevelGridInfo level 4 for 10×8: 2×2 grid of partial cells', () => {
    const info = getLevelGridInfo(10, 8, 4);
    expect(info).not.toBeNull();
    expect(info!.levelCols).toBe(2);
    expect(info!.levelRows).toBe(2);
    expect(info!.cells).toHaveLength(4);
    // All cells are partial (8×8 cells don't fully fit in 10×8)
    for (const cell of info!.cells) {
      expect(cell.isPartial).toBe(true);
    }
  });
});

describe('getLevelCellIndexForPoint', () => {
  const tileSize = 10;
  const gridGap = 2;
  const level1Rows = 8;

  it('returns level-2 cell index when point is inside a cell (including partial)', () => {
    const info = getLevelGridInfo(10, 8, 2)!;
    // Cell at index 0 is now partial (col 0 only); cell at index 1 is the old first complete cell (cols 1-2)
    expect(info.cells[1].minCol).toBe(1);
    expect(info.cells[1].maxCol).toBe(2);
    const stride = tileSize + gridGap;
    const left1 = 1 * stride;
    const top0 = 0 * stride;
    expect(getLevelCellIndexForPoint(left1, top0, info, tileSize, gridGap, level1Rows)).toBe(1);
    expect(getLevelCellIndexForPoint(left1 + 5, top0 + 5, info, tileSize, gridGap, level1Rows)).toBe(1);
  });

  it('returns index for partial edge cell when point is in visible bounds', () => {
    const info = getLevelGridInfo(10, 8, 2)!;
    // Cell at index 0 is partial: minCol=0, maxCol=0 (visible portion only)
    expect(info.cells[0].minCol).toBe(0);
    expect(info.cells[0].isPartial).toBe(true);
    const stride = tileSize + gridGap;
    // Click at col 0 row 0 should hit the partial cell
    expect(getLevelCellIndexForPoint(0, 0, info, tileSize, gridGap, level1Rows)).toBe(0);
  });

  it('assigns horizontal mirror boundary row to cell above (20×16 level 3)', () => {
    const info = getLevelGridInfo(20, 16, 3)!;
    // 20×16 L3: centerCol=10, centerRow=8, cellTiles=4
    // With partials the grid may be larger, but the mirror boundary logic should still work
    expect(info.levelRows).toBeGreaterThanOrEqual(4);
    const stride = tileSize + gridGap;
    const centerRow = Math.floor(16 / 2);
    const boundaryY = centerRow * stride;
    const level1Rows = 16;
    const tileSizeL3 = 10;
    const xCenter = 10 * stride;
    const cellAbove = getLevelCellIndexForPoint(xCenter, boundaryY, info, tileSizeL3, gridGap, level1Rows);
    expect(cellAbove).not.toBeNull();
    // The cell should be in a row above the center
    const rowAbove = Math.floor(cellAbove! / info.levelCols);
    expect(rowAbove).toBeLessThan(info.levelRows / 2);
  });
});

describe('zoomRegionHasPartialCellsAtLevel', () => {
  const cols = 10;
  const rows = 8;
  // 10×8: centerCol=5, centerRow=4. Level 2 cellTiles=2; level 3 cellTiles=4.

  it('returns false for level 1 (always full tiles in zoom)', () => {
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 5 }, cols, rows, 1)).toBe(false);
  });

  it('returns false when zoom aligns to level-2 grid (2×2)', () => {
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 1, minCol: 1, maxCol: 2 }, cols, rows, 2)).toBe(false);
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 4, maxRow: 5, minCol: 5, maxCol: 6 }, cols, rows, 2)).toBe(false);
  });

  it('returns true when zoom cuts through level-2 cells', () => {
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 1, minCol: 0, maxCol: 1 }, cols, rows, 2)).toBe(true);
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 2, minCol: 1, maxCol: 2 }, cols, rows, 2)).toBe(true);
  });

  it('returns false when zoom aligns to level-3 grid (4×4)', () => {
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 3, minCol: 1, maxCol: 4 }, cols, rows, 3)).toBe(false);
  });

  it('returns true when zoom cuts through level-3 cells', () => {
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 2, minCol: 1, maxCol: 4 }, cols, rows, 3)).toBe(true);
    expect(zoomRegionHasPartialCellsAtLevel({ minRow: 0, maxRow: 3, minCol: 0, maxCol: 3 }, cols, rows, 3)).toBe(true);
  });
});

describe('getLevelKRange', () => {
  it('returns correct range for even grid (no partials)', () => {
    // 8 cols, center=4, cellTiles=2: cells at k=-2,-1,0,1 all complete
    const range = getLevelKRange(4, 8, 2);
    expect(range).toEqual({ kMin: -2, kMax: 1 });
  });

  it('includes partial cells with ≥50% overlap', () => {
    // 10 cols, center=5, cellTiles=2:
    // k=-3: start=-1, end=0, overlap=1/2=50% → included (partial)
    // k=2: start=9, end=10, overlap=1/2=50% → included (partial)
    const range = getLevelKRange(5, 10, 2);
    expect(range).toEqual({ kMin: -3, kMax: 2 });
  });

  it('excludes cells with <50% overlap', () => {
    // 10 cols, center=5, cellTiles=4:
    // k=-2: start=-3, end=0, overlap=1/4=25% → excluded
    // k=1: start=9, end=12, overlap=1/4=25% → excluded
    const range = getLevelKRange(5, 10, 4);
    expect(range).toEqual({ kMin: -1, kMax: 0 });
  });

  it('returns null for empty dimensions', () => {
    expect(getLevelKRange(0, 0, 2)).toBeNull();
  });

  it('handles single-tile dimension (1 col, center=0, cellTiles=2: 50% overlap)', () => {
    const range = getLevelKRange(0, 1, 2);
    expect(range).not.toBeNull();
    expect(range!.kMax - range!.kMin + 1).toBe(1); // exactly 1 cell
  });
});

describe('partial cell bounds', () => {
  it('partial cells have full* bounds and isPartial flag', () => {
    const info = getLevelGridInfo(10, 8, 2)!;
    // First cell (left edge): partial
    const c0 = info.cells[0];
    expect(c0.isPartial).toBe(true);
    expect(c0.minCol).toBe(0);
    expect(c0.fullMinCol).toBe(-1);
    expect(c0.fullMaxCol).toBe(0);
    // Interior cell: not partial
    const c1 = info.cells[1];
    expect(c1.isPartial).toBeUndefined();
    expect(c1.fullMinCol).toBeUndefined();
  });

  it('even grid has no partial cells', () => {
    // 8×8 level 2: center=4, cellTiles=2, all cells complete
    const info = getLevelGridInfo(8, 8, 2)!;
    for (const cell of info.cells) {
      expect(cell.isPartial).toBeUndefined();
    }
  });

  it('9×9 level 2 has partial edges', () => {
    const info = getLevelGridInfo(9, 9, 2)!;
    // center=4, cellTiles=2
    // k=-2: [0,1] complete; k=-1: [2,3] complete; k=0: [4,5] complete; k=1: [6,7] complete; k=2: [8,9] clamp→[8,8] partial
    expect(info.levelCols).toBe(5);
    expect(info.levelRows).toBe(5);
    // Last col cells are partial
    const lastColCell = info.cells[4]; // row 0, col 4
    expect(lastColCell.isPartial).toBe(true);
    expect(lastColCell.minCol).toBe(8);
    expect(lastColCell.maxCol).toBe(8);
    expect(lastColCell.fullMaxCol).toBe(9);
  });
});

describe('migrateLegacyLayerTiles', () => {
  it('remaps old complete-only tiles to expanded grid with empty partials', () => {
    // 10×8, level 2: old grid was 4×4=16 cells, new is 6×4=24 cells
    const oldTiles: Tile[] = Array.from({ length: 16 }, (_, i) => ({
      imageIndex: i,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    }));
    const result = migrateLegacyLayerTiles(oldTiles, 10, 8, 2);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(24);
    // Old cell (0,0) should map to new cell at offset (1, 0) in new grid (6 cols)
    // because new kMinV = -3, old kMinV = -2, offset = -2 - (-3) = 1
    expect(result![0 * 6 + 1].imageIndex).toBe(0); // old index 0 → new col 1
    expect(result![0 * 6 + 0].imageIndex).toBe(-1); // new partial cell → empty
    // Last old cell (row 3, col 3) → new (row 3, col 4)
    expect(result![3 * 6 + 4].imageIndex).toBe(15);
    // New right-edge partial → empty
    expect(result![0 * 6 + 5].imageIndex).toBe(-1);
  });

  it('returns null when tiles already match new grid size', () => {
    const newInfo = getLevelGridInfo(10, 8, 2)!;
    const tiles: Tile[] = Array.from({ length: newInfo.cells.length }, () => ({
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    }));
    expect(migrateLegacyLayerTiles(tiles, 10, 8, 2)).toBeNull();
  });

  it('returns null for level 1', () => {
    expect(migrateLegacyLayerTiles([], 10, 8, 1)).toBeNull();
  });
});

describe('migrateLegacyLockedCells', () => {
  it('remaps old locked cell indices to new expanded grid', () => {
    // 10×8, level 2: old 4 cols, new 6 cols. Offset: col+1, row+0.
    // Old index 0 (row 0, col 0) → new index 0*6+1 = 1
    const result = migrateLegacyLockedCells([0, 5], 10, 8, 2);
    expect(result).not.toBeNull();
    // Old index 5 = row 1, col 1 → new row 1, col 2 = 1*6+2 = 8
    expect(result).toContain(1);
    expect(result).toContain(8);
  });
});
