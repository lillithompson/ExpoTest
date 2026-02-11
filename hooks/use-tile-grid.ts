import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { validateDrawStroke } from '@/utils/draw-stroke';
import { buildCompatibilityTables } from '@/utils/tile-compat';
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
  const gridLayout = useMemo(() => {
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
  const totalCells = Math.min(
    gridLayout.rows * gridLayout.columns,
    MAX_TILE_CANVAS_CELLS
  );
  const selectionBounds = useMemo(() => {
    if (!canvasSelection || gridLayout.columns === 0) {
      return null;
    }
    const startRow = Math.floor(canvasSelection.start / gridLayout.columns);
    const startCol = canvasSelection.start % gridLayout.columns;
    const endRow = Math.floor(canvasSelection.end / gridLayout.columns);
    const endCol = canvasSelection.end % gridLayout.columns;
    return {
      minRow: Math.min(startRow, endRow),
      maxRow: Math.max(startRow, endRow),
      minCol: Math.min(startCol, endCol),
      maxCol: Math.max(startCol, endCol),
    };
  }, [canvasSelection, gridLayout.columns]);

  const lockedCellIndices = useMemo(() => {
    if (!lockedCells?.length) {
      return null;
    }
    return new Set(lockedCells);
  }, [lockedCells]);

  const modifiableIndicesSet = useMemo(() => {
    const cols = gridLayout.columns;
    const maxR = mirrorVertical ? Math.floor(gridLayout.rows / 2) : gridLayout.rows;
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
  ]);

  const modifiableIndicesArray = useMemo(() => Array.from(modifiableIndicesSet), [modifiableIndicesSet]);

  /** All non-locked indices (full grid). Used when mirror is on so mirrored placements can write to the mirror half. */
  const allNonLockedIndicesSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < totalCells; i += 1) {
      if (!lockedCellIndices?.has(i)) set.add(i);
    }
    return set;
  }, [totalCells, lockedCellIndices]);

  /** Allow set for writing draw/placement results: full grid when mirror on (so mirror targets get written), else modifiable only. */
  const drawPlacementAllowSet = useMemo(
    () =>
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet,
    [
      mirrorHorizontal,
      mirrorVertical,
      selectionBounds,
      lockedCellIndices,
      allNonLockedIndicesSet,
      modifiableIndicesSet,
    ]
  );

  const [tiles, setTiles] = useState<Tile[]>(() =>
    buildInitialTiles(totalCells)
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
    () => normalizeTiles(tiles, totalCells, tileSourcesLength),
    [tiles, totalCells, tileSourcesLength]
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
        const normalizedNext = normalizeTiles(nextTiles, totalCells, tileSourcesLength);
        const normalizedPrev = normalizeTiles(prev, totalCells, tileSourcesLength);
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
    [totalCells, tileSourcesLength]
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
      const prevNorm = normalizeTiles(prev, totalCells, tileSourcesLength);
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
      return normalizeTiles(next, totalCells, tileSourcesLength);
    });
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }, [totalCells, tileSourcesLength]);

  const redo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) {
      return;
    }
    isUndoRedoRef.current = true;
    setTiles((prev) => {
      const prevNorm = normalizeTiles(prev, totalCells, tileSourcesLength);
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
      return normalizeTiles(next, totalCells, tileSourcesLength);
    });
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    requestAnimationFrame(() => {
      isUndoRedoRef.current = false;
    });
  }, [totalCells, tileSourcesLength]);

  useEffect(() => {
    setTiles((prev) => (prev.length === totalCells ? prev : buildInitialTiles(totalCells)));
  }, [totalCells]);

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
    const cols = gridLayout.columns;
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
      gridLayout.columns,
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

    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
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
        if (r < 0 || c < 0 || r >= gridLayout.rows || c >= gridLayout.columns) {
          if (!allowEdgeConnections) {
            return { pairs: getPairsForDirection(index), connections: new Array(8).fill(false) };
          }
          return null;
        }
        const neighborIndex = r * gridLayout.columns + c;
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
        const neighborConnections = compatTables.getConnectionsForPlacement(
          neighborTile.imageIndex,
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
    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
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
      if (r < 0 || c < 0 || r >= gridLayout.rows || c >= gridLayout.columns) {
        continue;
      }
      const neighborIndex = r * gridLayout.columns + c;
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

    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
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
      if (r < 0 || c < 0 || r >= gridLayout.rows || c >= gridLayout.columns) {
        if (!allowEdgeConnections) {
          return getPairsForDirection(index).every(
            ([candidateIndex]) => transformed[candidateIndex] === false
          );
        }
        return true;
      }
      const neighborIndex = r * gridLayout.columns + c;
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
      const neighborTransformed = compatTables.getConnectionsForPlacement(
        neighborTile.imageIndex,
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
    setTiles((prev) => normalizeTiles(prev, totalCells, tileSourcesLength));
  }, [totalCells, tileSourcesLength]);

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
        normalizeTiles(prev, totalCells, previousSources.length).map((tile) =>
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
      normalizeTiles(prev, totalCells, previousSources.length).map((tile) => {
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
  }, [tileSourcesKey, suspendRemap, tileSourcesLength, totalCells, compatTables, tileSources]);

  const getMirroredPlacements = (cellIndex: number, placement: Tile) => {
    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
    const placements = new Map<number, Tile>();
    placements.set(cellIndex, placement);

    if (mirrorHorizontal) {
      const index = row * gridLayout.columns + (gridLayout.columns - 1 - col);
      placements.set(index, {
        ...placement,
        mirrorX: !placement.mirrorX,
      });
    }
    if (mirrorVertical) {
      const index = (gridLayout.rows - 1 - row) * gridLayout.columns + col;
      placements.set(index, {
        ...placement,
        mirrorY: !placement.mirrorY,
      });
    }
    if (mirrorHorizontal && mirrorVertical) {
      const index =
        (gridLayout.rows - 1 - row) * gridLayout.columns +
        (gridLayout.columns - 1 - col);
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
    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
    const targets = new Set<number>();

    if (mirrorHorizontal) {
      targets.add(row * gridLayout.columns + (gridLayout.columns - 1 - col));
    }
    if (mirrorVertical) {
      targets.add((gridLayout.rows - 1 - row) * gridLayout.columns + col);
    }
    if (mirrorHorizontal && mirrorVertical) {
      targets.add(
        (gridLayout.rows - 1 - row) * gridLayout.columns +
          (gridLayout.columns - 1 - col)
      );
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
      normalizeTiles(prev, totalCells, tileSourcesLength).map((tile, index) => {
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
      return normalizeTiles(next, totalCells, tileSourcesLength);
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
    return normalizeTiles(next, totalCells, tileSourcesLength);
  };

  const clearDrawStroke = useCallback(() => {
    const stroke = [...drawStrokeRef.current];
    drawStrokeRef.current = [];
    if (stroke.length > 0) {
      setTiles((prev) => {
        getNextPlacementOrder();
        const next = applyFinalizeStrokeToTiles(prev, stroke, drawPlacementAllowSet);
        return tilesEqual(prev, next) ? prev : next;
      });
    }
  }, [drawPlacementAllowSet, applyFinalizeStrokeToTiles, tilesEqual]);

  const getPatternTileForPosition = (row: number, col: number) => {
    if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
      return null;
    }
    const rotationCW = ((pattern.rotation % 360) + 360) % 360;
    const rotationCCW = (360 - rotationCW) % 360;
    const rotW = rotationCW % 180 === 0 ? pattern.width : pattern.height;
    const rotH = rotationCW % 180 === 0 ? pattern.height : pattern.width;
    const localRow = ((row % rotH) + rotH) % rotH;
    const localCol = ((col % rotW) + rotW) % rotW;
    let mappedRow = localRow;
    let mappedCol = localCol;
    if (pattern.mirrorX) {
      mappedCol = rotW - 1 - mappedCol;
    }
    let sourceRow = mappedRow;
    let sourceCol = mappedCol;
    if (rotationCCW === 90) {
      sourceRow = mappedCol;
      sourceCol = pattern.width - 1 - mappedRow;
    } else if (rotationCCW === 180) {
      sourceRow = pattern.height - 1 - mappedRow;
      sourceCol = pattern.width - 1 - mappedCol;
    } else if (rotationCCW === 270) {
      sourceRow = pattern.height - 1 - mappedCol;
      sourceCol = mappedRow;
    }
    const patternIndex = sourceRow * pattern.width + sourceCol;
    const patternTile = pattern.tiles[patternIndex];
    if (!patternTile) {
      return null;
    }
    return {
      imageIndex: patternTile.imageIndex,
      rotation: (patternTile.rotation + rotationCW) % 360,
      mirrorX: patternTile.mirrorX !== pattern.mirrorX,
      mirrorY: patternTile.mirrorY,
      name: patternTile.name,
    };
  };

  const handlePress = (cellIndex: number) => {
    if (lockedCellIndices?.has(cellIndex)) {
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
      applyPlacement(cellIndex, {
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
      if (gridLayout.rows === 0 || gridLayout.columns === 0) {
        return;
      }
      setCloneCursorIndex(cellIndex);
      if (!cloneAnchorRef.current && cloneAnchorRef.current !== 0) {
        cloneAnchorRef.current = cellIndex;
        setCloneAnchorIndex(cellIndex);
      }
      const anchorIndex = cloneAnchorRef.current ?? cellIndex;
      const anchorRow = Math.floor(anchorIndex / gridLayout.columns);
      const anchorCol = anchorIndex % gridLayout.columns;
      const sourceRow = Math.floor(sourceIndex / gridLayout.columns);
      const sourceCol = sourceIndex % gridLayout.columns;
      const destRow = Math.floor(cellIndex / gridLayout.columns);
      const destCol = cellIndex % gridLayout.columns;
      const rowOffset = destRow - anchorRow;
      const colOffset = destCol - anchorCol;
      const mappedRow =
        ((sourceRow + rowOffset) % gridLayout.rows + gridLayout.rows) %
        gridLayout.rows;
      const mappedCol =
        ((sourceCol + colOffset) % gridLayout.columns + gridLayout.columns) %
        gridLayout.columns;
      const mappedIndex = mappedRow * gridLayout.columns + mappedCol;
      setCloneSampleIndex(mappedIndex);
      const sourceTile = renderTiles[mappedIndex];
      if (!sourceTile) {
        return;
      }
      applyPlacement(cellIndex, {
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
      if (gridLayout.rows === 0 || gridLayout.columns === 0) {
        return;
      }
      if (patternAnchorRef.current === null) {
        patternAnchorRef.current = cellIndex;
      }
      const anchorIndex = patternAnchorRef.current ?? cellIndex;
      const anchorRow = Math.floor(anchorIndex / gridLayout.columns);
      const anchorCol = anchorIndex % gridLayout.columns;
      const destRow = Math.floor(cellIndex / gridLayout.columns);
      const destCol = cellIndex % gridLayout.columns;
      const rowOffset = destRow - anchorRow;
      const colOffset = destCol - anchorCol;
      const tile = getPatternTileForPosition(rowOffset, colOffset);
      if (!tile) {
        return;
      }
      applyPlacement(cellIndex, {
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
        applyPlacement(cellIndex, {
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
    const current = renderTiles[cellIndex];
    if (!current) {
      return;
    }
    const placementOrder = getNextPlacementOrder();
    const now = Date.now();
    const cached =
      lastPressRef.current &&
      lastPressRef.current.cellIndex === cellIndex &&
      now - lastPressRef.current.time < 150
        ? lastPressRef.current
        : null;

    if (cached) {
      lastPressRef.current = { ...cached, time: now };
      setTiles((prev) =>
        normalizeTiles(prev, totalCells, tileSourcesLength).map((tile, index) =>
          index === cellIndex
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
      getInitializedNeighborCount(cellIndex, renderTiles) > 0;
    const stroke = drawStrokeRef.current;
    const isDrawFirst = brush.mode === 'draw' && stroke.length === 0;
    const isDrawSubsequent = brush.mode === 'draw' && stroke.length >= 1;
    // When starting a draw stroke (first tile or new stroke on non-adjacent cell), treat all tiles as empty so we overwrite regardless of existing content.
    const drawOverwriteTilesState: Tile[] | null =
      brush.mode === 'draw'
        ? Array.from(
            { length: totalCells },
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
          cellIndex,
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
        cellIndex,
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
      !isPlacementValid(cellIndex, selection, tilesForValidation, treatUninitForValidation, modifiableIndicesSet)
    ) {
      if (randomRequiresLegal) {
        return;
      }
      if (brush.mode === 'draw') {
        return;
      }
      setTiles((prev) =>
        normalizeTiles(prev, totalCells, tileSourcesLength).map((tile, index) =>
          index === cellIndex
            ? { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false }
            : tile
        )
      );
      return;
    }

    if (isDrawSubsequent) {
      const prevIndex = stroke[stroke.length - 1];
      const prevPrevIndex = stroke.length >= 2 ? stroke[stroke.length - 2] : undefined;
      const dirToPrev = getDirectionFromTo(cellIndex, prevIndex);
      if (dirToPrev < 0) {
        // User moved to a non-adjacent cell (e.g. moved too fast): finalize current stroke, then start a new stroke at this cell
        const strokeToFinalize = [...stroke];
        let firstCandidates = getCandidatesWithConnectionCount(1, randomSourceSet);
        if (firstCandidates.length === 0) {
          firstCandidates = getCandidatesWithConnectionCount(1, null);
        }
        const validFirst = firstCandidates.filter((t) =>
          isPlacementValid(
            cellIndex,
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
              drawPlacementAllowSet
            );
            applyPlacementsToArrayOverride(
              next,
              getMirroredPlacements(cellIndex, {
                imageIndex: newStrokeFirst.imageIndex,
                rotation: newStrokeFirst.rotation,
                mirrorX: newStrokeFirst.mirrorX,
                mirrorY: newStrokeFirst.mirrorY,
                name: newStrokeFirst.name,
              }),
              drawPlacementAllowSet ?? undefined
            );
            return normalizeTiles(next, totalCells, tileSourcesLength);
          });
          drawStrokeRef.current = [cellIndex];
          lastPressRef.current = {
            cellIndex,
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
      const dirFromPrevToN = getDirectionFromTo(prevIndex, cellIndex);
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
        getMirroredPlacements(cellIndex, {
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
        totalCells,
        tileSourcesLength
      );
      const newStroke = [...stroke, cellIndex];
      if (!isStrokeValid(newStroke, normalizedNext)) {
        return;
      }
      setTiles((prev) => {
        if (tilesEqual(prev, normalizedNext)) return prev;
        return normalizedNext;
      });
      drawStrokeRef.current = newStroke;
      lastPressRef.current = {
        cellIndex,
        imageIndex: drawSelection.imageIndex,
        rotation: drawSelection.rotation,
        mirrorX: drawSelection.mirrorX,
        mirrorY: drawSelection.mirrorY,
        time: now,
      };
      return;
    }

    lastPressRef.current = {
      cellIndex,
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
      time: now,
    };

    if (brush.mode === 'draw') {
      drawStrokeRef.current = [...stroke, cellIndex];
    }

    applyPlacement(cellIndex, {
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
      name: selection.name,
    });
  };

  const randomFill = () => {
    if (totalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    const nextTiles = buildInitialTiles(totalCells);
    if (lockedCellIndices?.size) {
      const current = normalizeTiles(tiles, totalCells, tileSourcesLength);
      lockedCellIndices.forEach((i) => {
        if (current[i]) nextTiles[i] = { ...current[i] };
      });
    }
    const mirrorNoSelection = (mirrorHorizontal || mirrorVertical) && !selectionBounds;
    const allowSet = mirrorNoSelection
      ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
      : (lockedCellIndices ? modifiableIndicesSet : null);
    getNextPlacementOrder();
    if (mirrorNoSelection) {
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
      const startIndex = Math.floor(Math.random() * totalCells);
      for (let offset = 0; offset < totalCells; offset += 1) {
        const index = (startIndex + offset) % totalCells;
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
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    const floodAllowSet =
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    const floodClearSet =
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
        ? allNonLockedIndicesSet
        : modifiableIndicesSet;
    if (brush.mode === 'erase') {
      if (floodClearSet.size > 0) {
        const empty = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        withBulkUpdate(() => {
          setTiles((prev) => {
            const next = [...normalizeTiles(prev, totalCells, tileSourcesLength)];
            floodClearSet.forEach((index) => {
              next[index] = { ...empty };
            });
            return next;
          });
        });
      } else if (!selectionBounds) {
        withBulkUpdate(() => {
          applyTiles(buildInitialTiles(totalCells));
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
        selectionBounds || lockedCellIndices?.size
          ? [...normalizeTiles(tiles, totalCells, tileSourcesLength)]
          : buildInitialTiles(totalCells);
      if (selectionBounds && !mirrorHorizontal && !mirrorVertical) {
        modifiableIndicesSet.forEach((index) => {
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
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
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
          const tile = getPatternTileForPosition(row, col);
          if (!tile) {
            continue;
          }
          applyPlacementsToArrayOverride(nextTiles, getMirroredPlacements(index, tile), floodAllowSet);
        }
      } else {
        for (const index of modifiableIndicesArray) {
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
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
      if (mirrorHorizontal || mirrorVertical || selectionBounds) {
        const nextTiles =
          selectionBounds || lockedCellIndices?.size
            ? [...normalizeTiles(tiles, totalCells, tileSourcesLength)]
            : buildInitialTiles(totalCells);
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
                  gridLayout.columns
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
          lockedCellIndices?.size
            ? [...normalizeTiles(tiles, totalCells, tileSourcesLength)]
            : buildInitialTiles(totalCells);
        const strokeOrder = getSpiralCellOrder(
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
            lockedCellIndices ? modifiableIndicesSet : undefined
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
        selectionBounds || lockedCellIndices?.size
          ? [...normalizeTiles(tiles, totalCells, tileSourcesLength)]
          : buildInitialTiles(totalCells);
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
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
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
          Array.from({ length: totalCells }, () => ({
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
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    const floodAllowSetComplete =
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
        ? (lockedCellIndices ? allNonLockedIndicesSet : undefined)
        : modifiableIndicesSet;
    const floodClearSetComplete =
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
        ? allNonLockedIndicesSet
        : modifiableIndicesSet;
    if (brush.mode === 'erase') {
      if (floodClearSetComplete.size > 0) {
        const empty = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        withBulkUpdate(() => {
          setTiles((prev) => {
            const next = [...normalizeTiles(prev, totalCells, tileSourcesLength)];
            floodClearSetComplete.forEach((index) => {
              next[index] = { ...empty };
            });
            return next;
          });
        });
      } else if (!selectionBounds) {
        withBulkUpdate(() => {
          applyTiles(buildInitialTiles(totalCells));
        });
      }
      return;
    }
    const drivenSet = new Set(modifiableIndicesSet);
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        for (let index = 0; index < totalCells; index += 1) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
        }
      }
      if (mirrorHorizontal || mirrorVertical) {
        for (const index of drivenSet) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
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
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
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
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
      if (tileSourcesLength <= 0) {
        return;
      }
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        for (let index = 0; index < totalCells; index += 1) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
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
      const nextTiles = [...normalizeTiles(prev, totalCells, tileSourcesLength)];
      if ((mirrorHorizontal || mirrorVertical) && !selectionBounds) {
        for (let index = 0; index < totalCells; index += 1) {
          if (nextTiles[index].imageIndex >= 0) {
            continue;
          }
          const targets = getMirrorTargets(index);
          if (targets.some((target) => nextTiles[target]?.imageIndex >= 0)) {
            drivenSet.add(index);
          }
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
    if (totalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    getNextPlacementOrder();
    const snapshot = normalizeTiles(tiles, totalCells, tileSourcesLength);
    const nextTiles = [...snapshot];
    const allowedSet = randomSourceSet ?? null;
    const reconcileAllowSet =
      (mirrorHorizontal || mirrorVertical) && !selectionBounds
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
    if (totalCells <= 0 || tileSourcesLength <= 0) {
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

    const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
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
        modifiableIndicesSet
      );
    }

    withBulkUpdate(() => {
      applyTiles(nextTiles);
    });
  };

  const resetTiles = () => {
    markClear();
    if (selectionBounds) {
      const indices = modifiableIndicesArray;
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
          const next = [...normalizeTiles(prev, totalCells, tileSourcesLength)];
          for (const index of indices) {
            next[index] = { ...empty };
          }
          return next;
        });
      });
    } else {
      const nextTiles = buildInitialTiles(totalCells);
      if (lockedCellIndices?.size) {
        const current = normalizeTiles(tiles, totalCells, tileSourcesLength);
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

  const setCloneSource = useCallback((cellIndex: number) => {
    cloneSourceRef.current = cellIndex;
    cloneAnchorRef.current = null;
    setCloneSourceIndex(cellIndex);
    setCloneSampleIndex(cellIndex);
    setCloneAnchorIndex(null);
    setCloneCursorIndex(null);
  }, []);

  return {
    gridLayout,
    tiles: renderTiles,
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
  };
};
