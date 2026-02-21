import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { validateDrawStroke } from '@/utils/draw-stroke';
import { buildCompatibilityTables } from '@/utils/tile-compat';
import {
    displayToPatternCell,
    getRotatedDimensions,
} from '@/utils/pattern-transform';
import {
    applyGroupRotationToTile,
    normalizeRotationCW,
    rotateCell,
} from '@/utils/tile-group-rotate';
import {
    buildInitialTiles,
    computeFixedGridLayout,
    computeGridLayout,
    getSpiralCellOrder,
    getSpiralCellOrderInRect,
    getTileSourceIndexByName,
    MAX_TILE_CANVAS_CELLS,
    normalizeTiles,
    type GridLayout,
    type Tile
} from '@/utils/tile-grid';

type Params = {
  tileSources: TileSource[];
  availableWidth: number;
  availableHeight: number;
  gridGap: number;
  preferredTileSize: number;
  allowEdgeConnections: boolean;
  suspendRemap?: boolean;
  randomRequiresLegal?: boolean;
  randomSourceIndices?: number[];
  fixedRows?: number;
  fixedColumns?: number;
  brush:
    | { mode: 'random' }
    | { mode: 'draw' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'pattern' }
    | {
        mode: 'fixed';
        index: number;
        sourceName?: string;
        rotation: number;
        mirrorX: boolean;
        mirrorY: boolean;
      };
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
  pattern:
    | { tiles: Tile[]; width: number; height: number; rotation: number; mirrorX: boolean }
    | null;
  patternAnchorKey?: string | null;
  getFixedBrushSourceName?: () => string | null;
  onFixedPlacementDebug?: (payload: {
    fixedIndex: number;
    tileName: string | null;
    tileSourcesLength: number;
    getterResult?: string | null;
    brushSourceName?: string | null;
  }) => void;
  /** When set, clear/flood/reconcile apply only to cells in this rect (start/end cell indices). */
  canvasSelection?: { start: number; end: number } | null;
  /** Locked cell indices. Tiles at these indices cannot be modified. */
  lockedCells?: number[] | null;
  /** When true, handlePress does not push undo (caller pushes once at drag start via pushUndoForDragStart). */
  isPartOfDragRef?: MutableRefObject<boolean>;
  /** When set, the canvas displays only this region (zoom in). Bounds are in full-grid row/col. All edits apply to full grid; mirror is within zoom region. */
  zoomRegion?: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
  /** @deprecated Unused; zoom uses bounds and fullGridLayout. */
  fullGridColumns?: number;
  /** @deprecated Unused; zoom uses bounds and fullGridLayout. */
  fullGridRows?: number;
};

const MAX_UNDO_STEPS = 50;

type Result = {
  gridLayout: GridLayout;
  tiles: Tile[];
  handlePress: (cellIndex: number) => void;
  randomFill: () => void;
  floodFill: () => void;
  floodComplete: () => void;
  reconcileTiles: () => void;
  controlledRandomize: () => void;
  resetTiles: () => void;
  loadTiles: (nextTiles: Tile[]) => void;
  undo: () => void;
  redo: () => void;
  /** Call once at drag start so the whole stroke is one undo step. */
  pushUndoForDragStart: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearCloneSource: () => void;
  setCloneSource: (cellIndex: number) => void;
  cloneSourceIndex: number | null;
  cloneSampleIndex: number | null;
  cloneAnchorIndex: number | null;
  cloneCursorIndex: number | null;
  totalCells: number;
  /** Call when pointer/touch releases so the next draw stroke starts fresh. */
  clearDrawStroke: () => void;
  /** When zoomed, the effective full grid dimensions (may be capped). Use for visible↔full index mapping in the app. */
  fullGridColumnsForZoom?: number;
  fullGridRowsForZoom?: number;
  /** Move a region: copy tiles from fromIndices to toIndices, clear fromIndices. Same length; respects locked cells. One undo step. */
  moveRegion: (fromIndices: number[], toIndices: number[]) => void;
  /** Rotate the rectangular region 90° clockwise. Bounds in full-grid row/col. One undo step. */
  rotateRegion: (minRow: number, maxRow: number, minCol: number, maxCol: number, gridColumns: number) => void;
  /** Full-grid tiles for persisting; use this (not tiles) when saving so zoomed view never overwrites file. */
  fullTilesForSave: Tile[];
  /** Full-grid layout for persisting; use this (not gridLayout) when saving so zoomed view never overwrites file. */
  fullGridLayoutForSave: GridLayout;
  /** When zoomed and mirror is on: copy zoom region to mirror targets on the full grid (one undo step). No-op if not zoomed or no mirror. */
  mirrorZoomRegionToRestOfGrid: () => void;
};

const toConnectionKey = (connections: boolean[] | null) =>
  connections ? connections.map((value) => (value ? '1' : '0')).join('') : null;

