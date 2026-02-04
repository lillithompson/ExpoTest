import { useEffect, useMemo, useRef, useState } from 'react';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { parseTileConnections, transformConnections } from '@/utils/tile-compat';
import {
  buildInitialTiles,
  computeFixedGridLayout,
  computeGridLayout,
  normalizeTiles,
  pickRotation,
  type GridLayout,
  type Tile,
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
  randomDisallowEdgeConnections?: boolean;
  expectedConnectivity?: string;
  enforceExpectedConnectivity?: boolean;
  fixedRows?: number;
  fixedColumns?: number;
  brush:
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'pattern' }
    | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean };
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
  pattern:
    | { tiles: Tile[]; width: number; height: number; rotation: number; mirrorX: boolean }
    | null;
  patternAnchorKey?: string | null;
};

type Result = {
  gridLayout: GridLayout;
  tiles: Tile[];
  handlePress: (cellIndex: number) => void;
  randomFill: () => void;
  floodFill: () => void;
  floodComplete: () => void;
  resetTiles: () => void;
  loadTiles: (nextTiles: Tile[]) => void;
  clearCloneSource: () => void;
  setCloneSource: (cellIndex: number) => void;
  cloneSourceIndex: number | null;
  cloneSampleIndex: number | null;
  cloneAnchorIndex: number | null;
  cloneCursorIndex: number | null;
  totalCells: number;
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
  randomDisallowEdgeConnections = false,
  expectedConnectivity,
  enforceExpectedConnectivity = false,
  fixedRows,
  fixedColumns,
  brush,
  mirrorHorizontal,
  mirrorVertical,
  pattern,
  patternAnchorKey,
}: Params): Result => {
  const clearLogRef = useRef<{ clearId: number } | null>(null);
  const previousTileSourcesRef = useRef<TileSource[] | null>(null);
  const tileSourcesLength = tileSources.length;
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
  const totalCells = gridLayout.rows * gridLayout.columns;
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

  const renderTiles = useMemo(
    () => normalizeTiles(tiles, totalCells, tileSourcesLength),
    [tiles, totalCells, tileSourcesLength]
  );
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
        a.mirrorY !== b.mirrorY
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

  const applyTiles = (nextTiles: Tile[]) => {
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
          a.mirrorY !== b.mirrorY
        ) {
          changed += 1;
        }
      }
      logClearApply(changed, normalizedNext.length);
      return normalizedNext;
    });
  };

  useEffect(() => {
    setTiles((prev) => (prev.length === totalCells ? prev : buildInitialTiles(totalCells)));
  }, [totalCells]);

  const clearCloneSource = () => {
    cloneAnchorRef.current = null;
    cloneSourceRef.current = null;
    setCloneSourceIndex(null);
    setCloneSampleIndex(null);
    setCloneAnchorIndex(null);
    setCloneCursorIndex(null);
  };

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

  const tileSourceMeta = useMemo(
    () =>
      tileSources.map((source) => ({
        ...source,
        connections: parseTileConnections(source.name),
      })),
    [tileSources]
  );

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

  const hasOutOfBoundsConnection = (cellIndex: number, placement: Tile) => {
    if (!randomDisallowEdgeConnections) {
      return false;
    }
    const meta = tileSourceMeta[placement.imageIndex];
    if (!meta || !meta.connections) {
      return false;
    }
    const expectedBits = expectedConnectivity ?? '00000000';
    const isExpectedAllowed = (row: number, col: number, dirIndex: number) => {
      if (expectedBits.length < 8) {
        return false;
      }
      const topRow = 0;
      const bottomRow = gridLayout.rows - 1;
      const leftCol = 0;
      const rightCol = gridLayout.columns - 1;
      const midCol = Math.floor(gridLayout.columns / 2);
      const midRow = Math.floor(gridLayout.rows / 2);
      const hasEvenCols = gridLayout.columns % 2 === 0;
      const hasEvenRows = gridLayout.rows % 2 === 0;
      const leftMidCol = hasEvenCols ? gridLayout.columns / 2 - 1 : midCol;
      const rightMidCol = hasEvenCols ? gridLayout.columns / 2 : midCol;
      const topMidRow = hasEvenRows ? gridLayout.rows / 2 - 1 : midRow;
      const bottomMidRow = hasEvenRows ? gridLayout.rows / 2 : midRow;

      // Corners
      if (row === topRow && col === leftCol && dirIndex === 7) {
        return expectedBits[7] === '1'; // NW
      }
      if (row === topRow && col === rightCol && dirIndex === 1) {
        return expectedBits[1] === '1'; // NE
      }
      if (row === bottomRow && col === rightCol && dirIndex === 3) {
        return expectedBits[3] === '1'; // SE
      }
      if (row === bottomRow && col === leftCol && dirIndex === 5) {
        return expectedBits[5] === '1'; // SW
      }

      // Edges (N/E/S/W)
      if (expectedBits[0] === '1') {
        if (
          (hasEvenCols &&
            row === topRow &&
            ((col === leftMidCol && dirIndex === 1) ||
              (col === rightMidCol && dirIndex === 7))) ||
          (!hasEvenCols && row === topRow && col === midCol && dirIndex === 0)
        ) {
          return true;
        }
      }
      if (expectedBits[4] === '1') {
        if (
          (hasEvenCols &&
            row === bottomRow &&
            ((col === leftMidCol && dirIndex === 3) ||
              (col === rightMidCol && dirIndex === 5))) ||
          (!hasEvenCols && row === bottomRow && col === midCol && dirIndex === 4)
        ) {
          return true;
        }
      }
      if (expectedBits[2] === '1') {
        if (
          (hasEvenRows &&
            col === rightCol &&
            ((row === topMidRow && dirIndex === 3) ||
              (row === bottomMidRow && dirIndex === 1))) ||
          (!hasEvenRows && col === rightCol && row === midRow && dirIndex === 2)
        ) {
          return true;
        }
      }
      if (expectedBits[6] === '1') {
        if (
          (hasEvenRows &&
            col === leftCol &&
            ((row === topMidRow && dirIndex === 5) ||
              (row === bottomMidRow && dirIndex === 7))) ||
          (!hasEvenRows && col === leftCol && row === midRow && dirIndex === 6)
        ) {
          return true;
        }
      }
      return false;
    };
    const row = Math.floor(cellIndex / gridLayout.columns);
    const col = cellIndex % gridLayout.columns;
    const directions = [
      { dr: -1, dc: 0 }, // N
      { dr: -1, dc: 1 }, // NE
      { dr: 0, dc: 1 }, // E
      { dr: 1, dc: 1 }, // SE
      { dr: 1, dc: 0 }, // S
      { dr: 1, dc: -1 }, // SW
      { dr: 0, dc: -1 }, // W
      { dr: -1, dc: -1 }, // NW
    ];
    const transformed = transformConnections(
      meta.connections,
      placement.rotation,
      placement.mirrorX,
      placement.mirrorY
    );
    return directions.some((dir, index) => {
      const r = row + dir.dr;
      const c = col + dir.dc;
      if (r < 0 || c < 0 || r >= gridLayout.rows || c >= gridLayout.columns) {
        return transformed[index] && !isExpectedAllowed(row, col, index);
      }
      return false;
    });
  };

  const buildCompatibleCandidates = (cellIndex: number, tilesState: Tile[]) => {
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
        const neighborTile = tilesState[neighborIndex];
        if (!neighborTile || neighborTile.imageIndex < 0) {
          return null;
        }
        const neighborMeta = tileSourceMeta[neighborTile.imageIndex];
        if (!neighborMeta || !neighborMeta.connections) {
          return null;
        }
        const transformedNeighbor = transformConnections(
          neighborMeta.connections,
          neighborTile.rotation,
          neighborTile.mirrorX,
          neighborTile.mirrorY
        );
        return { pairs: getPairsForDirection(index), connections: transformedNeighbor };
      })
      .filter(
        (value): value is { pairs: Array<[number, number]>; connections: boolean[] } =>
          Boolean(value)
      );

    const candidates: Array<Tile> = [];

    tileSourceMeta.forEach((meta, index) => {
      if (!meta.connections) {
        candidates.push({
          imageIndex: index,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
        });
        return;
      }

      const rotations = [0, 90, 180, 270];
      const mirrorOptions = [
        { mirrorX: false, mirrorY: false },
        { mirrorX: true, mirrorY: false },
        { mirrorX: false, mirrorY: true },
        { mirrorX: true, mirrorY: true },
      ];

      rotations.forEach((rotation) => {
        mirrorOptions.forEach((mirror) => {
          const transformed = transformConnections(
            meta.connections,
            rotation,
            mirror.mirrorX,
            mirror.mirrorY
          );
          const matches = neighborConstraints.every((constraint) =>
            constraint.pairs.every(
              ([candidateIndex, neighborIndex]) =>
                transformed[candidateIndex] === constraint.connections[neighborIndex]
            )
          );
          if (matches) {
            candidates.push({
              imageIndex: index,
              rotation,
              mirrorX: mirror.mirrorX,
              mirrorY: mirror.mirrorY,
            });
          }
        });
      });
    });

    return candidates;
  };

  const selectCompatibleTile = (cellIndex: number, tilesState: Tile[]) => {
    const candidates = buildCompatibleCandidates(cellIndex, tilesState);
    if (candidates.length === 0) {
      return null;
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  };

  const selectCompatibleTileConstrained = (cellIndex: number, tilesState: Tile[]) => {
    const candidates = buildCompatibleCandidates(cellIndex, tilesState);
    if (candidates.length === 0) {
      return null;
    }
    const valid = candidates.filter(
      (candidate) =>
        isPlacementValid(cellIndex, candidate, tilesState) &&
        !hasOutOfBoundsConnection(cellIndex, candidate)
    );
    if (valid.length === 0) {
      return null;
    }
    return valid[Math.floor(Math.random() * valid.length)];
  };

  const isPlacementValid = (
    cellIndex: number,
    placement: Tile,
    tilesState: Tile[]
  ) => {
    const meta = tileSourceMeta[placement.imageIndex];
    if (!meta || !meta.connections) {
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

    const transformed = transformConnections(
      meta.connections,
      placement.rotation,
      placement.mirrorX,
      placement.mirrorY
    );

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
      const neighborTile = tilesState[neighborIndex];
      if (!neighborTile || neighborTile.imageIndex < 0) {
        return true;
      }
      const neighborMeta = tileSourceMeta[neighborTile.imageIndex];
      if (!neighborMeta || !neighborMeta.connections) {
        return true;
      }
      const neighborTransformed = transformConnections(
        neighborMeta.connections,
        neighborTile.rotation,
        neighborTile.mirrorX,
        neighborTile.mirrorY
      );

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
    const previousSources = previousTileSourcesRef.current;
    if (previousSources === tileSources) {
      return;
    }
    previousTileSourcesRef.current = tileSources;
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

    const nextConnections = tileSources.map((source) =>
      parseTileConnections(source.name)
    );
    const nextLookup = new Map<
      string,
      Array<{ index: number; rotation: number; mirrorX: boolean; mirrorY: boolean }>
    >();
    nextConnections.forEach((connections, index) => {
      if (!connections) {
        return;
      }
      const rotations = [0, 90, 180, 270];
      const mirrors = [
        { mirrorX: false, mirrorY: false },
        { mirrorX: true, mirrorY: false },
        { mirrorX: false, mirrorY: true },
        { mirrorX: true, mirrorY: true },
      ];
      rotations.forEach((rotation) => {
        mirrors.forEach(({ mirrorX, mirrorY }) => {
          const transformed = transformConnections(
            connections,
            rotation,
            mirrorX,
            mirrorY
          );
          const key = toConnectionKey(transformed);
          if (!key) {
            return;
          }
          const existing = nextLookup.get(key);
          const entry = { index, rotation, mirrorX, mirrorY };
          if (existing) {
            existing.push(entry);
          } else {
            nextLookup.set(key, [entry]);
          }
        });
      });
    });

    setTiles((prev) =>
      normalizeTiles(prev, totalCells, previousSources.length).map((tile) => {
        if (tile.imageIndex === -2) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        if (tile.imageIndex < 0) {
          return tile;
        }
        const previousSource = previousSources[tile.imageIndex];
        if (!previousSource) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const previousConnections = parseTileConnections(previousSource.name);
        if (!previousConnections) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const transformedPrevious = transformConnections(
          previousConnections,
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
        };
      })
    );
  }, [tileSources]);

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

  const getDrivenCellIndices = () => {
    const maxRow = mirrorVertical ? gridLayout.rows / 2 : gridLayout.rows;
    const maxCol = mirrorHorizontal ? gridLayout.columns / 2 : gridLayout.columns;
    const indices: number[] = [];
    for (let row = 0; row < maxRow; row += 1) {
      for (let col = 0; col < maxCol; col += 1) {
        indices.push(row * gridLayout.columns + col);
      }
    }
    return indices;
  };

  const applyPlacementsToArray = (
    nextTiles: Tile[],
    placements: Map<number, Tile>,
    driverIndex: number
  ) => {
    placements.forEach((placement, index) => {
      if (index < 0 || index >= nextTiles.length) {
        return;
      }
      if (index !== driverIndex && nextTiles[index]?.imageIndex >= 0) {
        return;
      }
      nextTiles[index] = placement;
    });
  };

  const applyPlacementsToArrayOverride = (
    nextTiles: Tile[],
    placements: Map<number, Tile>
  ) => {
    placements.forEach((placement, index) => {
      if (index < 0 || index >= nextTiles.length) {
        return;
      }
      nextTiles[index] = placement;
    });
  };

  const applyPlacement = (cellIndex: number, placement: Tile) => {
    const placements = getMirroredPlacements(cellIndex, placement);
    setTiles((prev) =>
      normalizeTiles(prev, totalCells, tileSourcesLength).map((tile, index) =>
        placements.get(index) ?? tile
      )
    );
  };

  const computeBorderConnectivity = (tilesArr: Tile[]) => {
    if (gridLayout.rows <= 0 || gridLayout.columns <= 0) {
      return '00000000';
    }
    const totalCells = gridLayout.rows * gridLayout.columns;
    const rendered = tilesArr.map((tile) => {
      if (!tile || tile.imageIndex < 0) {
        return null;
      }
      const meta = tileSourceMeta[tile.imageIndex];
      if (!meta?.connections) {
        return null;
      }
      return transformConnections(
        meta.connections,
        tile.rotation,
        tile.mirrorX,
        tile.mirrorY
      );
    });
    const indexAt = (row: number, col: number) => row * gridLayout.columns + col;
    const pick = (row: number, col: number, dirIndex: number) => {
      const index = indexAt(row, col);
      if (index < 0 || index >= totalCells) {
        return false;
      }
      const current = rendered[index];
      return Boolean(current?.[dirIndex]);
    };
    const topRow = 0;
    const bottomRow = gridLayout.rows - 1;
    const leftCol = 0;
    const rightCol = gridLayout.columns - 1;
    const midCol = Math.floor(gridLayout.columns / 2);
    const midRow = Math.floor(gridLayout.rows / 2);
    const hasEvenCols = gridLayout.columns % 2 === 0;
    const hasEvenRows = gridLayout.rows % 2 === 0;
    const leftMidCol = hasEvenCols ? gridLayout.columns / 2 - 1 : midCol;
    const rightMidCol = hasEvenCols ? gridLayout.columns / 2 : midCol;
    const topMidRow = hasEvenRows ? gridLayout.rows / 2 - 1 : midRow;
    const bottomMidRow = hasEvenRows ? gridLayout.rows / 2 : midRow;
    const north = hasEvenCols
      ? pick(topRow, leftMidCol, 1) || pick(topRow, rightMidCol, 7)
      : pick(topRow, midCol, 0);
    const south = hasEvenCols
      ? pick(bottomRow, leftMidCol, 3) || pick(bottomRow, rightMidCol, 5)
      : pick(bottomRow, midCol, 4);
    const east = hasEvenRows
      ? pick(topMidRow, rightCol, 3) || pick(bottomMidRow, rightCol, 1)
      : pick(midRow, rightCol, 2);
    const west = hasEvenRows
      ? pick(topMidRow, leftCol, 5) || pick(bottomMidRow, leftCol, 7)
      : pick(midRow, leftCol, 6);
    return [
      north,
      pick(topRow, rightCol, 1),
      east,
      pick(bottomRow, rightCol, 3),
      south,
      pick(bottomRow, leftCol, 5),
      west,
      pick(topRow, leftCol, 7),
    ]
      .map((value) => (value ? '1' : '0'))
      .join('');
  };

  const matchesExpectedConnectivity = (nextTiles: Tile[]) => {
    if (!enforceExpectedConnectivity || !expectedConnectivity) {
      return true;
    }
    const nextBits = computeBorderConnectivity(nextTiles);
    const currentBits = computeBorderConnectivity(
      normalizeTiles(tiles, totalCells, tileSourcesLength)
    );
    if (currentBits === expectedConnectivity) {
      return nextBits === expectedConnectivity;
    }
    for (let i = 0; i < expectedConnectivity.length; i += 1) {
      if (nextBits[i] === '1' && expectedConnectivity[i] !== '1') {
        return false;
      }
    }
    return true;
  };

  const matchesExpectedConnectivityExact = (nextTiles: Tile[]) => {
    if (!enforceExpectedConnectivity || !expectedConnectivity) {
      return true;
    }
    return computeBorderConnectivity(nextTiles) === expectedConnectivity;
  };

  const connectivityScore = (bits: string) => {
    if (!expectedConnectivity) {
      return 0;
    }
    let score = 0;
    for (let i = 0; i < expectedConnectivity.length; i += 1) {
      if (expectedConnectivity[i] === '1' && bits[i] === '1') {
        score += 1;
      }
    }
    return score;
  };

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
    };
  };

  const handlePress = (cellIndex: number) => {
    if (bulkUpdateRef.current) {
      return;
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
      });
      return;
    }
    if (brush.mode === 'fixed') {
      const fixedIndex = brush.index;
      if (fixedIndex >= 0 && fixedIndex < tileSourcesLength) {
        applyPlacement(cellIndex, {
          imageIndex: fixedIndex,
          rotation: brush.rotation,
          mirrorX: brush.mirrorX,
          mirrorY: false,
        });
      }
      return;
    }
    const current = renderTiles[cellIndex];
    if (!current) {
      return;
    }
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
              }
            : tile
        )
      );
      return;
    }

    const selection = randomDisallowEdgeConnections
      ? selectCompatibleTileConstrained(cellIndex, renderTiles)
      : selectCompatibleTile(cellIndex, renderTiles);
    if (
      !selection ||
      !isPlacementValid(cellIndex, selection, renderTiles) ||
      hasOutOfBoundsConnection(cellIndex, selection)
    ) {
      if (randomRequiresLegal) {
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

    lastPressRef.current = {
      cellIndex,
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
      time: now,
    };

    const placements = getMirroredPlacements(cellIndex, {
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
    });
    if (enforceExpectedConnectivity) {
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
      applyPlacementsToArrayOverride(nextTiles, placements);
      if (!matchesExpectedConnectivity(nextTiles)) {
        return;
      }
    }
    applyPlacement(cellIndex, {
      imageIndex: selection.imageIndex,
      rotation: selection.rotation,
      mirrorX: selection.mirrorX,
      mirrorY: selection.mirrorY,
    });
  };

  const randomFill = () => {
    const normalized = buildInitialTiles(totalCells);
    if (totalCells <= 0 || tileSourcesLength <= 0) {
      return;
    }
    const attemptFill = () => {
      const startIndex = Math.floor(Math.random() * totalCells);
      const nextTiles = [...normalized];
      for (let offset = 0; offset < totalCells; offset += 1) {
        const index = (startIndex + offset) % totalCells;
        if (enforceExpectedConnectivity && expectedConnectivity) {
          const candidates = buildCompatibleCandidates(index, nextTiles).filter(
            (candidate) =>
              isPlacementValid(index, candidate, nextTiles) &&
              !hasOutOfBoundsConnection(index, candidate)
          );
          let bestScore = -1;
          let bestCandidates: Tile[] = [];
          for (const candidate of candidates) {
            const placements = getMirroredPlacements(index, candidate);
            const preview = [...nextTiles];
            applyPlacementsToArrayOverride(preview, placements);
            if (!matchesExpectedConnectivity(preview)) {
              continue;
            }
            const score = connectivityScore(computeBorderConnectivity(preview));
            if (score > bestScore) {
              bestScore = score;
              bestCandidates = [candidate];
            } else if (score === bestScore) {
              bestCandidates.push(candidate);
            }
          }
          if (bestCandidates.length > 0) {
            const pick =
              bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
            applyPlacementsToArrayOverride(nextTiles, getMirroredPlacements(index, pick));
          } else {
            nextTiles[index] = randomRequiresLegal
              ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
              : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
          }
          continue;
        }
        const selection = randomDisallowEdgeConnections
          ? selectCompatibleTileConstrained(index, nextTiles)
          : selectCompatibleTile(index, nextTiles);
        const validSelection =
          selection &&
          isPlacementValid(index, selection, nextTiles) &&
          !hasOutOfBoundsConnection(index, selection)
            ? selection
            : null;
        if (validSelection) {
          const placements = getMirroredPlacements(index, validSelection);
          const preview = [...nextTiles];
          applyPlacementsToArrayOverride(preview, placements);
          if (matchesExpectedConnectivity(preview)) {
            applyPlacementsToArrayOverride(nextTiles, placements);
          }
        } else {
          nextTiles[index] = randomRequiresLegal
            ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
            : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
        }
      }
      return nextTiles;
    };
    if (enforceExpectedConnectivity && expectedConnectivity) {
      let attempt = 0;
      let best = attemptFill();
      while (attempt < 60 && !matchesExpectedConnectivityExact(best)) {
        best = attemptFill();
        attempt += 1;
      }
      withBulkUpdate(() => {
        applyTiles(best);
      });
      return;
    }
    const nextTiles = attemptFill();
    withBulkUpdate(() => {
      applyTiles(nextTiles);
    });
  };

  const floodFill = () => {
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'erase') {
      withBulkUpdate(() => {
        applyTiles(buildInitialTiles(totalCells));
      });
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const nextTiles = buildInitialTiles(totalCells);
      if (mirrorHorizontal || mirrorVertical) {
        for (const index of getDrivenCellIndices()) {
          const row = Math.floor(index / gridLayout.columns);
          const col = index % gridLayout.columns;
          const tile = getPatternTileForPosition(row, col);
          if (!tile) {
            continue;
          }
          applyPlacementsToArrayOverride(nextTiles, getMirroredPlacements(index, tile));
        }
      } else {
        for (let row = 0; row < gridLayout.rows; row += 1) {
          for (let col = 0; col < gridLayout.columns; col += 1) {
            const targetIndex = row * gridLayout.columns + col;
            const tile = getPatternTileForPosition(row, col);
            if (tile) {
              nextTiles[targetIndex] = {
                imageIndex: tile.imageIndex,
                rotation: tile.rotation,
                mirrorX: tile.mirrorX,
                mirrorY: tile.mirrorY,
              };
            }
          }
        }
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    if (brush.mode === 'random') {
      if (mirrorHorizontal || mirrorVertical) {
        const nextTiles = buildInitialTiles(totalCells);
        for (const index of getDrivenCellIndices()) {
          if (enforceExpectedConnectivity && expectedConnectivity) {
            const candidates = buildCompatibleCandidates(index, nextTiles).filter(
              (candidate) =>
                isPlacementValid(index, candidate, nextTiles) &&
                !hasOutOfBoundsConnection(index, candidate)
            );
            let bestScore = -1;
            let bestCandidates: Tile[] = [];
            for (const candidate of candidates) {
              const placements = getMirroredPlacements(index, candidate);
              const preview = [...nextTiles];
              applyPlacementsToArrayOverride(preview, placements);
              if (!matchesExpectedConnectivity(preview)) {
                continue;
              }
              const score = connectivityScore(computeBorderConnectivity(preview));
              if (score > bestScore) {
                bestScore = score;
                bestCandidates = [candidate];
              } else if (score === bestScore) {
                bestCandidates.push(candidate);
              }
            }
            if (bestCandidates.length > 0) {
              const pick =
                bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
              applyPlacementsToArrayOverride(
                nextTiles,
                getMirroredPlacements(index, pick)
              );
            } else {
              applyPlacementsToArrayOverride(
                nextTiles,
                getMirroredPlacements(index, {
                  imageIndex: -1,
                  rotation: 0,
                  mirrorX: false,
                  mirrorY: false,
                })
              );
            }
          } else {
            const selection = randomDisallowEdgeConnections
              ? selectCompatibleTileConstrained(index, nextTiles)
              : selectCompatibleTile(index, nextTiles);
            const placement =
              selection &&
              isPlacementValid(index, selection, nextTiles) &&
              !hasOutOfBoundsConnection(index, selection)
                ? selection
                : randomRequiresLegal
                  ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
                  : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
            const placements = getMirroredPlacements(index, placement);
            const preview = [...nextTiles];
            applyPlacementsToArrayOverride(preview, placements);
            if (matchesExpectedConnectivity(preview)) {
              applyPlacementsToArrayOverride(nextTiles, placements);
            }
          }
        }
        if (enforceExpectedConnectivity && expectedConnectivity) {
          let attempt = 0;
          let best = nextTiles;
          while (attempt < 60 && !matchesExpectedConnectivityExact(best)) {
            const retry = buildInitialTiles(totalCells);
            for (const index of getDrivenCellIndices()) {
              const selection = randomDisallowEdgeConnections
                ? selectCompatibleTileConstrained(index, retry)
                : selectCompatibleTile(index, retry);
              const placement =
                selection &&
                isPlacementValid(index, selection, retry) &&
                !hasOutOfBoundsConnection(index, selection)
                  ? selection
                  : randomRequiresLegal
                    ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
                    : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
              const placements = getMirroredPlacements(index, placement);
              const preview = [...retry];
              applyPlacementsToArrayOverride(preview, placements);
              if (matchesExpectedConnectivity(preview)) {
                applyPlacementsToArrayOverride(retry, placements);
              }
            }
            best = retry;
            attempt += 1;
          }
          withBulkUpdate(() => {
            applyTiles(best);
          });
          return;
        }
        withBulkUpdate(() => {
          applyTiles(nextTiles);
        });
        return;
      }
      randomFill();
      return;
    }
    const fixedIndex = brush.index;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
      return;
    }
    if (mirrorHorizontal || mirrorVertical) {
      const nextTiles = buildInitialTiles(totalCells);
      for (const index of getDrivenCellIndices()) {
        applyPlacementsToArrayOverride(
          nextTiles,
          getMirroredPlacements(index, {
            imageIndex: fixedIndex,
            rotation: brush.rotation,
            mirrorX: brush.mirrorX,
            mirrorY: false,
          })
        );
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    withBulkUpdate(() => {
      applyTiles(
        Array.from({ length: totalCells }, () => ({
          imageIndex: fixedIndex,
          rotation: brush.rotation,
          mirrorX: false,
          mirrorY: false,
        }))
      );
    });
  };

  const floodComplete = () => {
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'erase') {
      withBulkUpdate(() => {
        applyTiles(buildInitialTiles(totalCells));
      });
      return;
    }
    if (brush.mode === 'clone') {
      return;
    }
    if (brush.mode === 'pattern') {
      if (!pattern || pattern.width <= 0 || pattern.height <= 0) {
        return;
      }
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
      const drivenSet = new Set(getDrivenCellIndices());
      if (mirrorHorizontal || mirrorVertical) {
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
          applyPlacementsToArray(nextTiles, getMirroredPlacements(index, tile), index);
        }
      } else {
        for (let row = 0; row < gridLayout.rows; row += 1) {
          for (let col = 0; col < gridLayout.columns; col += 1) {
            const targetIndex = row * gridLayout.columns + col;
            if (nextTiles[targetIndex].imageIndex >= 0) {
              continue;
            }
            const tile = getPatternTileForPosition(row, col);
            if (!tile) {
              continue;
            }
            nextTiles[targetIndex] = {
              imageIndex: tile.imageIndex,
              rotation: tile.rotation,
              mirrorX: tile.mirrorX,
              mirrorY: tile.mirrorY,
            };
          }
        }
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    const drivenSet = new Set(getDrivenCellIndices());
    if (brush.mode === 'random') {
      const nextTiles = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
      if (tileSourcesLength <= 0) {
        return;
      }
      if (mirrorHorizontal || mirrorVertical) {
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
        if (enforceExpectedConnectivity && expectedConnectivity) {
          const candidates = buildCompatibleCandidates(index, nextTiles).filter(
            (candidate) =>
              isPlacementValid(index, candidate, nextTiles) &&
              !hasOutOfBoundsConnection(index, candidate)
          );
          let bestScore = -1;
          let bestCandidates: Tile[] = [];
          for (const candidate of candidates) {
            const placements = getMirroredPlacements(index, candidate);
            const preview = [...nextTiles];
            applyPlacementsToArrayOverride(preview, placements);
            if (!matchesExpectedConnectivity(preview)) {
              continue;
            }
            const score = connectivityScore(computeBorderConnectivity(preview));
            if (score > bestScore) {
              bestScore = score;
              bestCandidates = [candidate];
            } else if (score === bestScore) {
              bestCandidates.push(candidate);
            }
          }
          if (bestCandidates.length > 0) {
            const pick =
              bestCandidates[Math.floor(Math.random() * bestCandidates.length)];
            applyPlacementsToArray(nextTiles, getMirroredPlacements(index, pick), index);
          }
        } else {
          const selection = randomDisallowEdgeConnections
            ? selectCompatibleTileConstrained(index, nextTiles)
            : selectCompatibleTile(index, nextTiles);
          const placement =
            selection && !hasOutOfBoundsConnection(index, selection)
              ? selection
              : randomRequiresLegal
                ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
                : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
          const placements = getMirroredPlacements(index, placement);
          const preview = [...nextTiles];
          applyPlacementsToArrayOverride(preview, placements);
          if (matchesExpectedConnectivity(preview)) {
            applyPlacementsToArray(nextTiles, placements, index);
          }
        }
      }
      if (enforceExpectedConnectivity && expectedConnectivity) {
        let attempt = 0;
        let best = nextTiles;
        while (attempt < 60 && !matchesExpectedConnectivityExact(best)) {
          const retry = [...normalizeTiles(tiles, totalCells, tileSourcesLength)];
          const retryDriven = new Set(getDrivenCellIndices());
          if (mirrorHorizontal || mirrorVertical) {
            for (let index = 0; index < totalCells; index += 1) {
              if (retry[index].imageIndex >= 0) {
                continue;
              }
              const targets = getMirrorTargets(index);
              if (targets.some((target) => retry[target]?.imageIndex >= 0)) {
                retryDriven.add(index);
              }
            }
          }
          for (const index of retryDriven) {
            if (retry[index].imageIndex >= 0) {
              continue;
            }
            const selection = randomDisallowEdgeConnections
              ? selectCompatibleTileConstrained(index, retry)
              : selectCompatibleTile(index, retry);
            const placement =
              selection && !hasOutOfBoundsConnection(index, selection)
                ? selection
                : randomRequiresLegal
                  ? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
                  : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
            const placements = getMirroredPlacements(index, placement);
            const preview = [...retry];
            applyPlacementsToArrayOverride(preview, placements);
            if (matchesExpectedConnectivity(preview)) {
              applyPlacementsToArray(retry, placements, index);
            }
          }
          best = retry;
          attempt += 1;
        }
        withBulkUpdate(() => {
          applyTiles(best);
        });
        return;
      }
      withBulkUpdate(() => {
        applyTiles(nextTiles);
      });
      return;
    }
    const fixedIndex = brush.index;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
      return;
    }
    withBulkUpdate(() => {
      setTiles((prev) => {
      const nextTiles = [...normalizeTiles(prev, totalCells, tileSourcesLength)];
      if (mirrorHorizontal || mirrorVertical) {
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
            imageIndex: fixedIndex,
            rotation: brush.rotation,
            mirrorX: false,
            mirrorY: false,
          }),
          index
        );
      }
      return nextTiles;
      });
    });
  };

  const resetTiles = () => {
    markClear();
    withBulkUpdate(() => {
      applyTiles(buildInitialTiles(totalCells));
    });
    requestAnimationFrame(() => {
      clearLogDone();
    });
  };

  const loadTiles = (nextTiles: Tile[]) => {
    applyTiles(nextTiles);
  };

  const setCloneSource = (cellIndex: number) => {
    cloneSourceRef.current = cellIndex;
    cloneAnchorRef.current = null;
    setCloneSourceIndex(cellIndex);
    setCloneSampleIndex(cellIndex);
    setCloneAnchorIndex(null);
    setCloneCursorIndex(null);
  };

  return {
    gridLayout,
    tiles: renderTiles,
    handlePress,
    randomFill,
    floodFill,
    floodComplete,
    resetTiles,
    loadTiles,
    clearCloneSource,
    setCloneSource,
    cloneSourceIndex: brush.mode === 'clone' ? cloneSourceIndex : null,
    cloneSampleIndex: brush.mode === 'clone' ? cloneSampleIndex : null,
    cloneAnchorIndex: brush.mode === 'clone' ? cloneAnchorIndex : null,
    cloneCursorIndex: brush.mode === 'clone' ? cloneCursorIndex : null,
    totalCells,
  };
};
