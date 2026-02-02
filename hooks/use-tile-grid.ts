import { useEffect, useMemo, useRef, useState } from 'react';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { parseTileConnections, transformConnections } from '@/utils/tile-compat';
import {
  buildInitialTiles,
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
  brush:
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean };
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
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
  brush,
  mirrorHorizontal,
  mirrorVertical,
}: Params): Result => {
  const previousTileSourcesRef = useRef<TileSource[] | null>(null);
  const tileSourcesLength = tileSources.length;
  const gridLayout = useMemo(
    () => computeGridLayout(availableWidth, availableHeight, gridGap, preferredTileSize),
    [availableHeight, availableWidth, gridGap, preferredTileSize]
  );
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

  const renderTiles = useMemo(
    () => normalizeTiles(tiles, totalCells, tileSourcesLength),
    [tiles, totalCells, tileSourcesLength]
  );

  useEffect(() => {
    setTiles(buildInitialTiles(totalCells));
  }, [gridLayout.columns, gridLayout.rows, totalCells]);

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

  const selectCompatibleTile = (cellIndex: number, tilesState: Tile[]) => {
    if (tileSourcesLength <= 0) {
      return null;
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

    if (candidates.length === 0) {
      return null;
    }

    return candidates[Math.floor(Math.random() * candidates.length)];
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
    const nextLookup = new Map<string, number[]>();
    nextConnections.forEach((connections, index) => {
      const key = toConnectionKey(connections);
      if (!key) {
        return;
      }
      const existing = nextLookup.get(key);
      if (existing) {
        existing.push(index);
      } else {
        nextLookup.set(key, [index]);
      }
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
        const previousKey = toConnectionKey(previousConnections);
        if (!previousKey) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const candidates = nextLookup.get(previousKey);
        if (!candidates || candidates.length === 0) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        return {
          ...tile,
          imageIndex: candidates[0],
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

  const handlePress = (cellIndex: number) => {
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

    const selection = selectCompatibleTile(cellIndex, renderTiles);
    if (!selection || !isPlacementValid(cellIndex, selection, renderTiles)) {
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
    const startIndex = Math.floor(Math.random() * totalCells);
    const nextTiles = [...normalized];
    for (let offset = 0; offset < totalCells; offset += 1) {
      const index = (startIndex + offset) % totalCells;
      const selection = selectCompatibleTile(index, nextTiles);
      const validSelection =
        selection && isPlacementValid(index, selection, nextTiles)
          ? selection
          : null;
      nextTiles[index] =
        validSelection ?? { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
    }
    setTiles(nextTiles);
  };

  const floodFill = () => {
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'erase') {
      setTiles(buildInitialTiles(totalCells));
      return;
    }
    if (brush.mode === 'random') {
      if (mirrorHorizontal || mirrorVertical) {
        const nextTiles = buildInitialTiles(totalCells);
        for (const index of getDrivenCellIndices()) {
          const selection = selectCompatibleTile(index, nextTiles);
          const placement =
            selection && isPlacementValid(index, selection, nextTiles)
              ? selection
              : { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
          applyPlacementsToArrayOverride(
            nextTiles,
            getMirroredPlacements(index, placement)
          );
        }
        setTiles(nextTiles);
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
      setTiles(nextTiles);
      return;
    }
    setTiles(
      Array.from({ length: totalCells }, () => ({
        imageIndex: fixedIndex,
        rotation: brush.rotation,
        mirrorX: false,
        mirrorY: false,
      }))
    );
  };

  const floodComplete = () => {
    if (totalCells <= 0) {
      return;
    }
    if (brush.mode === 'erase') {
      setTiles(buildInitialTiles(totalCells));
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
        const selection = selectCompatibleTile(index, nextTiles);
        const placement =
          selection ?? { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
        applyPlacementsToArray(
          nextTiles,
          getMirroredPlacements(index, placement),
          index
        );
      }
      setTiles(nextTiles);
      return;
    }
    const fixedIndex = brush.index;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
      return;
    }
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
  };

  const resetTiles = () => {
    setTiles(buildInitialTiles(totalCells));
  };

  const loadTiles = (nextTiles: Tile[]) => {
    setTiles(normalizeTiles(nextTiles, totalCells, tileSourcesLength));
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