export const useTileGrid = ({
  tileSources,
  availableWidth,
  availableHeight,
  gridGap,
  preferredTileSize,
  allowEdgeConnections,
  suspendRemap = false,
  randomRequiresLegal = false,
  randomSourceIndices,
  fixedRows,
  fixedColumns,
  brush,
  mirrorHorizontal,
  mirrorVertical,
  pattern,
  patternAnchorKey,
  getFixedBrushSourceName,
  onFixedPlacementDebug,
  canvasSelection = null,
  lockedCells = null,
  isPartOfDragRef,
  zoomRegion = null,
  fullGridColumns,
  fullGridRows,
}: Params): Result => {
  const clearLogRef = useRef<{ clearId: number } | null>(null);
  const previousTileSourcesRef = useRef<TileSource[] | null>(null);
  const previousTileSourcesKeyRef = useRef<string | null>(null);
  const tileSourcesLength = tileSources.length;
  const tileSourcesKey = useMemo(
    () => tileSources.map((source) => source.name).join('|'),
    [tileSources]
  );
  const randomSourceSet = useMemo(() => {
    if (!randomSourceIndices || randomSourceIndices.length === 0) {
      return null;
    }
    return new Set(randomSourceIndices);
  }, [randomSourceIndices]);

  const fullGridLayout = useMemo(() => {
    if (fixedRows && fixedColumns) {
      return computeFixedGridLayout(
        availableWidth,
        availableHeight,
        gridGap,
        fixedRows,
        fixedColumns
      );
    }
    return computeGridLayout(availableWidth, availableHeight, gridGap, preferredTileSize);
  }, [
    availableHeight,
    availableWidth,
    gridGap,
    preferredTileSize,
    fixedRows,
    fixedColumns,
  ]);
  const isZoomed = !!(
    zoomRegion &&
    fullGridLayout.columns > 0 &&
    fullGridLayout.rows > 0 &&
    zoomRegion.minRow <= zoomRegion.maxRow &&
    zoomRegion.minCol <= zoomRegion.maxCol
  );
  const zoomBounds = isZoomed && zoomRegion ? zoomRegion : null;
  const zoomRows = zoomBounds
    ? zoomBounds.maxRow - zoomBounds.minRow + 1
    : 0;
  const zoomCols = zoomBounds
    ? zoomBounds.maxCol - zoomBounds.minCol + 1
    : 0;
  const displayGridLayout = useMemo((): GridLayout => {
    if (isZoomed && zoomRows > 0 && zoomCols > 0) {
      return computeFixedGridLayout(
        availableWidth,
        availableHeight,
        gridGap,
        zoomRows,
        zoomCols
      );
    }
    return fullGridLayout;
  }, [isZoomed, zoomRows, zoomCols, availableWidth, availableHeight, gridGap, fullGridLayout]);
  const gridLayout = displayGridLayout;

  const internalTotalCells = Math.min(
    fullGridLayout.rows * fullGridLayout.columns,
    MAX_TILE_CANVAS_CELLS
  );
  const displayTotalCells = isZoomed
    ? Math.min(zoomRows * zoomCols, MAX_TILE_CANVAS_CELLS)
    : internalTotalCells;
  const totalCells = displayTotalCells;

  const visibleToFull = useCallback(
    (visibleIndex: number): number => {
      if (!isZoomed || !zoomBounds) return visibleIndex;
      const visibleRow = Math.floor(visibleIndex / zoomCols);
      const visibleCol = visibleIndex % zoomCols;
      const fullRow = zoomBounds.minRow + visibleRow;
      const fullCol = zoomBounds.minCol + visibleCol;
      return fullRow * fullGridLayout.columns + fullCol;
    },
    [isZoomed, zoomBounds, zoomCols, fullGridLayout.columns]
  );
  const fullToVisible = useCallback(
    (fullIndex: number): number | null => {
      if (!isZoomed || !zoomBounds) return fullIndex;
      const fullRow = Math.floor(fullIndex / fullGridLayout.columns);
      const fullCol = fullIndex % fullGridLayout.columns;
      if (
        fullRow < zoomBounds.minRow ||
        fullRow > zoomBounds.maxRow ||
        fullCol < zoomBounds.minCol ||
        fullCol > zoomBounds.maxCol
      ) {
        return null;
      }
      const visibleRow = fullRow - zoomBounds.minRow;
      const visibleCol = fullCol - zoomBounds.minCol;
      return visibleRow * zoomCols + visibleCol;
    },
    [isZoomed, zoomBounds, zoomCols, fullGridLayout.columns]
  );

  const selectionBounds = useMemo(() => {
    if (!canvasSelection || fullGridLayout.columns === 0) {
      return null;
    }
    const startRow = Math.floor(canvasSelection.start / fullGridLayout.columns);
    const startCol = canvasSelection.start % fullGridLayout.columns;
    const endRow = Math.floor(canvasSelection.end / fullGridLayout.columns);
    const endCol = canvasSelection.end % fullGridLayout.columns;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    if (isZoomed && zoomBounds) {
      const clampedMinRow = Math.max(minRow, zoomBounds.minRow);
      const clampedMaxRow = Math.min(maxRow, zoomBounds.maxRow);
      const clampedMinCol = Math.max(minCol, zoomBounds.minCol);
      const clampedMaxCol = Math.min(maxCol, zoomBounds.maxCol);
      if (clampedMinRow > clampedMaxRow || clampedMinCol > clampedMaxCol) {
        return null;
      }
      return {
        minRow: clampedMinRow,
        maxRow: clampedMaxRow,
        minCol: clampedMinCol,
        maxCol: clampedMaxCol,
      };
    }
    return { minRow, maxRow, minCol, maxCol };
  }, [isZoomed, zoomBounds, canvasSelection, fullGridLayout.columns]);

  const lockedCellIndices = useMemo(() => {
    if (!lockedCells?.length) {
      return null;
    }
    return new Set(lockedCells);
  }, [lockedCells]);

  const modifiableIndicesSet = useMemo(() => {
    const cols = isZoomed ? fullGridLayout.columns : gridLayout.columns;
    const rows = isZoomed && zoomBounds ? zoomBounds.maxRow - zoomBounds.minRow + 1 : gridLayout.rows;
    const maxR = mirrorVertical ? Math.floor(rows / 2) : rows;
    const maxC = mirrorHorizontal ? Math.floor(cols / 2) : cols;
    const set = new Set<number>();
    if (selectionBounds) {
      const { minRow, maxRow, minCol, maxCol } = selectionBounds;
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const index = row * cols + col;
          if (!lockedCellIndices?.has(index)) set.add(index);
        }
      }
    } else if (isZoomed && zoomBounds) {
      const zoomRows = zoomBounds.maxRow - zoomBounds.minRow + 1;
      const zoomCols = zoomBounds.maxCol - zoomBounds.minCol + 1;
      const maxRZoom = mirrorVertical ? Math.floor(zoomRows / 2) : zoomRows;
      const maxCZoom = mirrorHorizontal ? Math.floor(zoomCols / 2) : zoomCols;
      for (let row = 0; row < maxRZoom; row += 1) {
        for (let col = 0; col < maxCZoom; col += 1) {
          const fullRow = zoomBounds.minRow + row;
          const fullCol = zoomBounds.minCol + col;
          const index = fullRow * fullGridLayout.columns + fullCol;
          if (!lockedCellIndices?.has(index)) set.add(index);
        }
      }
    } else {
      for (let row = 0; row < maxR; row += 1) {
        for (let col = 0; col < maxC; col += 1) {
          const index = row * cols + col;
          if (!lockedCellIndices?.has(index)) set.add(index);
        }
      }
    }
    return set;
  }, [
    selectionBounds,
    lockedCellIndices,
    gridLayout.rows,
    gridLayout.columns,
    mirrorHorizontal,
    mirrorVertical,
    isZoomed,
    fullGridLayout.columns,
    zoomBounds,
  ]);

  const modifiableIndicesArray = useMemo(() => Array.from(modifiableIndicesSet), [modifiableIndicesSet]);

  /** All non-locked indices (full grid or zoom region). Used when mirror is on so mirrored placements can write to the mirror half. */
  const allNonLockedIndicesSet = useMemo(() => {
    const set = new Set<number>();
    if (isZoomed && zoomBounds) {
      for (let r = zoomBounds.minRow; r <= zoomBounds.maxRow; r += 1) {
        for (let c = zoomBounds.minCol; c <= zoomBounds.maxCol; c += 1) {
          const i = r * fullGridLayout.columns + c;
          if (!lockedCellIndices?.has(i)) set.add(i);
        }
      }
    } else {
      for (let i = 0; i < internalTotalCells; i += 1) {
        if (!lockedCellIndices?.has(i)) set.add(i);
      }
    }
    return set;
  }, [internalTotalCells, isZoomed, zoomBounds, fullGridLayout.columns, lockedCellIndices]);

  /** Allow set for writing draw/placement results: full grid when mirror on (so mirror targets get written), else modifiable only. */
  const drawPlacementAllowSet = useMemo(
    () =>
      mirrorHorizontal || mirrorVertical
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet,
    [
      mirrorHorizontal,
      mirrorVertical,
      lockedCellIndices,
      allNonLockedIndicesSet,
      modifiableIndicesSet,
    ]
  );

  const [tiles, setTiles] = useState<Tile[]>(() =>
    buildInitialTiles(internalTotalCells)
  );
  const lastPressRef = useRef<{
    cellIndex: number;
    imageIndex: number;
    rotation: number;
    mirrorX: boolean;
    mirrorY: boolean;
    time: number;
  } | null>(null);
  const cloneSourceRef = useRef<number | null>(null);
  const [cloneSourceIndex, setCloneSourceIndex] = useState<number | null>(null);
  const cloneAnchorRef = useRef<number | null>(null);
  const [cloneSampleIndex, setCloneSampleIndex] = useState<number | null>(null);
  const [cloneAnchorIndex, setCloneAnchorIndex] = useState<number | null>(null);
  const [cloneCursorIndex, setCloneCursorIndex] = useState<number | null>(null);
  const patternAnchorRef = useRef<number | null>(null);
  const drawStrokeRef = useRef<number[]>([]);
  const placementOrderRef = useRef(0);

  const getNextPlacementOrder = () => {
    placementOrderRef.current += 1;
    return placementOrderRef.current;
  };

  const renderTiles = useMemo(
    () => normalizeTiles(tiles, internalTotalCells, tileSourcesLength),
    [tiles, internalTotalCells, tileSourcesLength]
  );
  const lastTilesRef = useRef<Tile[]>(renderTiles);
  lastTilesRef.current = renderTiles;

  const undoStackRef = useRef<Tile[][]>([]);
  const redoStackRef = useRef<Tile[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const isUndoRedoRef = useRef(false);
  const bulkUpdateRef = useRef(false);

  const withBulkUpdate = (fn: () => void) => {
    bulkUpdateRef.current = true;
    fn();
    requestAnimationFrame(() => {
      bulkUpdateRef.current = false;
    });
  };

  const tilesEqual = (left: Tile[], right: Tile[]) => {
    if (left === right) {
      return true;
    }
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i += 1) {
      const a = left[i];
      const b = right[i];
      if (
        a.imageIndex !== b.imageIndex ||
        a.rotation !== b.rotation ||
        a.mirrorX !== b.mirrorX ||
        a.mirrorY !== b.mirrorY ||
        (a.placedOrder ?? 0) !== (b.placedOrder ?? 0)
      ) {
        return false;
      }
    }
    return true;
  };

  const markClear = () => {
    clearLogRef.current = { clearId: Date.now() };
  };

  const logClearApply = (_changed: number, _total: number) => {
    // no-op (logging removed)
  };

  const clearLogDone = () => {
    clearLogRef.current = null;
  };

  const pushUndo = useCallback(() => {
    if (isUndoRedoRef.current) {
      return;
    }
    const snapshot = lastTilesRef.current.map((t) => ({
      ...t,
      name: t.name,
    }));
    const stack = undoStackRef.current;
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    if (top && tilesEqual(snapshot, top)) {
      return;
    }
    if (stack.length >= MAX_UNDO_STEPS) {
      stack.shift();
    }
    stack.push(snapshot);
    redoStackRef.current = [];
    setUndoCount(stack.length);
    setRedoCount(0);
  }, []);

  const applyTilesInternal = useCallback(
    (nextTiles: Tile[]) => {
      setTiles((prev) => {
        const normalizedNext = normalizeTiles(nextTiles, internalTotalCells, tileSourcesLength);
        const normalizedPrev = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
        if (tilesEqual(normalizedPrev, normalizedNext)) {
          return prev;
        }
        let changed = 0;
        for (let i = 0; i < normalizedPrev.length; i += 1) {
          const a = normalizedPrev[i];
          const b = normalizedNext[i];
          if (
            a.imageIndex !== b.imageIndex ||
            a.rotation !== b.rotation ||
            a.mirrorX !== b.mirrorX ||
            a.mirrorY !== b.mirrorY ||
            (a.placedOrder ?? 0) !== (b.placedOrder ?? 0)
          ) {
            changed += 1;
          }
        }
        logClearApply(changed, normalizedNext.length);
        return normalizedNext;
      });
    },
    [internalTotalCells, tileSourcesLength]
  );

  const applyTiles = useCallback(
    (nextTiles: Tile[]) => {
      if (!isUndoRedoRef.current) {
        pushUndo();
      }
      applyTilesInternal(nextTiles);
    },
    [pushUndo, applyTilesInternal]
  );

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) {
      return;
    }
    isUndoRedoRef.current = true;
    setTiles((prev) => {
      const prevNorm = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
      let next: Tile[] | undefined;
      while (stack.length > 0) {
        next = stack.pop();
        if (next && !tilesEqual(prevNorm, next)) {
          break;
        }
        next = undefined;
      }
      if (!next) {
        return prev;
      }
      redoStackRef.current.push(
        prevNorm.map((t) => ({ ...t, name: t.name }))
      );
      setUndoCount(undoStackRef.current.length);
      setRedoCount(redoStackRef.current.length);
      return normalizeTiles(next, internalTotalCells, tileSourcesLength);
    });
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }, [internalTotalCells, tileSourcesLength]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) {
      return;
    }
    isUndoRedoRef.current = true;
    setTiles((prev) => {
      const prevNorm = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
      let next: Tile[] | undefined;
      while (stack.length > 0) {
        next = stack.pop();
        if (next && !tilesEqual(prevNorm, next)) {
          break;
        }
        next = undefined;
      }
      if (!next) {
        return prev;
      }
      undoStackRef.current.push(
        prevNorm.map((t) => ({ ...t, name: t.name }))
      );
      setUndoCount(undoStackRef.current.length);
      setRedoCount(redoStackRef.current.length);
      return normalizeTiles(next, internalTotalCells, tileSourcesLength);
    });
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }, [internalTotalCells, tileSourcesLength]);

  useEffect(() => {
    setTiles((prev) => (prev.length === internalTotalCells ? prev : buildInitialTiles(internalTotalCells)));
  }, [internalTotalCells]);

  const clearCloneSource = useCallback(() => {
    cloneAnchorRef.current = null;
    cloneSourceRef.current = null;
    setCloneSourceIndex(null);
    setCloneSampleIndex(null);
    setCloneAnchorIndex(null);
    setCloneCursorIndex(null);
  }, []);

  useEffect(() => {
    if (brush.mode !== 'clone') {
      cloneAnchorRef.current = null;
      setCloneSampleIndex(null);
      setCloneAnchorIndex(null);
      setCloneCursorIndex(null);
      return;
    }
    clearCloneSource();
  }, [brush.mode]);

  useEffect(() => {
    if (brush.mode !== 'pattern') {
      patternAnchorRef.current = null;
      return;
    }
    patternAnchorRef.current = null;
  }, [brush.mode, patternAnchorKey]);

  useEffect(() => {
    if (brush.mode !== 'draw') {
      drawStrokeRef.current = [];
    }
  }, [brush.mode]);

  const compatTables = useMemo(
    () => buildCompatibilityTables(tileSources),
    [tileSourcesKey]
  );
  const connectionsByIndex = compatTables.connectionsByIndex;

  /** Resolve tile to index in current tileSources for connection lookup. Pattern-placed tiles may have imageIndex from pattern context; name is authoritative for display and must be used so connection logic matches the visible tile. */
  const getEffectiveConnectionIndex = (tile: Tile): number => {
    if (!tile || tile.imageIndex < 0) return -1;
    if (tile.name != null && tile.name !== '') {
      const byName = getTileSourceIndexByName(tileSources, tile.name);
      if (byName >= 0) return byName;
    }
    return tile.imageIndex;
  };

  const getPairsForDirection = (index: number) => {
    switch (index) {
      case 0: // N
        return [[0, 4]] as Array<[number, number]>;
      case 1: // NE
        return [[1, 5]] as Array<[number, number]>;
      case 2: // E
        return [[2, 6]] as Array<[number, number]>;
      case 3: // SE
        return [[3, 7]] as Array<[number, number]>;
      case 4: // S
        return [[4, 0]] as Array<[number, number]>;
      case 5: // SW
        return [[5, 1]] as Array<[number, number]>;
      case 6: // W
        return [[6, 2]] as Array<[number, number]>;
      case 7: // NW
        return [[7, 3]] as Array<[number, number]>;
      default:
        return [];
    }
  };

  /** Direction 0..7 from fromCell to toCell (N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7). Returns -1 if not adjacent. */
  const getDirectionFromTo = (fromCell: number, toCell: number): number => {
    const cols = isZoomed ? fullGridLayout.columns : gridLayout.columns;
    const fromRow = Math.floor(fromCell / cols);
    const fromCol = fromCell % cols;
    const toRow = Math.floor(toCell / cols);
    const toCol = toCell % cols;
    const dr = toRow - fromRow;
    const dc = toCol - fromCol;
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1) {
      return -1;
    }
    const n = dr === -1 && dc === 0 ? 0 : undefined;
    const ne = dr === -1 && dc === 1 ? 1 : undefined;
    const e = dr === 0 && dc === 1 ? 2 : undefined;
    const se = dr === 1 && dc === 1 ? 3 : undefined;
    const s = dr === 1 && dc === 0 ? 4 : undefined;
    const sw = dr === 1 && dc === -1 ? 5 : undefined;
    const w = dr === 0 && dc === -1 ? 6 : undefined;
    const nw = dr === -1 && dc === -1 ? 7 : undefined;
    const d = n ?? ne ?? e ?? se ?? s ?? sw ?? w ?? nw;
    return d ?? -1;
  };

  const isStrokeValid = (strokeOrder: number[], tilesState: Tile[]): boolean =>
    validateDrawStroke(
      strokeOrder,
      tilesState,
      placementCols,
      (index, rotation, mirrorX, mirrorY) =>
        compatTables.getConnectionsForPlacement(index, rotation, mirrorX, mirrorY)
    );

  /** All variants (from allowed indices or all) that have exactly n connections. */
  const getCandidatesWithConnectionCount = (
    n: number,
    allowedIndices: Set<number> | null
  ): Tile[] => {
    const candidates: Tile[] = [];
    connectionsByIndex.forEach((_, imageIndex) => {
      if (allowedIndices && !allowedIndices.has(imageIndex)) return;
      const variants = compatTables.variantsByIndex[imageIndex] ?? [];
      variants.forEach((variant) => {
        const count = variant.connections.filter(Boolean).length;
        if (count !== n) return;
        candidates.push({
          imageIndex,
          rotation: variant.rotation,
          mirrorX: variant.mirrorX,
          mirrorY: variant.mirrorY,
          name: tileSources[imageIndex]?.name,
        });
      });
    });
    return candidates;
  };

  /** Candidates that have exactly two connections, one of which is requiredDirection (0..7). */
  const getCandidatesWithTwoConnectionsOneBeing = (
    requiredDirection: number,
    allowedIndices: Set<number> | null
  ): Tile[] => {
    const candidates: Tile[] = [];
    connectionsByIndex.forEach((_, imageIndex) => {
      if (allowedIndices && !allowedIndices.has(imageIndex)) return;
      const variants = compatTables.variantsByIndex[imageIndex] ?? [];
      variants.forEach((variant) => {
        const conn = variant.connections;
        const count = conn.filter(Boolean).length;
        if (count !== 2 || !conn[requiredDirection]) return;
        candidates.push({
          imageIndex,
          rotation: variant.rotation,
          mirrorX: variant.mirrorX,
          mirrorY: variant.mirrorY,
          name: tileSources[imageIndex]?.name,
        });
      });
    });
    return candidates;
  };

  /** Candidates whose connections are true exactly in requiredTrueDirections (0..7) and false elsewhere. */
  const getCandidatesWithExactConnections = (
    requiredTrueDirections: Set<number>,
    allowedIndices: Set<number> | null
  ): Tile[] => {
    const candidates: Tile[] = [];
    connectionsByIndex.forEach((_, imageIndex) => {
      if (allowedIndices && !allowedIndices.has(imageIndex)) return;
      const variants = compatTables.variantsByIndex[imageIndex] ?? [];
      variants.forEach((variant) => {
        const conn = variant.connections;
        let match = true;
        for (let d = 0; d < 8; d += 1) {
          if (conn[d] !== requiredTrueDirections.has(d)) {
            match = false;
            break;
          }
        }
        if (match) {
          candidates.push({
            imageIndex,
            rotation: variant.rotation,
            mirrorX: variant.mirrorX,
            mirrorY: variant.mirrorY,
            name: tileSources[imageIndex]?.name,
          });
        }
      });
    });
    return candidates;
  };

  /** Layout for placement math: cellIndex and tilesState use full-grid coordinates, so we use full grid dimensions. */
  const placementCols = fullGridLayout.columns;
  const placementRows = fullGridLayout.rows;

  const buildCompatibleCandidates = (
    cellIndex: number,
    tilesState: Tile[],
    allowedIndices: Set<number> | null,
    treatUninitializedAsNoConnection = false,
    selectionSet?: Set<number> | null
  ) => {
    if (tileSourcesLength <= 0) {
      return [] as Tile[];
    }

    const row = Math.floor(cellIndex / placementCols);
    const col = cellIndex % placementCols;
    const directions = [
      { dr: -1, dc: 0 },
      { dr: -1, dc: 1 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: -1 },
      { dr: 0, dc: -1 },
      { dr: -1, dc: -1 },
    ];

    const neighborConstraints = directions
      .map((dir, index) => {
        const r = row + dir.dr;
        const c = col + dir.dc;
        if (r < 0 || c < 0 || r >= placementRows || c >= placementCols) {
          if (!allowEdgeConnections) {
            return { pairs: getPairsForDirection(index), connections: new Array(8).fill(false) };
          }
          return null;
        }
        const neighborIndex = r * placementCols + c;
        if (
          selectionSet &&
          !allowEdgeConnections &&
          !selectionSet.has(neighborIndex)
        ) {
          return { pairs: getPairsForDirection(index), connections: new Array(8).fill(false) };
        }
        const neighborTile = tilesState[neighborIndex];
        if (!neighborTile || neighborTile.imageIndex < 0) {
          if (treatUninitializedAsNoConnection) {
            return { pairs: getPairsForDirection(index), connections: new Array(8).fill(false) };
          }
          return null;
        }
        const effectiveIndex = getEffectiveConnectionIndex(neighborTile);
        if (effectiveIndex < 0) {
          if (treatUninitializedAsNoConnection) {
            return { pairs: getPairsForDirection(index), connections: new Array(8).fill(false) };
          }
          return null;
        }
        const neighborConnections = compatTables.getConnectionsForPlacement(
          effectiveIndex,
          neighborTile.rotation,
          neighborTile.mirrorX,
          neighborTile.mirrorY
        );
        if (!neighborConnections) {
          return null;
        }
        return { pairs: getPairsForDirection(index), connections: neighborConnections };
      })
      .filter(
        (value): value is { pairs: Array<[number, number]>; connections: boolean[] } =>
          Boolean(value)
      );

    const candidates: Array<Tile> = [];

    connectionsByIndex.forEach((connections, index) => {
      if (allowedIndices && !allowedIndices.has(index)) {
        return;
      }
      if (!connections) {
        candidates.push({
          imageIndex: index,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
          name: tileSources[index]?.name,
        });
        return;
      }
      const variants = compatTables.variantsByIndex[index] ?? [];
      variants.forEach((variant) => {
        const matches = neighborConstraints.every((constraint) =>
          constraint.pairs.every(
            ([candidateIndex, neighborIndex]) =>
              variant.connections[candidateIndex] ===
              constraint.connections[neighborIndex]
          )
        );
        if (matches) {
          candidates.push({
            imageIndex: index,
            rotation: variant.rotation,
            mirrorX: variant.mirrorX,
            mirrorY: variant.mirrorY,
            name: tileSources[index]?.name,
          });
        }
      });
    });

    return candidates;
  };

  const selectCompatibleTile = (
    cellIndex: number,
    tilesState: Tile[],
    allowedIndices: Set<number> | null,
    treatUninitializedAsNoConnection = false,
    selectionSet?: Set<number> | null
  ) => {
    const candidates = buildCompatibleCandidates(
      cellIndex,
      tilesState,
      allowedIndices,
      treatUninitializedAsNoConnection,
      selectionSet
    );
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  };

  const getInitializedNeighborCount = (cellIndex: number, tilesState: Tile[]) => {
    const row = Math.floor(cellIndex / placementCols);
    const col = cellIndex % placementCols;
    const directions = [
      { dr: -1, dc: 0 },
      { dr: -1, dc: 1 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: -1 },
      { dr: 0, dc: -1 },
      { dr: -1, dc: -1 },
    ];
    let count = 0;
    for (const dir of directions) {
      const r = row + dir.dr;
      const c = col + dir.dc;
      if (r < 0 || c < 0 || r >= placementRows || c >= placementCols) {
        continue;
      }
      const neighborIndex = r * placementCols + c;
      const neighborTile = tilesState[neighborIndex];
      if (neighborTile && neighborTile.imageIndex >= 0) {
        count += 1;
      }
    }
    return count;
  };

  const getRandomPlacement = (
    cellIndex: number,
    tilesState: Tile[],
    treatUninitializedAsNoConnection = false,
    selectionSet?: Set<number> | null
  ) => {
    const selection = selectCompatibleTile(
      cellIndex,
      tilesState,
      randomSourceSet,
      treatUninitializedAsNoConnection,
      selectionSet
    );
    if (
      selection &&
      isPlacementValid(
        cellIndex,
        selection,
        tilesState,
        treatUninitializedAsNoConnection,
        selectionSet
      )
    ) {
      return selection;
    }
    return randomRequiresLegal
      ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
      : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
  };

  const isPlacementValid = (
    cellIndex: number,
    placement: Tile,
    tilesState: Tile[],
    treatUninitializedAsNoConnection = false,
    selectionSet?: Set<number> | null
  ) => {
    const transformed = compatTables.getConnectionsForPlacement(
      placement.imageIndex,
      placement.rotation,
      placement.mirrorX,
      placement.mirrorY
    );
    if (!transformed) {
      return true;
    }

    const row = Math.floor(cellIndex / placementCols);
    const col = cellIndex % placementCols;
    const directions = [
      { dr: -1, dc: 0 },
      { dr: -1, dc: 1 },
      { dr: 0, dc: 1 },
      { dr: 1, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: -1 },
      { dr: 0, dc: -1 },
      { dr: -1, dc: -1 },
    ];

    return directions.every((dir, index) => {
      const r = row + dir.dr;
      const c = col + dir.dc;
      if (r < 0 || c < 0 || r >= placementRows || c >= placementCols) {
        if (!allowEdgeConnections) {
          return getPairsForDirection(index).every(
            ([candidateIndex]) => transformed[candidateIndex] === false
          );
        }
        return true;
      }
      const neighborIndex = r * placementCols + c;
      if (
        selectionSet &&
        !allowEdgeConnections &&
        !selectionSet.has(neighborIndex)
      ) {
        return getPairsForDirection(index).every(
          ([candidateIndex]) => transformed[candidateIndex] === false
        );
      }
      const neighborTile = tilesState[neighborIndex];
      if (!neighborTile || neighborTile.imageIndex < 0) {
        if (treatUninitializedAsNoConnection) {
          return getPairsForDirection(index).every(
            ([candidateIndex]) => transformed[candidateIndex] === false
          );
        }
        return true;
      }
      const effectiveIndex = getEffectiveConnectionIndex(neighborTile);
      if (effectiveIndex < 0) {
        if (treatUninitializedAsNoConnection) {
          return getPairsForDirection(index).every(
            ([candidateIndex]) => transformed[candidateIndex] === false
          );
        }
        return true;
      }
      const neighborTransformed = compatTables.getConnectionsForPlacement(
        effectiveIndex,
        neighborTile.rotation,
        neighborTile.mirrorX,
        neighborTile.mirrorY
      );
      if (!neighborTransformed) {
        return true;
      }

      return getPairsForDirection(index).every(
        ([candidateIndex, neighborIndexValue]) =>
          transformed[candidateIndex] === neighborTransformed[neighborIndexValue]
      );
    });
  };

  useEffect(() => {
    setTiles((prev) => normalizeTiles(prev, internalTotalCells, tileSourcesLength));
  }, [internalTotalCells, tileSourcesLength]);

  useEffect(() => {
    const previousKey = previousTileSourcesKeyRef.current;
    if (previousKey === tileSourcesKey) {
      return;
    }
    const previousSources = previousTileSourcesRef.current;
    previousTileSourcesRef.current = tileSources;
    previousTileSourcesKeyRef.current = tileSourcesKey;
    if (suspendRemap) {
      return;
    }
    if (!previousSources) {
      return;
    }

    if (tileSourcesLength === 0) {
      setTiles((prev) =>
        normalizeTiles(prev, internalTotalCells, previousSources.length).map((tile) =>
          tile.imageIndex >= 0 || tile.imageIndex === -2
            ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
            : tile
        )
      );
      return;
    }

    const nextLookup = compatTables.variantsByKey;
    const previousTables = buildCompatibilityTables(previousSources);

    setTiles((prev) =>
      normalizeTiles(prev, internalTotalCells, previousSources.length).map((tile) => {
        if (tile.imageIndex === -2) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        if (tile.imageIndex < 0) {
          return tile;
        }
        // When tile has a name, resolve by name so we don't remap UGC → built-in
        // when tileSources order differs (e.g. on Expo Go).
        if (tile.name != null && tile.name !== '') {
          const indexByName = getTileSourceIndexByName(tileSources, tile.name);
          if (indexByName >= 0) {
            return {
              ...tile,
              imageIndex: indexByName,
            };
          }
          // Name not in new list; keep tile as-is so TileCell can resolve by name (e.g. UGC fallback).
          return tile;
        }
        const previousSource = previousSources[tile.imageIndex];
        if (!previousSource) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const transformedPrevious = previousTables.getConnectionsForPlacement(
          tile.imageIndex,
          tile.rotation,
          tile.mirrorX,
          tile.mirrorY
        );
        const previousKey = toConnectionKey(transformedPrevious);
        if (!previousKey) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const candidates = nextLookup.get(previousKey);
        if (!candidates || candidates.length === 0) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const match = candidates[0];
        return {
          imageIndex: match.index,
          rotation: match.rotation,
          mirrorX: match.mirrorX,
          mirrorY: match.mirrorY,
          name: tileSources[match.index]?.name,
        };
      })
    );
  }, [tileSourcesKey, suspendRemap, tileSourcesLength, internalTotalCells, compatTables, tileSources]);

  const getMirroredPlacements = (cellIndex: number, placement: Tile) => {
    const cols = gridLayout.columns;
    const rows = gridLayout.rows;
    let row: number;
    let col: number;
    let indexToPlace: (r: number, c: number) => number;
    if (isZoomed && zoomBounds) {
      row = Math.floor(cellIndex / fullGridLayout.columns) - zoomBounds.minRow;
      col = (cellIndex % fullGridLayout.columns) - zoomBounds.minCol;
      indexToPlace = (r: number, c: number) =>
        (zoomBounds!.minRow + r) * fullGridLayout.columns + (zoomBounds!.minCol + c);
    } else {
      row = Math.floor(cellIndex / cols);
      col = cellIndex % cols;
      indexToPlace = (r: number, c: number) => r * cols + c;
    }
    const placements = new Map<number, Tile>();
    placements.set(cellIndex, placement);

    if (mirrorHorizontal) {
      const mirrorCol = cols - 1 - col;
      const index = indexToPlace(row, mirrorCol);
      placements.set(index, {
        ...placement,
        mirrorX: !placement.mirrorX,
      });
    }
    if (mirrorVertical) {
      const mirrorRow = rows - 1 - row;
      const index = indexToPlace(mirrorRow, col);
      placements.set(index, {
        ...placement,
        mirrorY: !placement.mirrorY,
      });
    }
    if (mirrorHorizontal && mirrorVertical) {
      const mirrorRow = rows - 1 - row;
      const mirrorCol = cols - 1 - col;
      const index = indexToPlace(mirrorRow, mirrorCol);
      placements.set(index, {
        ...placement,
        rotation: (placement.rotation + 180) % 360,
        mirrorX: placement.mirrorX,
        mirrorY: placement.mirrorY,
      });
    }

    return placements;
  };

  const getMirrorTargets = (cellIndex: number) => {
    const cols = gridLayout.columns;
    const rows = gridLayout.rows;
    let row: number;
    let col: number;
    let indexAt: (r: number, c: number) => number;
    if (isZoomed && zoomBounds) {
      row = Math.floor(cellIndex / fullGridLayout.columns) - zoomBounds.minRow;
      col = (cellIndex % fullGridLayout.columns) - zoomBounds.minCol;
      indexAt = (r: number, c: number) =>
        (zoomBounds!.minRow + r) * fullGridLayout.columns + (zoomBounds!.minCol + c);
    } else {
      row = Math.floor(cellIndex / cols);
      col = cellIndex % cols;
      indexAt = (r: number, c: number) => r * cols + c;
    }
    const targets = new Set<number>();

    if (mirrorHorizontal) {
      targets.add(indexAt(row, cols - 1 - col));
    }
    if (mirrorVertical) {
      targets.add(indexAt(rows - 1 - row, col));
    }
    if (mirrorHorizontal && mirrorVertical) {
      targets.add(indexAt(rows - 1 - row, cols - 1 - col));
    }

    targets.delete(cellIndex);
    return Array.from(targets);
  };

  const applyPlacementsToArray = (
    nextTiles: Tile[],
    placements: Map<number, Tile>,
    driverIndex: number,
    allowIndices?: Set<number> | null
  ) => {
    placements.forEach((placement, index) => {
      if (index < 0 || index >= nextTiles.length) {
        return;
      }
      if (allowIndices != null && !allowIndices.has(index)) {
        return;
      }
      if (index !== driverIndex && nextTiles[index]?.imageIndex >= 0) {
        return;
      }
      nextTiles[index] = { ...placement, placedOrder: placementOrderRef.current };
    });
  };

  const applyPlacementsToArrayOverride = (
    nextTiles: Tile[],
    placements: Map<number, Tile>,
    allowIndices?: Set<number> | null
  ) => {
    placements.forEach((placement, index) => {
      if (index < 0 || index >= nextTiles.length) {
        return;
      }
      if (allowIndices != null && !allowIndices.has(index)) {
        return;
      }
      nextTiles[index] = { ...placement, placedOrder: placementOrderRef.current };
    });
  };

  const applyPlacement = (cellIndex: number, placement: Tile) => {
    const placements = getMirroredPlacements(cellIndex, placement);
    const order = getNextPlacementOrder();
    setTiles((prev) =>
      normalizeTiles(prev, internalTotalCells, tileSourcesLength).map((tile, index) => {
        const p = placements.get(index);
        if (p && lockedCellIndices?.has(index)) {
          return tile;
        }
        return p ? { ...p, placedOrder: order } : tile;
      })
    );
  };

  /** Finalize a completed stroke: length 1 → set to 00000000 (or empty); length ≥ 2 → last tile connects only to n-1. */
  const applyFinalizeStrokeToTiles = (
    prevTiles: Tile[],
    stroke: number[],
    selectionSet: Set<number> | null
  ): Tile[] => {
    if (stroke.length === 0) return prevTiles;
    const next = prevTiles.map((t) => ({ ...t }));
    if (stroke.length === 1) {
      let zeroCandidates = getCandidatesWithExactConnections(
        new Set(),
        randomSourceSet
      );
      if (zeroCandidates.length === 0) {
        zeroCandidates = getCandidatesWithExactConnections(new Set(), null);
      }
      const tile =
        zeroCandidates.length > 0
          ? zeroCandidates[Math.floor(Math.random() * zeroCandidates.length)]
          : ({ imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false } as Tile);
      applyPlacementsToArrayOverride(
        next,
        getMirroredPlacements(stroke[0], tile),
        selectionSet ?? undefined
      );
      return normalizeTiles(next, internalTotalCells, tileSourcesLength);
    }
    const lastIndex = stroke[stroke.length - 1];
    const prevIndex = stroke[stroke.length - 2];
    const dirFromLastToPrev = getDirectionFromTo(lastIndex, prevIndex);
    if (dirFromLastToPrev < 0) return prevTiles;
    let endCandidates = getCandidatesWithExactConnections(
      new Set([dirFromLastToPrev]),
      randomSourceSet
    );
    if (endCandidates.length === 0) {
      endCandidates = getCandidatesWithExactConnections(
        new Set([dirFromLastToPrev]),
        null
      );
    }
    if (endCandidates.length === 0) return prevTiles;
    const endTile =
      endCandidates[Math.floor(Math.random() * endCandidates.length)];
    applyPlacementsToArrayOverride(
      next,
      getMirroredPlacements(lastIndex, endTile),
      selectionSet ?? undefined
    );
    return normalizeTiles(next, internalTotalCells, tileSourcesLength);
  };

  const clearDrawStroke = useCallback(() => {
    const stroke = [...drawStrokeRef.current];
    drawStrokeRef.current = [];
    if (stroke.length > 0) {
      setTiles((prev) => {
        getNextPlacementOrder();
        const next = applyFinalizeStrokeToTiles(prev, stroke, drawPlacementAllowSet ?? null);
        return tilesEqual(prev, next) ? prev : next;
      });
    }
  }, [drawPlacementAllowSet, applyFinalizeStrokeToTiles, tilesEqual]);

  const getPatternTileForPosition = (row: number, col: number) => {
    if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
      return null;
    }
    const rotationCW = ((pattern.rotation % 360) + 360) % 360;
    const W = pattern.width;
    const H = pattern.height;
    const { rotW, rotH } = getRotatedDimensions(rotationCW, W, H);
    const localRow = ((row % rotH) + rotH) % rotH;
    const localCol = ((col % rotW) + rotW) % rotW;
    const mapped = displayToPatternCell(
      localRow,
      localCol,
      W,
      H,
      rotationCW,
      pattern.mirrorX
    );
    if (!mapped) {
      return null;
    }
    const { sourceRow, sourceCol } = mapped;
    const patternIndex = sourceRow * pattern.width + sourceCol;
    const patternTile = pattern.tiles[patternIndex];
    if (!patternTile) {
      return null;
    }
    // Apply group rotation to the tile (same as selection-tool rotate region).
    const rot = normalizeRotationCW(rotationCW);
    const transformed = applyGroupRotationToTile(
      patternTile.rotation,
      patternTile.mirrorX,
      patternTile.mirrorY,
      rot
    );
    return {
      imageIndex: patternTile.imageIndex,
      rotation: transformed.rotation,
      mirrorX: pattern.mirrorX ? !transformed.mirrorX : transformed.mirrorX,
      mirrorY: transformed.mirrorY,
      name: patternTile.name,
    };
  };

  const handlePress = (cellIndex: number) => {
    const fullIndex = isZoomed ? visibleToFull(cellIndex) : cellIndex;
    if (lockedCellIndices?.has(fullIndex)) {
      return;
    }
    if (bulkUpdateRef.current) {
      return;
    }
    if (!isPartOfDragRef?.current) {
      pushUndo();
      if (brush.mode === 'draw') {
        drawStrokeRef.current = [];
      }
    }
    if (brush.mode === 'erase') {
      applyPlacement(fullIndex, {
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      });
      return;
    }
    if (brush.mode === 'clone') {
      const sourceIndex = cloneSourceRef.current;
      if (sourceIndex === null) {
        return;
      }
      const cols = isZoomed ? fullGridLayout.columns : gridLayout.columns;
      const rows = isZoomed && zoomBounds ? zoomRows : gridLayout.rows;
      if (rows === 0 || cols === 0) {
        return;
      }
      setCloneCursorIndex(cellIndex);
      if (!cloneAnchorRef.current && cloneAnchorRef.current !== 0) {
        cloneAnchorRef.current = fullIndex;
        setCloneAnchorIndex(cellIndex);
      }
      const anchorIndex = cloneAnchorRef.current ?? fullIndex;
      const anchorRow = Math.floor(anchorIndex / cols);
      const anchorCol = anchorIndex % cols;
      const sourceRow = Math.floor(sourceIndex / cols);
      const sourceCol = sourceIndex % cols;
      const destRow = Math.floor(fullIndex / cols);
      const destCol = fullIndex % cols;
      const rowOffset = destRow - anchorRow;
      const colOffset = destCol - anchorCol;
      const mappedRow = ((sourceRow + rowOffset) % rows + rows) % rows;
      const mappedCol = ((sourceCol + colOffset) % cols + cols) % cols;
      const mappedIndex = mappedRow * cols + mappedCol;
      setCloneSampleIndex(isZoomed && fullToVisible(mappedIndex) !== null ? fullToVisible(mappedIndex)! : mappedIndex);
      const sourceTile = renderTiles[mappedIndex];
      if (!sourceTile) {
        return;
      }
      applyPlacement(fullIndex, {
        imageIndex: sourceTile.imageIndex,
        rotation: sourceTile.rotation,
        mirrorX: sourceTile.mirrorX,
        mirrorY: sourceTile.mirrorY,
        name: sourceTile.name,
      });
      return;
    }
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const patternCols = isZoomed ? fullGridLayout.columns : gridLayout.columns;
      const patternRows = isZoomed && zoomBounds ? zoomRows : gridLayout.rows;
      if (patternRows === 0 || patternCols === 0) {
        return;
      }
      if (patternAnchorRef.current === null) {
        patternAnchorRef.current = fullIndex;
      }
      const anchorIndex = patternAnchorRef.current ?? fullIndex;
      const anchorRow = Math.floor(anchorIndex / patternCols);
      const anchorCol = anchorIndex % patternCols;
      const destRow = Math.floor(fullIndex / patternCols);
      const destCol = fullIndex % patternCols;
      const rowOffset = destRow - anchorRow;
      const colOffset = destCol - anchorCol;
      const tile = getPatternTileForPosition(rowOffset, colOffset);
      if (!tile) {
        return;
      }
      applyPlacement(fullIndex, {
        imageIndex: tile.imageIndex,
        rotation: tile.rotation,
        mirrorX: tile.mirrorX,
        mirrorY: tile.mirrorY,
        name: tile.name,
      });
      return;
    }
    if (brush.mode === 'fixed') {
      const getterResult = getFixedBrushSourceName?.() ?? null;
      const sourceName =
        getterResult ?? brush.sourceName ?? null;
      const indexByName =
        sourceName != null
          ? getTileSourceIndexByName(tileSources, sourceName)
          : -1;
      const fixedIndex =
        indexByName >= 0 ? indexByName : brush.index;
      const tileName =
        sourceName ?? (fixedIndex >= 0 ? tileSources[fixedIndex]?.name : undefined);
      if (fixedIndex >= 0 && fixedIndex < tileSourcesLength) {
        if (onFixedPlacementDebug) {
          onFixedPlacementDebug({
            fixedIndex,
            tileName: tileName ?? null,
            tileSourcesLength,
            getterResult: getterResult ?? undefined,
            brushSourceName: brush.sourceName ?? undefined,
          });
        }
        applyPlacement(fullIndex, {
          imageIndex: fixedIndex,
          rotation: brush.rotation,
          mirrorX: brush.mirrorX,
          mirrorY: brush.mirrorY,
          name: tileName,
        });
      }
      return;
    }
    const isRandomOrDraw = brush.mode === 'random' || brush.mode === 'draw';
    if (!isRandomOrDraw) {
      return;
    }
    const current = renderTiles[fullIndex];
    if (!current) {
      return;
    }
    const placementOrder = getNextPlacementOrder();
    const now = Date.now();
    const cached =
      lastPressRef.current &&
      lastPressRef.current.cellIndex === fullIndex &&
      now - lastPressRef.current.time < 150
        ? lastPressRef.current
        : null;

    if (cached) {
      lastPressRef.current = { ...cached, time: now };
      setTiles((prev) =>
        normalizeTiles(prev, internalTotalCells, tileSourcesLength).map((tile, index) =>
          index === fullIndex
            ? {
                imageIndex: cached.imageIndex,
                rotation: cached.rotation,
                mirrorX: cached.mirrorX,
                mirrorY: cached.mirrorY,
                placedOrder: placementOrder,
              }
            : tile
        )
      );
      return;
    }

    const treatUninitForRandomBrush =
      !allowEdgeConnections &&
      getInitializedNeighborCount(fullIndex, renderTiles) > 0;
    const stroke = drawStrokeRef.current;
    const isDrawFirst = brush.mode === 'draw' && stroke.length === 0;
    const isDrawSubsequent = brush.mode === 'draw' && stroke.length >= 1;
    // When starting a draw stroke (first tile or new stroke on non-adjacent cell), treat all tiles as empty so we overwrite regardless of existing content.
    const drawOverwriteTilesState: Tile[] | null =
      brush.mode === 'draw'
        ? Array.from(
            { length: internalTotalCells },
            () =>
              ({
                imageIndex: -1,
                rotation: 0,
                mirrorX: false,
                mirrorY: false,
              }) as Tile
          )
        : null;

    const getConnectionCount = (t: Tile): number => {
      const conn = compatTables.getConnectionsForPlacement(
        t.imageIndex,
        t.rotation,
        t.mirrorX,
        t.mirrorY
      );
      return conn ? conn.filter(Boolean).length : 0;
    };

    let selection: Tile | null;
    if (isDrawFirst) {
      // First tile: exactly one connection; use palette first, then all sources if none.
      // Use drawOverwriteTilesState so preexisting tiles do not constrain placement (always overwrite).
      let candidates = getCandidatesWithConnectionCount(1, randomSourceSet);
      if (candidates.length === 0) {
        candidates = getCandidatesWithConnectionCount(1, null);
      }
      const tilesForFirst =
        drawOverwriteTilesState ?? renderTiles;
      const validFirst = candidates.filter((t) =>
        isPlacementValid(
          fullIndex,
          t,
          tilesForFirst,
          drawOverwriteTilesState ? false : treatUninitForRandomBrush,
          modifiableIndicesSet
        )
      );
      selection =
        validFirst.length > 0
          ? validFirst[Math.floor(Math.random() * validFirst.length)]
          : null;
    } else {
      selection = selectCompatibleTile(
        fullIndex,
        renderTiles,
        randomSourceSet,
        treatUninitForRandomBrush,
        modifiableIndicesSet
      );
    }
    const tilesForValidation =
      isDrawFirst && drawOverwriteTilesState
        ? drawOverwriteTilesState
        : renderTiles;
    const treatUninitForValidation =
      isDrawFirst && drawOverwriteTilesState ? false : treatUninitForRandomBrush;
    if (
      !selection ||
      !isPlacementValid(fullIndex, selection, tilesForValidation, treatUninitForValidation, modifiableIndicesSet)
    ) {
      if (randomRequiresLegal) {
        return;
      }
      if (brush.mode === 'draw') {
        return;
      }
      setTiles((prev) =>
        normalizeTiles(prev, internalTotalCells, tileSourcesLength).map((tile, index) =>
          index === fullIndex
            ? { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false }
            : tile
        )
      );
      return;
    }

    if (isDrawSubsequent) {
      const prevIndex = stroke[stroke.length - 1];
      const prevPrevIndex = stroke.length >= 2 ? stroke[stroke.length - 2] : undefined;
      const dirToPrev = getDirectionFromTo(fullIndex, prevIndex);
      if (dirToPrev < 0) {
        // User moved to a non-adjacent cell (e.g. moved too fast): finalize current stroke, then start a new stroke at this cell
        const strokeToFinalize = [...stroke];
        let firstCandidates = getCandidatesWithConnectionCount(1, randomSourceSet);
        if (firstCandidates.length === 0) {
          firstCandidates = getCandidatesWithConnectionCount(1, null);
        }
        const validFirst = firstCandidates.filter((t) =>
          isPlacementValid(
            fullIndex,
            t,
            drawOverwriteTilesState ?? renderTiles,
            drawOverwriteTilesState ? false : treatUninitForRandomBrush,
            modifiableIndicesSet
          )
        );
        const newStrokeFirst =
          validFirst.length > 0
            ? validFirst[Math.floor(Math.random() * validFirst.length)]
            : null;
        if (newStrokeFirst) {
          setTiles((prev) => {
            let next = applyFinalizeStrokeToTiles(
              prev,
              strokeToFinalize,
              drawPlacementAllowSet ?? null
            );
            applyPlacementsToArrayOverride(
              next,
              getMirroredPlacements(fullIndex, {
                imageIndex: newStrokeFirst.imageIndex,
                rotation: newStrokeFirst.rotation,
                mirrorX: newStrokeFirst.mirrorX,
                mirrorY: newStrokeFirst.mirrorY,
                name: newStrokeFirst.name,
              }),
              drawPlacementAllowSet ?? undefined
            );
            return normalizeTiles(next, internalTotalCells, tileSourcesLength);
          });
          drawStrokeRef.current = [fullIndex];
          lastPressRef.current = {
            cellIndex: fullIndex,
            imageIndex: newStrokeFirst.imageIndex,
            rotation: newStrokeFirst.rotation,
            mirrorX: newStrokeFirst.mirrorX,
            mirrorY: newStrokeFirst.mirrorY,
            time: now,
          };
        }
        return;
      }
      // Nth tile: exactly 2 connections, one toward n-1 (and one “free” for the path)
      let nthCandidates = getCandidatesWithTwoConnectionsOneBeing(
        dirToPrev,
        randomSourceSet
      );
      if (nthCandidates.length === 0) {
        nthCandidates = getCandidatesWithTwoConnectionsOneBeing(dirToPrev, null);
      }
      const drawSelection =
        nthCandidates.length > 0
          ? nthCandidates[Math.floor(Math.random() * nthCandidates.length)]
          : null;
      if (!drawSelection) {
        return;
      }
      // Update n-1 first so it connects only to n-2 and n; only n-1 is changed (nothing further back)
      const dirFromPrevToN = getDirectionFromTo(prevIndex, fullIndex);
      const dirFromPrevToN2 =
        prevPrevIndex !== undefined
          ? getDirectionFromTo(prevIndex, prevPrevIndex)
          : -1;
      const requiredPrevDirections = new Set<number>([dirFromPrevToN]);
      if (dirFromPrevToN2 >= 0) requiredPrevDirections.add(dirFromPrevToN2);
      let prevCandidates = getCandidatesWithExactConnections(
        requiredPrevDirections,
        randomSourceSet
      );
      if (prevCandidates.length === 0) {
        prevCandidates = getCandidatesWithExactConnections(
          requiredPrevDirections,
          null
        );
      }
      if (prevCandidates.length === 0) {
        return;
      }
      const prevTile =
        prevCandidates[Math.floor(Math.random() * prevCandidates.length)];
      const nextTiles = lastTilesRef.current.map((t) => ({ ...t }));
      applyPlacementsToArrayOverride(
        nextTiles,
        getMirroredPlacements(prevIndex, prevTile),
        drawPlacementAllowSet ?? undefined
      );
      applyPlacementsToArrayOverride(
        nextTiles,
        getMirroredPlacements(fullIndex, {
          imageIndex: drawSelection.imageIndex,
          rotation: drawSelection.rotation,
          mirrorX: drawSelection.mirrorX,
          mirrorY: drawSelection.mirrorY,
          name: drawSelection.name,
        }),
        drawPlacementAllowSet ?? undefined
      );
      const normalizedNext = normalizeTiles(
        nextTiles,
        internalTotalCells,
        tileSourcesLength
      );
      const newStroke = [...stroke, fullIndex];
      if (!isStrokeValid(newStroke, normalizedNext)) {
        return;
      }
      setTiles((prev) => {
        if (tilesEqual(prev, normalizedNext)) return prev;
        return normalizedNext;
      });
      drawStrokeRef.current = newStroke;
      lastPressRef.current = {
        cellIndex: fullIndex,
        imageIndex: drawSelection.imageIndex,
        rotation: drawSelection.rotation,
        mirrorX: drawSelection.mirrorX,
        mirrorY: drawSelection.mirrorY,
        time: now,
      };
      return;
    }

    lastPressRef.current = {
      cellIndex: fullIndex,
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
      time: now,
    };

    if (brush.mode === 'draw') {
      drawStrokeRef.current = [...stroke, fullIndex];
    }

    applyPlacement(fullIndex, {
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
      name: selection.name,
    });
  };

  const randomFill = () => {
    if (internalTotalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    const nextTiles = buildInitialTiles(internalTotalCells);
    if (lockedCellIndices?.size) {
      const current = normalizeTiles(tiles, internalTotalCells, tileSourcesLength);
      lockedCellIndices.forEach((i) => {
        if (current[i]) nextTiles[i] = { ...current[i] };
      });
    }
    const mirrorOn = mirrorHorizontal || mirrorVertical;
    const allowSet = mirrorOn
      ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
      : (lockedCellIndices ? modifiableIndicesSet : null);
    getNextPlacementOrder();
    if (mirrorOn) {
      const driven = modifiableIndicesArray;
      const start = Math.floor(Math.random() * Math.max(1, driven.length));
      for (let o = 0; o < driven.length; o += 1) {
        const index = driven[(start + o) % driven.length];
        const placement = getRandomPlacement(index, nextTiles);
        applyPlacementsToArrayOverride(
          nextTiles,
          getMirroredPlacements(index, placement),
          allowSet ?? undefined
        );
      }
    } else {
      const startIndex = Math.floor(Math.random() * internalTotalCells);
      for (let offset = 0; offset < internalTotalCells; offset += 1) {
        const index = (startIndex + offset) % internalTotalCells;
        if (lockedCellIndices?.has(index)) {
          continue;
        }
        const placement = getRandomPlacement(index, nextTiles);
        applyPlacementsToArrayOverride(
          nextTiles,
          getMirroredPlacements(index, placement),
          allowSet ?? undefined
        );
      }
    }
    withBulkUpdate(() => {
      applyTiles(nextTiles);
    });
  };

  const floodFill = () => {
    if (internalTotalCells <= 0) {
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    const mirrorOnFlood = mirrorHorizontal || mirrorVertical;
    const floodAllowSet =
      mirrorOnFlood
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    let floodClearSet: Set<number> =
      mirrorOnFlood && !selectionBounds
        ? allNonLockedIndicesSet
        : modifiableIndicesSet;
    if (mirrorOnFlood && selectionBounds) {
      floodClearSet = new Set(modifiableIndicesSet);
      modifiableIndicesSet.forEach((i) => {
        getMirrorTargets(i).forEach((t) => floodClearSet.add(t));
      });
      if (lockedCellIndices) {
        floodClearSet = new Set([...floodClearSet].filter((i) => !lockedCellIndices.has(i)));
      }
    }
    if (brush.mode === 'erase') {
      if (floodClearSet.size > 0) {
        const empty = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        withBulkUpdate(() => {
          setTiles((prev) => {
            const next = [...normalizeTiles(prev, internalTotalCells, tileSourcesLength)];
            floodClearSet.forEach((index) => {
              next[index] = { ...empty };
            });
            return next;
          });
        });
      } else if (!selectionBounds && !(isZoomed && zoomBounds)) {
        withBulkUpdate(() => {
          applyTiles(buildInitialTiles(internalTotalCells));
        });
      }
      return;
    }
    getNextPlacementOrder();
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const nextTiles =
        selectionBounds || lockedCellIndices?.size || (isZoomed && zoomBounds)
          ? [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)]
          : buildInitialTiles(internalTotalCells);
      const colsForIndex = isZoomed ? fullGridLayout.columns : gridLayout.columns;
      if (selectionBounds && !mirrorHorizontal && !mirrorVertical) {
        modifiableIndicesSet.forEach((index) => {
          const row = Math.floor(index / colsForIndex);
          const col = index % colsForIndex;
          const tile = getPatternTileForPosition(row, col);
          nextTiles[index] = tile
            ? {
                imageIndex: tile.imageIndex,
                rotation: tile.rotation,
                mirrorX: tile.mirrorX,
                mirrorY: tile.mirrorY,
                name: tile.name,
                placedOrder: placementOrderRef.current,
              }
            : { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        });
      } else if (mirrorHorizontal || mirrorVertical) {
        for (const index of modifiableIndicesArray) {
          const row = Math.floor(index / colsForIndex);
          const col = index % colsForIndex;
          const tile = getPatternTileForPosition(row, col);
          if (!tile) {
            continue;
          }
          applyPlacementsToArrayOverride(nextTiles, getMirroredPlacements(index, tile), floodAllowSet);
        }
      } else {
        for (const index of modifiableIndicesArray) {
          const row = Math.floor(index / colsForIndex);
          const col = index % colsForIndex;
          const tile = getPatternTileForPosition(row, col);
          if (tile) {
            nextTiles[index] = {
              imageIndex: tile.imageIndex,
              rotation: tile.rotation,
              mirrorX: tile.mirrorX,
              mirrorY: tile.mirrorY,
              name: tile.name,
              placedOrder: placementOrderRef.current,
            };
          }
        }
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    if (brush.mode === 'random' || brush.mode === 'draw') {
      if (tileSourcesLength <= 0) {
        return;
      }
      if (modifiableIndicesSet.size === 0) {
        return;
      }
      if (mirrorHorizontal || mirrorVertical || selectionBounds || (isZoomed && zoomBounds)) {
        const nextTiles =
          selectionBounds || lockedCellIndices?.size || (isZoomed && zoomBounds)
            ? [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)]
            : buildInitialTiles(internalTotalCells);
        const empty = {
          imageIndex: -1,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
        };
        if (brush.mode === 'random' && modifiableIndicesSet.size > 0) {
          modifiableIndicesSet.forEach((index) => {
            nextTiles[index] = { ...empty };
          });
        }
        const indices =
          brush.mode === 'draw'
            ? selectionBounds
              ? getSpiralCellOrderInRect(
                  selectionBounds.minRow,
                  selectionBounds.minCol,
                  selectionBounds.maxRow,
                  selectionBounds.maxCol,
                  fullGridLayout.columns
                ).filter((i) => !lockedCellIndices?.has(i))
              : isZoomed && zoomBounds
                ? getSpiralCellOrderInRect(
                    zoomBounds.minRow,
                    zoomBounds.minCol,
                    zoomBounds.maxRow,
                    zoomBounds.maxCol,
                    fullGridLayout.columns
                  ).filter((i) => !lockedCellIndices?.has(i))
                : (() => {
                    const spiralOrder = getSpiralCellOrder(
                      gridLayout.columns,
                      gridLayout.rows
                    );
                    return spiralOrder.filter((i) =>
                      modifiableIndicesSet.has(i)
                    );
                  })()
            : modifiableIndicesArray.length > 0
              ? [...modifiableIndicesArray].sort(() => Math.random() - 0.5)
              : modifiableIndicesArray;
        if (brush.mode === 'draw' && indices.length > 0) {
          for (let i = 0; i < indices.length; i += 1) {
            const cellIndex = indices[i];
            let candidates: Tile[];
            if (indices.length === 1) {
              candidates = getCandidatesWithExactConnections(
                new Set(),
                randomSourceSet
              );
              if (candidates.length === 0) {
                candidates = getCandidatesWithExactConnections(new Set(), null);
              }
            } else if (i === 0) {
              const dirToNext = getDirectionFromTo(
                cellIndex,
                indices[i + 1]
              );
              candidates = getCandidatesWithExactConnections(
                new Set([dirToNext]),
                randomSourceSet
              );
              if (candidates.length === 0) {
                candidates = getCandidatesWithExactConnections(
                  new Set([dirToNext]),
                  null
                );
              }
            } else if (i === indices.length - 1) {
              const dirToPrev = getDirectionFromTo(
                cellIndex,
                indices[i - 1]
              );
              candidates = getCandidatesWithExactConnections(
                new Set([dirToPrev]),
                randomSourceSet
              );
              if (candidates.length === 0) {
                candidates = getCandidatesWithExactConnections(
                  new Set([dirToPrev]),
                  null
                );
              }
            } else {
              const dirToPrev = getDirectionFromTo(
                cellIndex,
                indices[i - 1]
              );
              const dirToNext = getDirectionFromTo(
                cellIndex,
                indices[i + 1]
              );
              const required = new Set([dirToPrev, dirToNext]);
              candidates = getCandidatesWithExactConnections(
                required,
                randomSourceSet
              );
              if (candidates.length === 0) {
                candidates = getCandidatesWithExactConnections(
                  required,
                  null
                );
              }
            }
            const placement =
              candidates.length > 0
                ? candidates[Math.floor(Math.random() * candidates.length)]
                : { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
            applyPlacementsToArrayOverride(
              nextTiles,
              getMirroredPlacements(cellIndex, placement),
              floodAllowSet
            );
          }
        } else if (selectionBounds && !mirrorHorizontal && !mirrorVertical) {
          indices.forEach((index) => {
            nextTiles[index] = getRandomPlacement(
              index,
              nextTiles,
              false,
              modifiableIndicesSet
            );
          });
        } else {
          for (const index of indices) {
            const placement = getRandomPlacement(
              index,
              nextTiles,
              false,
              floodAllowSet
            );
            applyPlacementsToArrayOverride(
              nextTiles,
              getMirroredPlacements(index, placement),
              floodAllowSet
            );
          }
        }
        withBulkUpdate(() => {
          applyTiles(nextTiles);
        });
        return;
      }
      if (brush.mode === 'draw') {
        const nextTiles =
          lockedCellIndices?.size || (isZoomed && zoomBounds)
            ? [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)]
            : buildInitialTiles(internalTotalCells);
        const strokeOrder =
          isZoomed && zoomBounds
            ? getSpiralCellOrderInRect(
                zoomBounds.minRow,
                zoomBounds.minCol,
                zoomBounds.maxRow,
                zoomBounds.maxCol,
                fullGridLayout.columns
              ).filter((i) => !lockedCellIndices?.has(i))
            : getSpiralCellOrder(
                gridLayout.columns,
                gridLayout.rows
              );
        for (let i = 0; i < strokeOrder.length; i += 1) {
          const cellIndex = strokeOrder[i];
          let candidates: Tile[];
          if (strokeOrder.length === 1) {
            candidates = getCandidatesWithExactConnections(
              new Set(),
              randomSourceSet
            );
            if (candidates.length === 0) {
              candidates = getCandidatesWithExactConnections(new Set(), null);
            }
          } else if (i === 0) {
            const dirToNext = getDirectionFromTo(
              cellIndex,
              strokeOrder[i + 1]
            );
            candidates = getCandidatesWithExactConnections(
              new Set([dirToNext]),
              randomSourceSet
            );
            if (candidates.length === 0) {
              candidates = getCandidatesWithExactConnections(
                new Set([dirToNext]),
                null
              );
            }
          } else if (i === strokeOrder.length - 1) {
            const dirToPrev = getDirectionFromTo(
              cellIndex,
              strokeOrder[i - 1]
            );
            candidates = getCandidatesWithExactConnections(
              new Set([dirToPrev]),
              randomSourceSet
            );
            if (candidates.length === 0) {
              candidates = getCandidatesWithExactConnections(
                new Set([dirToPrev]),
                null
              );
            }
          } else {
            const dirToPrev = getDirectionFromTo(
              cellIndex,
              strokeOrder[i - 1]
            );
            const dirToNext = getDirectionFromTo(
              cellIndex,
              strokeOrder[i + 1]
            );
            const required = new Set([dirToPrev, dirToNext]);
            candidates = getCandidatesWithExactConnections(
              required,
              randomSourceSet
            );
            if (candidates.length === 0) {
              candidates = getCandidatesWithExactConnections(
                required,
                null
              );
            }
          }
          const placement =
            candidates.length > 0
              ? candidates[Math.floor(Math.random() * candidates.length)]
              : { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
          applyPlacementsToArrayOverride(
            nextTiles,
            getMirroredPlacements(cellIndex, placement),
            mirrorOnFlood ? floodAllowSet : (lockedCellIndices ? modifiableIndicesSet : undefined)
          );
        }
        withBulkUpdate(() => {
          applyTiles(nextTiles);
        });
      } else {
        randomFill();
      }
      return;
    }
    const sourceNameFlood =
      getFixedBrushSourceName?.() ?? brush.sourceName ?? null;
    const indexByName =
      sourceNameFlood != null
        ? getTileSourceIndexByName(tileSources, sourceNameFlood)
        : -1;
    const fixedIndex = indexByName >= 0 ? indexByName : brush.index;
    const fixedName = sourceNameFlood ?? tileSources[fixedIndex]?.name;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
      return;
    }
    if (mirrorHorizontal || mirrorVertical || selectionBounds) {
      const nextTiles =
        selectionBounds || lockedCellIndices?.size || (isZoomed && zoomBounds)
          ? [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)]
          : buildInitialTiles(internalTotalCells);
      const fixedTile = {
        imageIndex: fixedIndex,
        rotation: brush.rotation,
        mirrorX: brush.mirrorX,
        mirrorY: false,
        name: fixedName,
      };
      if (selectionBounds && !mirrorHorizontal && !mirrorVertical) {
        modifiableIndicesSet.forEach((index) => {
          nextTiles[index] = { ...fixedTile, placedOrder: placementOrderRef.current };
        });
      } else {
        for (const index of modifiableIndicesArray) {
          applyPlacementsToArrayOverride(
            nextTiles,
            getMirroredPlacements(index, fixedTile),
            floodAllowSet
          );
        }
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    if (lockedCellIndices?.size) {
      const nextTiles = [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)];
      const fixedTile = {
        imageIndex: fixedIndex,
        rotation: brush.rotation,
        mirrorX: false,
        mirrorY: false,
        name: tileSources[fixedIndex]?.name,
        placedOrder: placementOrderRef.current,
      };
      modifiableIndicesArray.forEach((index) => {
        nextTiles[index] = { ...fixedTile };
      });
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
    } else if (isZoomed && zoomBounds) {
      const nextTiles = [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)];
      const fixedTile = {
        imageIndex: fixedIndex,
        rotation: brush.rotation,
        mirrorX: false,
        mirrorY: false,
        name: tileSources[fixedIndex]?.name,
        placedOrder: placementOrderRef.current,
      };
      modifiableIndicesArray.forEach((index) => {
        nextTiles[index] = { ...fixedTile };
      });
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
    } else {
      withBulkUpdate(() => {
        applyTiles(
          Array.from({ length: internalTotalCells }, () => ({
            imageIndex: fixedIndex,
            rotation: brush.rotation,
            mirrorX: false,
            mirrorY: false,
            name: tileSources[fixedIndex]?.name,
          }))
        );
      });
    }
  };

  const floodComplete = () => {
    if (internalTotalCells <= 0) {
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    const mirrorOnComplete = mirrorHorizontal || mirrorVertical;
    const floodAllowSetComplete =
      mirrorOnComplete
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    let floodClearSetComplete: Set<number> =
      mirrorOnComplete && !selectionBounds
        ? allNonLockedIndicesSet
        : modifiableIndicesSet;
    if (mirrorOnComplete && selectionBounds) {
      floodClearSetComplete = new Set(modifiableIndicesSet);
      modifiableIndicesSet.forEach((i) => {
        getMirrorTargets(i).forEach((t) => floodClearSetComplete.add(t));
      });
      if (lockedCellIndices) {
        floodClearSetComplete = new Set([...floodClearSetComplete].filter((i) => !lockedCellIndices.has(i)));
      }
    }
    if (brush.mode === 'erase') {
      if (floodClearSetComplete.size > 0) {
        const empty = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        withBulkUpdate(() => {
          setTiles((prev) => {
            const next = [...normalizeTiles(prev, internalTotalCells, tileSourcesLength)];
            floodClearSetComplete.forEach((index) => {
              next[index] = { ...empty };
            });
            return next;
          });
        });
      } else if (!selectionBounds) {
        withBulkUpdate(() => {
          applyTiles(buildInitialTiles(internalTotalCells));
        });
      }
      return;
    }
    const drivenSet = new Set(modifiableIndicesSet);
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const nextTiles = [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)];
      const colsForIndexComplete = isZoomed ? fullGridLayout.columns : gridLayout.columns;
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        const indicesToScan = isZoomed && zoomBounds ? allNonLockedIndicesSet : new Set(Array.from({ length: internalTotalCells }, (_, i) => i));
        for (const index of indicesToScan) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
        }
      } else if ((mirrorHorizontal || mirrorVertical) && selectionBounds) {
        for (const index of modifiableIndicesSet) {
          if (nextTiles[index].imageIndex >= 0) continue;
          const targets = getMirrorTargets(index);
          if (targets.some((t) => nextTiles[t]?.imageIndex >= 0)) drivenSet.add(index);
        }
      }
      if (mirrorHorizontal || mirrorVertical) {
        for (const index of drivenSet) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const row = Math.floor(index / colsForIndexComplete);
          const col = index % colsForIndexComplete;
          const tile = getPatternTileForPosition(row, col);
          if (!tile) {
            continue;
          }
          applyPlacementsToArray(nextTiles, getMirroredPlacements(index, tile), index, floodAllowSetComplete);
        }
      } else {
        for (const index of drivenSet) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const row = Math.floor(index / colsForIndexComplete);
          const col = index % colsForIndexComplete;
          const tile = getPatternTileForPosition(row, col);
          if (!tile) {
            continue;
          }
          nextTiles[index] = {
            imageIndex: tile.imageIndex,
            rotation: tile.rotation,
            mirrorX: tile.mirrorX,
            mirrorY: tile.mirrorY,
            name: tile.name,
            placedOrder: placementOrderRef.current,
          };
        }
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    if (brush.mode === 'random' || brush.mode === 'draw') {
      const nextTiles = [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)];
      if (tileSourcesLength <= 0) {
        return;
      }
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        const indicesToScanRand = isZoomed && zoomBounds ? allNonLockedIndicesSet : new Set(Array.from({ length: internalTotalCells }, (_, i) => i));
        for (const index of indicesToScanRand) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
        }
      } else if ((mirrorHorizontal || mirrorVertical) && selectionBounds) {
        for (const index of modifiableIndicesSet) {
          if (nextTiles[index].imageIndex >= 0) continue;
          const targets = getMirrorTargets(index);
          if (targets.some((t) => nextTiles[t]?.imageIndex >= 0)) drivenSet.add(index);
        }
      }
      for (const index of drivenSet) {
        if (nextTiles[index].imageIndex >= 0) {
          continue;
        }
        const placement = getRandomPlacement(
          index,
          nextTiles,
          false,
          floodAllowSetComplete
        );
        applyPlacementsToArray(nextTiles, getMirroredPlacements(index, placement), index, floodAllowSetComplete);
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    const sourceNameRand =
      getFixedBrushSourceName?.() ?? brush.sourceName ?? null;
    const indexByNameRand =
      sourceNameRand != null
        ? getTileSourceIndexByName(tileSources, sourceNameRand)
        : -1;
    const fixedIndexRand = indexByNameRand >= 0 ? indexByNameRand : brush.index;
    const fixedNameRand = sourceNameRand ?? tileSources[fixedIndexRand]?.name;
    if (fixedIndexRand < 0 || fixedIndexRand >= tileSourcesLength) {
      return;
    }
    withBulkUpdate(() => {
      setTiles((prev) => {
      const nextTiles = [...normalizeTiles(prev, internalTotalCells, tileSourcesLength)];
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        const indicesToScanFixed = isZoomed && zoomBounds ? allNonLockedIndicesSet : new Set(Array.from({ length: internalTotalCells }, (_, i) => i));
        for (const index of indicesToScanFixed) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
        }
      } else if ((mirrorHorizontal || mirrorVertical) && selectionBounds) {
        for (const index of modifiableIndicesSet) {
          if (nextTiles[index].imageIndex >= 0) continue;
          const targets = getMirrorTargets(index);
          if (targets.some((t) => nextTiles[t]?.imageIndex >= 0)) drivenSet.add(index);
        }
      }
      for (const index of drivenSet) {
        if (nextTiles[index].imageIndex >= 0) {
          continue;
        }
        applyPlacementsToArray(
          nextTiles,
          getMirroredPlacements(index, {
            imageIndex: fixedIndexRand,
            rotation: brush.rotation,
            mirrorX: false,
            mirrorY: false,
            name: fixedNameRand,
          }),
          index,
          floodAllowSetComplete
        );
      }
      return nextTiles;
      });
    });
  };

  const reconcileTiles = () => {
    if (internalTotalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    getNextPlacementOrder();
    const snapshot = normalizeTiles(tiles, internalTotalCells, tileSourcesLength);
    const nextTiles = [...snapshot];
    const allowedSet = randomSourceSet ?? null;
    const reconcileAllowSet =
      mirrorHorizontal || mirrorVertical
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    const maxPasses = Math.min(50, Math.max(8, gridLayout.rows + gridLayout.columns));
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let changed = false;
      // Visit tiles by placement order (oldest first) so the design is altered and latest strokes are preserved
      const indices = modifiableIndicesArray.filter(
        (i) => nextTiles[i]?.imageIndex >= 0
      );
      indices.sort(
        (a, b) =>
          (nextTiles[a].placedOrder ?? 0) - (nextTiles[b].placedOrder ?? 0)
      );
      for (const index of indices) {
        const tile = nextTiles[index];
        if (!tile || tile.imageIndex < 0) {
          continue;
        }
        if (
          isPlacementValid(index, tile, nextTiles, true, modifiableIndicesSet)
        ) {
          continue;
        }
        const candidates = buildCompatibleCandidates(
          index,
          nextTiles,
          allowedSet,
          true,
          modifiableIndicesSet
        );
        if (candidates.length === 0) {
          continue;
        }
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        applyPlacementsToArrayOverride(nextTiles, getMirroredPlacements(index, pick), reconcileAllowSet);
        changed = true;
      }
      if (!changed) {
        break;
      }
    }
    withBulkUpdate(() => {
      applyTiles(nextTiles);
    });
  };

  const controlledRandomize = () => {
    if (internalTotalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    getNextPlacementOrder();
    const allowedSet = randomSourceSet ?? null;
    const lookup = allowedSet
      ? (() => {
          const next = new Map<
            string,
            Array<{ index: number; rotation: number; mirrorX: boolean; mirrorY: boolean }>
          >();
          compatTables.variantsByIndex.forEach((variants, index) => {
            if (!allowedSet.has(index)) {
              return;
            }
            variants.forEach((variant) => {
              const existing = next.get(variant.key);
              const entry = {
                index: variant.index,
                rotation: variant.rotation,
                mirrorX: variant.mirrorX,
                mirrorY: variant.mirrorY,
              };
              if (existing) {
                existing.push(entry);
              } else {
                next.set(variant.key, [entry]);
              }
            });
          });
          return next;
        })()
      : compatTables.variantsByKey;

    const controlledRandomizeAllowSet =
      mirrorHorizontal || mirrorVertical
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    const nextTiles = [...normalizeTiles(tiles, internalTotalCells, tileSourcesLength)];
    for (const index of modifiableIndicesArray) {
      const current = nextTiles[index];
      if (!current || current.imageIndex < 0) {
        continue;
      }
      const transformed = compatTables.getConnectionsForPlacement(
        current.imageIndex,
        current.rotation,
        current.mirrorX,
        current.mirrorY
      );
      if (!transformed) {
        continue;
      }
      const key = toConnectionKey(transformed);
      if (!key) {
        continue;
      }
      const candidates = lookup.get(key);
      if (!candidates || candidates.length === 0) {
        continue;
      }
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      applyPlacementsToArrayOverride(
        nextTiles,
        getMirroredPlacements(index, {
          imageIndex: pick.index,
          rotation: pick.rotation,
          mirrorX: pick.mirrorX,
          mirrorY: pick.mirrorY,
          name: tileSources[pick.index]?.name,
        }),
        controlledRandomizeAllowSet ?? modifiableIndicesSet
      );
    }

    withBulkUpdate(() => {
      applyTiles(nextTiles);
    });
  };

  const resetTiles = () => {
    markClear();
    if (selectionBounds) {
      let indices: number[] = modifiableIndicesArray;
      if (mirrorHorizontal || mirrorVertical) {
        const clearSet = new Set(modifiableIndicesSet);
        modifiableIndicesSet.forEach((i) => getMirrorTargets(i).forEach((t) => clearSet.add(t)));
        indices = [...clearSet].filter((i) => !lockedCellIndices?.has(i));
      }
      if (indices.length === 0) {
        requestAnimationFrame(() => clearLogDone());
        return;
      }
      pushUndo();
      const empty = {
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      };
      withBulkUpdate(() => {
        setTiles((prev) => {
          const next = [...normalizeTiles(prev, internalTotalCells, tileSourcesLength)];
          for (const index of indices) {
            next[index] = { ...empty };
          }
          return next;
        });
      });
    } else {
      const nextTiles = buildInitialTiles(internalTotalCells);
      if (lockedCellIndices?.size) {
        const current = normalizeTiles(tiles, internalTotalCells, tileSourcesLength);
        lockedCellIndices.forEach((i) => {
          if (current[i]) nextTiles[i] = { ...current[i] };
        });
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
    }
    requestAnimationFrame(() => {
      clearLogDone();
    });
  };

  const loadTiles = useCallback(
    (nextTiles: Tile[]) => {
      undoStackRef.current = [];
      redoStackRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
      applyTilesInternal(nextTiles);
    },
    [applyTilesInternal]
  );

  const moveRegion = useCallback(
    (fromIndices: number[], toIndices: number[]) => {
      if (fromIndices.length !== toIndices.length || fromIndices.length === 0) {
        return;
      }
      pushUndo();
      const empty = {
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      };
      withBulkUpdate(() => {
        setTiles((prev) => {
          const current = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
          const tilesToPlace = fromIndices.map((i) => current[i] ?? empty);
          const next = [...current];
          fromIndices.forEach((index) => {
            if (!lockedCellIndices?.has(index)) {
              next[index] = { ...empty };
            }
          });
          toIndices.forEach((index, idx) => {
            if (!lockedCellIndices?.has(index) && index >= 0 && index < next.length) {
              next[index] = { ...tilesToPlace[idx] };
            }
          });
          return next;
        });
      });
    },
    [
      internalTotalCells,
      tileSourcesLength,
      lockedCellIndices,
      pushUndo,
    ]
  );

  const rotateRegion = useCallback(
    (minRow: number, maxRow: number, minCol: number, maxCol: number, gridColumns: number) => {
      const gridRows = fullGridLayout.rows;
      const height = maxRow - minRow + 1;
      const width = maxCol - minCol + 1;
      if (height <= 0 || width <= 0 || gridColumns <= 0 || gridRows <= 0) return;
      const centerRow = (minRow + maxRow) / 2;
      const centerCol = (minCol + maxCol) / 2;
      const newHeight = width;
      const newWidth = height;
      let newMinRow = Math.round(centerRow - (newHeight - 1) / 2);
      let newMaxRow = newMinRow + newHeight - 1;
      let newMinCol = Math.round(centerCol - (newWidth - 1) / 2);
      let newMaxCol = newMinCol + newWidth - 1;
      newMinRow = Math.max(0, Math.min(newMinRow, gridRows - 1));
      newMaxRow = Math.max(0, Math.min(newMaxRow, gridRows - 1));
      newMinCol = Math.max(0, Math.min(newMinCol, gridColumns - 1));
      newMaxCol = Math.max(0, Math.min(newMaxCol, gridColumns - 1));
      if (newMinRow > newMaxRow || newMinCol > newMaxCol) return;
      const fromIndices: number[] = [];
      const toIndices: number[] = [];
      for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
          fromIndices.push((minRow + r) * gridColumns + (minCol + c));
          const { newR, newC } = rotateCell(r, c, height, width, 90);
          toIndices.push((newMinRow + newR) * gridColumns + (newMinCol + newC));
        }
      }
      pushUndo();
      const empty = {
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      };
      withBulkUpdate(() => {
        setTiles((prev) => {
          const current = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
          const tilesToPlace = fromIndices.map((i) => current[i] ?? empty);
          const next = [...current];
          fromIndices.forEach((index) => {
            if (!lockedCellIndices?.has(index)) {
              next[index] = { ...empty };
            }
          });
          toIndices.forEach((index, idx) => {
            if (!lockedCellIndices?.has(index) && index >= 0 && index < next.length) {
              const tile = tilesToPlace[idx];
              const transformed = applyGroupRotationToTile(
                tile.rotation,
                tile.mirrorX,
                tile.mirrorY,
                90
              );
              next[index] = {
                ...tile,
                rotation: transformed.rotation,
                mirrorX: transformed.mirrorX,
                mirrorY: transformed.mirrorY,
              };
            }
          });
          return next;
        });
      });
    },
    [
      internalTotalCells,
      tileSourcesLength,
      lockedCellIndices,
      pushUndo,
      fullGridLayout.rows,
    ]
  );

  const setCloneSource = useCallback((cellIndex: number) => {
    const full = isZoomed ? visibleToFull(cellIndex) : cellIndex;
    cloneSourceRef.current = full;
    cloneAnchorRef.current = null;
    setCloneSourceIndex(cellIndex);
    setCloneSampleIndex(cellIndex);
    setCloneAnchorIndex(null);
    setCloneCursorIndex(null);
  }, [isZoomed, visibleToFull]);

  const mirrorZoomRegionToRestOfGrid = useCallback(() => {
    if (!isZoomed || !zoomBounds || (!mirrorHorizontal && !mirrorVertical)) {
      return;
    }
    const rows = fullGridLayout.rows;
    const cols = fullGridLayout.columns;
    if (rows <= 0 || cols <= 0) return;
    pushUndo();
    setTiles((prev) => {
      const current = normalizeTiles(prev, internalTotalCells, tileSourcesLength);
      const next = [...current];
      for (let r = zoomBounds!.minRow; r <= zoomBounds!.maxRow; r += 1) {
        for (let c = zoomBounds!.minCol; c <= zoomBounds!.maxCol; c += 1) {
          const fullIndex = r * cols + c;
          const tile = current[fullIndex];
          if (!tile) continue;
          if (lockedCellIndices?.has(fullIndex)) continue;
          if (mirrorHorizontal) {
            const mc = cols - 1 - c;
            const targetIndex = r * cols + mc;
            if (targetIndex >= 0 && targetIndex < next.length && !lockedCellIndices?.has(targetIndex)) {
              next[targetIndex] = { ...tile, mirrorX: !tile.mirrorX };
            }
          }
          if (mirrorVertical) {
            const mr = rows - 1 - r;
            const targetIndex = mr * cols + c;
            if (targetIndex >= 0 && targetIndex < next.length && !lockedCellIndices?.has(targetIndex)) {
              next[targetIndex] = { ...tile, mirrorY: !tile.mirrorY };
            }
          }
          if (mirrorHorizontal && mirrorVertical) {
            const mr = rows - 1 - r;
            const mc = cols - 1 - c;
            const targetIndex = mr * cols + mc;
            if (targetIndex >= 0 && targetIndex < next.length && !lockedCellIndices?.has(targetIndex)) {
              next[targetIndex] = {
                ...tile,
                rotation: (tile.rotation + 180) % 360,
                mirrorX: tile.mirrorX,
                mirrorY: tile.mirrorY,
              };
            }
          }
        }
      }
      return next;
    });
  }, [
    isZoomed,
    zoomBounds,
    mirrorHorizontal,
    mirrorVertical,
    fullGridLayout.rows,
    fullGridLayout.columns,
    internalTotalCells,
    tileSourcesLength,
    lockedCellIndices,
    pushUndo,
  ]);

  const emptyTile: Tile = useMemo(
    () => ({ imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }),
    []
  );
  const displayTiles = useMemo(() => {
    if (!isZoomed) return renderTiles;
    const len = renderTiles.length;
    return Array.from({ length: displayTotalCells }, (_, i) => {
      const fullIndex = visibleToFull(i);
      if (fullIndex < 0 || fullIndex >= len) return emptyTile;
      const t = renderTiles[fullIndex];
      return t ?? emptyTile;
    });
  }, [isZoomed, renderTiles, displayTotalCells, visibleToFull, emptyTile]);

  return {
    gridLayout,
    tiles: displayTiles,
    handlePress,
    randomFill,
    floodFill,
    floodComplete,
    reconcileTiles,
    controlledRandomize,
    resetTiles,
    loadTiles,
    undo,
    redo,
    pushUndoForDragStart: pushUndo,
    canUndo: undoCount > 0,
    canRedo: redoCount > 0,
    clearCloneSource,
    setCloneSource,
    cloneSourceIndex: brush.mode === 'clone' ? cloneSourceIndex : null,
    cloneSampleIndex: brush.mode === 'clone' ? cloneSampleIndex : null,
    cloneAnchorIndex: brush.mode === 'clone' ? cloneAnchorIndex : null,
    cloneCursorIndex: brush.mode === 'clone' ? cloneCursorIndex : null,
    totalCells,
    clearDrawStroke,
    fullGridColumnsForZoom: isZoomed ? fullGridLayout.columns : undefined,
    fullGridRowsForZoom: isZoomed ? fullGridLayout.rows : undefined,
    moveRegion,
    rotateRegion,
    fullTilesForSave: renderTiles,
    fullGridLayoutForSave: fullGridLayout,
    mirrorZoomRegionToRestOfGrid,
  };
};
