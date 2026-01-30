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
  minTiles: number;
  brush:
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'fixed'; index: number; rotation: number };
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
  totalCells: number;
};

export const useTileGrid = ({
  tileSources,
  availableWidth,
  availableHeight,
  gridGap,
  minTiles,
  brush,
  mirrorHorizontal,
  mirrorVertical,
}: Params): Result => {
  const tileSourcesLength = tileSources.length;
  const totalTiles = Math.max(tileSourcesLength, Math.max(minTiles, 0));
  const gridLayout = useMemo(
    () =>
      computeGridLayout(totalTiles, availableWidth, availableHeight, gridGap),
    [availableHeight, availableWidth, gridGap, totalTiles]
  );
  const totalCells = gridLayout.rows * gridLayout.columns;
  const [tiles, setTiles] = useState<Tile[]>(() =>
    buildInitialTiles(Math.max(totalCells, totalTiles))
  );
  const lastPressRef = useRef<{
    cellIndex: number;
    imageIndex: number;
    rotation: number;
    mirrorX: boolean;
    mirrorY: boolean;
    time: number;
  } | null>(null);

  const renderTiles = useMemo(
    () => normalizeTiles(tiles, totalCells, tileSourcesLength),
    [tiles, totalCells, tileSourcesLength]
  );

  const tileSourceMeta = useMemo(
    () =>
      tileSources.map((source) => ({
        ...source,
        connections: parseTileConnections(source.name),
      })),
    [tileSources]
  );

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
        let pairs: Array<[number, number]> = [];
        switch (index) {
          case 0: // N
            pairs = [[0, 4]];
            break;
          case 1: // NE
            pairs = [[1, 5]];
            break;
          case 2: // E
            pairs = [[2, 6]];
            break;
          case 3: // SE
            pairs = [[3, 7]];
            break;
          case 4: // S
            pairs = [[4, 0]];
            break;
          case 5: // SW
            pairs = [[5, 1]];
            break;
          case 6: // W
            pairs = [[6, 2]];
            break;
          case 7: // NW
            pairs = [[7, 3]];
            break;
          default:
            pairs = [];
        }
        return { pairs, connections: transformedNeighbor };
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

      let pairs: Array<[number, number]> = [];
      switch (index) {
        case 0:
          pairs = [[0, 4]];
          break;
        case 1:
          pairs = [[1, 5]];
          break;
        case 2:
          pairs = [[2, 6]];
          break;
        case 3:
          pairs = [[3, 7]];
          break;
        case 4:
          pairs = [[4, 0]];
          break;
        case 5:
          pairs = [[5, 1]];
          break;
        case 6:
          pairs = [[6, 2]];
          break;
        case 7:
          pairs = [[7, 3]];
          break;
        default:
          pairs = [];
      }

      return pairs.every(
        ([candidateIndex, neighborIndexValue]) =>
          transformed[candidateIndex] === neighborTransformed[neighborIndexValue]
      );
    });
  };

  useEffect(() => {
    setTiles(
      buildInitialTiles(Math.max(totalCells, totalTiles))
    );
  }, [totalTiles, totalCells]);

  useEffect(() => {
    setTiles((prev) => normalizeTiles(prev, totalCells, tileSourcesLength));
  }, [totalCells, tileSourcesLength]);

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
    if (brush.mode === 'fixed') {
      const fixedIndex = brush.index;
      if (fixedIndex >= 0 && fixedIndex < tileSourcesLength) {
        applyPlacement(cellIndex, {
          imageIndex: fixedIndex,
          rotation: brush.rotation,
          mirrorX: false,
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
    if (brush.mode === 'random') {
      randomFill();
      return;
    }
    const fixedIndex = brush.index;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
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
    if (brush.mode === 'random') {
      const nextTiles = [
        ...normalizeTiles(tiles, totalCells, tileSourcesLength),
      ];
      if (tileSourcesLength <= 0) {
        return;
      }
      for (let index = 0; index < totalCells; index += 1) {
        if (nextTiles[index].imageIndex >= 0) {
          continue;
        }
        const selection = selectCompatibleTile(index, nextTiles);
        nextTiles[index] =
          selection ?? { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false };
      }
      setTiles(nextTiles);
      return;
    }
    const fixedIndex = brush.index;
    if (fixedIndex < 0 || fixedIndex >= tileSourcesLength) {
      return;
    }
    setTiles((prev) =>
      normalizeTiles(prev, totalCells, tileSourcesLength).map((tile) =>
        tile.imageIndex < 0
          ? {
              imageIndex: fixedIndex,
              rotation: brush.rotation,
              mirrorX: false,
              mirrorY: false,
            }
          : tile
      )
    );
  };

  const resetTiles = () => {
    setTiles(buildInitialTiles(totalCells));
  };

  return {
    gridLayout,
    tiles: renderTiles,
    handlePress,
    randomFill,
    floodFill,
    floodComplete,
    resetTiles,
    totalCells,
  };
};
