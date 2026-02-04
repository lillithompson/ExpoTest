import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { TILE_CATEGORIES, TILE_MANIFEST, type TileCategory } from '@/assets/images/tiles/manifest';
import { mirrorConnections, parseTileConnections, rotateConnections } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';

export type TileSetTile = {
  id: string;
  name: string;
  tiles: Tile[];
  grid: { rows: number; columns: number };
  preferredTileSize: number;
  thumbnailUri: string | null;
  previewUri: string | null;
  expectedConnectivity: string;
  updatedAt: number;
};

export type TileSet = {
  id: string;
  name: string;
  category: TileCategory;
  resolution: number;
  lineWidth: number;
  lineColor: string;
  tiles: TileSetTile[];
  updatedAt: number;
};

const STORAGE_KEY = 'tile-sets-v1';

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const clampResolution = (value: number) => Math.min(8, Math.max(2, value));

const parseBits = (value: string) =>
  value.split('').map((digit) => digit === '1');

const toBits = (connections: boolean[] | null) =>
  connections ? connections.map((value) => (value ? '1' : '0')).join('') : '00000000';

const canonicalConnectivity = (bits: string) => {
  const base = parseBits(bits);
  const rotations = [0, 1, 2, 3];
  const mirrors = [
    { mirrorX: false, mirrorY: false },
    { mirrorX: true, mirrorY: false },
    { mirrorX: false, mirrorY: true },
    { mirrorX: true, mirrorY: true },
  ];
  const variants: string[] = [];
  rotations.forEach((rot) => {
    const rotated = rotateConnections(base as any, rot);
    mirrors.forEach((mirror) => {
      variants.push(toBits(mirrorConnections(rotated as any, mirror.mirrorX, mirror.mirrorY)));
    });
  });
  return variants.sort()[0];
};

const getCanonicalPatterns = () => {
  const patterns = new Set<string>();
  for (let i = 0; i < 256; i += 1) {
    const bits = i.toString(2).padStart(8, '0');
    patterns.add(canonicalConnectivity(bits));
  }
  return Array.from(patterns.values()).sort();
};

type Candidate = {
  imageIndex: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  connections: boolean[] | null;
};

const buildCandidates = (category: TileCategory) => {
  const sources = TILE_MANIFEST[category] ?? [];
  const candidates: Candidate[] = [];
  sources.forEach((source, index) => {
    const base = parseTileConnections(source.name);
    const rotations = [0, 90, 180, 270];
    const mirrors = [
      { mirrorX: false, mirrorY: false },
      { mirrorX: true, mirrorY: false },
      { mirrorX: false, mirrorY: true },
      { mirrorX: true, mirrorY: true },
    ];
    rotations.forEach((rotation) => {
      mirrors.forEach(({ mirrorX, mirrorY }) => {
        const transformed = base
          ? mirrorConnections(rotateConnections(base as any, rotation / 90) as any, mirrorX, mirrorY)
          : null;
        candidates.push({
          imageIndex: index,
          rotation,
          mirrorX,
          mirrorY,
          connections: transformed,
        });
      });
    });
  });
  return candidates;
};

const getBorderConnectivity = (
  tiles: Tile[],
  rows: number,
  columns: number,
  candidates: Candidate[]
) => {
  if (rows <= 0 || columns <= 0) {
    return '00000000';
  }
  const total = rows * columns;
  const rendered = tiles.map((tile) => {
    if (!tile || tile.imageIndex < 0) {
      return null;
    }
    const match = candidates.find(
      (candidate) =>
        candidate.imageIndex === tile.imageIndex &&
        candidate.rotation === tile.rotation &&
        candidate.mirrorX === tile.mirrorX &&
        candidate.mirrorY === tile.mirrorY
    );
    return match?.connections ?? null;
  });
  const indexAt = (row: number, col: number) => row * columns + col;
  const pick = (row: number, col: number, dirIndex: number) => {
    const index = indexAt(row, col);
    if (index < 0 || index >= total) {
      return false;
    }
    const current = rendered[index];
    return Boolean(current?.[dirIndex]);
  };
  const topRow = 0;
  const bottomRow = rows - 1;
  const leftCol = 0;
  const rightCol = columns - 1;
  const midCol = Math.floor(columns / 2);
  const midRow = Math.floor(rows / 2);
  const hasEvenCols = columns % 2 === 0;
  const hasEvenRows = rows % 2 === 0;
  const leftMidCol = hasEvenCols ? columns / 2 - 1 : midCol;
  const rightMidCol = hasEvenCols ? columns / 2 : midCol;
  const topMidRow = hasEvenRows ? rows / 2 - 1 : midRow;
  const bottomMidRow = hasEvenRows ? rows / 2 : midRow;
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

const buildEmptyTiles = (rows: number, columns: number) =>
  Array.from({ length: rows * columns }, () => ({
    imageIndex: -1,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
  }));

const isExpectedAllowed = (
  expectedBits: string,
  row: number,
  col: number,
  dirIndex: number,
  rows: number,
  columns: number
) => {
  if (expectedBits.length < 8) {
    return false;
  }
  const topRow = 0;
  const bottomRow = rows - 1;
  const leftCol = 0;
  const rightCol = columns - 1;
  const midCol = Math.floor(columns / 2);
  const midRow = Math.floor(rows / 2);
  const hasEvenCols = columns % 2 === 0;
  const hasEvenRows = rows % 2 === 0;
  const leftMidCol = hasEvenCols ? columns / 2 - 1 : midCol;
  const rightMidCol = hasEvenCols ? columns / 2 : midCol;
  const topMidRow = hasEvenRows ? rows / 2 - 1 : midRow;
  const bottomMidRow = hasEvenRows ? rows / 2 : midRow;

  if (row === topRow && col === leftCol && dirIndex === 7) {
    return expectedBits[7] === '1';
  }
  if (row === topRow && col === rightCol && dirIndex === 1) {
    return expectedBits[1] === '1';
  }
  if (row === bottomRow && col === rightCol && dirIndex === 3) {
    return expectedBits[3] === '1';
  }
  if (row === bottomRow && col === leftCol && dirIndex === 5) {
    return expectedBits[5] === '1';
  }
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

const canPlaceTile = (
  tiles: Tile[],
  rows: number,
  columns: number,
  index: number,
  candidate: Candidate,
  expectedBits: string,
  candidates: Candidate[]
) => {
  if (!candidate.connections) {
    return true;
  }
  const row = Math.floor(index / columns);
  const col = index % columns;
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
  for (let dirIndex = 0; dirIndex < directions.length; dirIndex += 1) {
    const dir = directions[dirIndex];
    const r = row + dir.dr;
    const c = col + dir.dc;
    if (r < 0 || c < 0 || r >= rows || c >= columns) {
      if (candidate.connections[dirIndex] && !isExpectedAllowed(expectedBits, row, col, dirIndex, rows, columns)) {
        return false;
      }
      continue;
    }
    const neighborIndex = r * columns + c;
    const neighbor = tiles[neighborIndex];
    if (!neighbor || neighbor.imageIndex < 0) {
      continue;
    }
    const neighborCandidate = candidates.find(
      (entry) =>
        entry.imageIndex === neighbor.imageIndex &&
        entry.rotation === neighbor.rotation &&
        entry.mirrorX === neighbor.mirrorX &&
        entry.mirrorY === neighbor.mirrorY
    );
    if (!neighborCandidate?.connections) {
      continue;
    }
    const opposite = (dirIndex + 4) % 8;
    if (candidate.connections[dirIndex] !== neighborCandidate.connections[opposite]) {
      return false;
    }
  }
  return true;
};

export const generateTileForExpected = (
  expectedBits: string,
  resolution: number,
  category: TileCategory
) => {
  const rows = resolution;
  const columns = resolution;
  const candidates = buildCandidates(category);
  if (candidates.length === 0 || rows <= 0 || columns <= 0) {
    return buildEmptyTiles(rows, columns);
  }
  const topRow = 0;
  const bottomRow = rows - 1;
  const leftCol = 0;
  const rightCol = columns - 1;
  const midCol = Math.floor(columns / 2);
  const midRow = Math.floor(rows / 2);
  const hasEvenCols = columns % 2 === 0;
  const hasEvenRows = rows % 2 === 0;
  const leftMidCol = hasEvenCols ? columns / 2 - 1 : midCol;
  const rightMidCol = hasEvenCols ? columns / 2 : midCol;
  const topMidRow = hasEvenRows ? rows / 2 - 1 : midRow;
  const bottomMidRow = hasEvenRows ? rows / 2 : midRow;
  const requiredPlacements: Array<{ row: number; col: number; dirIndex: number } | Array<{ row: number; col: number; dirIndex: number }>> = [];
  if (expectedBits[7] === '1') {
    requiredPlacements.push({ row: topRow, col: leftCol, dirIndex: 7 });
  }
  if (expectedBits[1] === '1') {
    requiredPlacements.push({ row: topRow, col: rightCol, dirIndex: 1 });
  }
  if (expectedBits[3] === '1') {
    requiredPlacements.push({ row: bottomRow, col: rightCol, dirIndex: 3 });
  }
  if (expectedBits[5] === '1') {
    requiredPlacements.push({ row: bottomRow, col: leftCol, dirIndex: 5 });
  }
  if (expectedBits[0] === '1') {
    requiredPlacements.push(
      hasEvenCols
        ? [
            { row: topRow, col: leftMidCol, dirIndex: 1 },
            { row: topRow, col: rightMidCol, dirIndex: 7 },
          ]
        : { row: topRow, col: midCol, dirIndex: 0 }
    );
  }
  if (expectedBits[4] === '1') {
    requiredPlacements.push(
      hasEvenCols
        ? [
            { row: bottomRow, col: leftMidCol, dirIndex: 3 },
            { row: bottomRow, col: rightMidCol, dirIndex: 5 },
          ]
        : { row: bottomRow, col: midCol, dirIndex: 4 }
    );
  }
  if (expectedBits[2] === '1') {
    requiredPlacements.push(
      hasEvenRows
        ? [
            { row: topMidRow, col: rightCol, dirIndex: 3 },
            { row: bottomMidRow, col: rightCol, dirIndex: 1 },
          ]
        : { row: midRow, col: rightCol, dirIndex: 2 }
    );
  }
  if (expectedBits[6] === '1') {
    requiredPlacements.push(
      hasEvenRows
        ? [
            { row: topMidRow, col: leftCol, dirIndex: 5 },
            { row: bottomMidRow, col: leftCol, dirIndex: 7 },
          ]
        : { row: midRow, col: leftCol, dirIndex: 6 }
    );
  }
  let attempt = 0;
  let best = buildEmptyTiles(rows, columns);
  let bestScore = -1;
  const maxAttempts = 240;
  while (attempt < maxAttempts) {
    const tiles = buildEmptyTiles(rows, columns);
    const placeRequired = () => {
      for (const requirement of requiredPlacements) {
        const options = Array.isArray(requirement) ? requirement : [requirement];
        const shuffledOptions = [...options].sort(() => Math.random() - 0.5);
        let placed = false;
        for (const req of shuffledOptions) {
          const index = req.row * columns + req.col;
          const shuffled = [...candidates].sort(() => Math.random() - 0.5);
          const candidate = shuffled.find(
            (entry) =>
              entry.connections?.[req.dirIndex] &&
              canPlaceTile(tiles, rows, columns, index, entry, expectedBits, candidates)
          );
          if (candidate) {
            tiles[index] = {
              imageIndex: candidate.imageIndex,
              rotation: candidate.rotation,
              mirrorX: candidate.mirrorX,
              mirrorY: candidate.mirrorY,
            };
            placed = true;
            break;
          }
        }
        if (!placed) {
          return false;
        }
      }
      return true;
    };
    if (!placeRequired()) {
      attempt += 1;
      continue;
    }
    const order = Array.from({ length: rows * columns }, (_, i) => i).sort(
      () => Math.random() - 0.5
    );
    order.forEach((index) => {
      if (tiles[index].imageIndex >= 0) {
        return;
      }
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      const candidate = shuffled.find((entry) =>
        canPlaceTile(tiles, rows, columns, index, entry, expectedBits, candidates)
      );
      if (!candidate) {
        return;
      }
      tiles[index] = {
        imageIndex: candidate.imageIndex,
        rotation: candidate.rotation,
        mirrorX: candidate.mirrorX,
        mirrorY: candidate.mirrorY,
      };
    });
    const bits = getBorderConnectivity(tiles, rows, columns, candidates);
    const score = bits
      .split('')
      .reduce((acc, value, i) => acc + (value === '1' && expectedBits[i] === '1' ? 1 : 0), 0);
    if (bits === expectedBits) {
      return tiles;
    }
    if (score > bestScore) {
      bestScore = score;
      best = tiles;
    }
    attempt += 1;
  }
  return best;
};

export const useTileSets = () => {
  const [tileSets, setTileSets] = useState<TileSet[]>([]);

  const loadFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<TileSet>[]) : [];
      const next = parsed.map((set) => {
        const category =
          typeof set.category === 'string' &&
          (TILE_CATEGORIES as string[]).includes(set.category)
            ? (set.category as TileCategory)
            : TILE_CATEGORIES[0];
        return {
          id: set.id ?? createId('tileset'),
          name: set.name ?? 'Tile Set',
          category,
          resolution: clampResolution(set.resolution ?? 4),
          lineWidth: set.lineWidth ?? 3,
          lineColor: set.lineColor ?? '#ffffff',
          tiles: (set.tiles ?? []).map((tile) => ({
            id: tile.id ?? createId('tile'),
            name: tile.name ?? 'Tile',
            tiles: tile.tiles ?? [],
              grid: tile.grid ?? { rows: 0, columns: 0 },
              preferredTileSize: tile.preferredTileSize ?? 45,
              thumbnailUri: tile.thumbnailUri ?? null,
              previewUri: tile.previewUri ?? null,
              expectedConnectivity: tile.expectedConnectivity ?? '00000000',
              updatedAt: tile.updatedAt ?? Date.now(),
            })),
          updatedAt: set.updatedAt ?? Date.now(),
        } as TileSet;
      });
      setTileSets(next);
    } catch (error) {
      console.warn('Failed to load tile sets', error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      await loadFromStorage();
      if (!mounted) {
        return;
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [loadFromStorage]);

  const persist = useCallback(async (next: TileSet[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to save tile sets', error);
    }
  }, []);

  const createTileSet = useCallback(
    (payload: {
      name?: string;
      category: TileCategory;
      resolution: number;
      lineWidth?: number;
      lineColor?: string;
    }) => {
      const expectedPatterns = getCanonicalPatterns();
      const nextSet: TileSet = {
        id: createId('tileset'),
        name: payload.name ?? 'New Tile Set',
        category: payload.category,
        resolution: clampResolution(payload.resolution),
        lineWidth: payload.lineWidth ?? 3,
        lineColor: payload.lineColor ?? '#ffffff',
        tiles: expectedPatterns.map((pattern, index) => ({
          id: createId('tile'),
          name: `Tile ${index + 1}`,
          tiles: generateTileForExpected(
            pattern,
            clampResolution(payload.resolution),
            payload.category
          ),
          grid: {
            rows: clampResolution(payload.resolution),
            columns: clampResolution(payload.resolution),
          },
          preferredTileSize: 45,
          thumbnailUri: null,
          previewUri: null,
          expectedConnectivity: pattern,
          updatedAt: Date.now(),
        })),
        updatedAt: Date.now(),
      };
      setTileSets((prev) => {
        const next = [nextSet, ...prev];
        void persist(next);
        return next;
      });
      return nextSet.id;
    },
    [persist]
  );

  const createTileSetAsync = useCallback(
    async (payload: {
      name?: string;
      category: TileCategory;
      resolution: number;
      lineWidth?: number;
      lineColor?: string;
      onProgress?: (current: number, total: number) => void;
    }) => {
      const expectedPatterns = getCanonicalPatterns();
      const total = expectedPatterns.length;
      const tiles: TileSetTile[] = [];
      for (let i = 0; i < expectedPatterns.length; i += 1) {
        const pattern = expectedPatterns[i];
        const tile: TileSetTile = {
          id: createId('tile'),
          name: `Tile ${i + 1}`,
          tiles: generateTileForExpected(
            pattern,
            clampResolution(payload.resolution),
            payload.category
          ),
          grid: {
            rows: clampResolution(payload.resolution),
            columns: clampResolution(payload.resolution),
          },
          preferredTileSize: 45,
          thumbnailUri: null,
          previewUri: null,
          expectedConnectivity: pattern,
          updatedAt: Date.now(),
        };
        tiles.push(tile);
        payload.onProgress?.(i + 1, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const nextSet: TileSet = {
        id: createId('tileset'),
        name: payload.name ?? 'New Tile Set',
        category: payload.category,
        resolution: clampResolution(payload.resolution),
        lineWidth: payload.lineWidth ?? 3,
        lineColor: payload.lineColor ?? '#ffffff',
        tiles,
        updatedAt: Date.now(),
      };
      setTileSets((prev) => {
        const next = [nextSet, ...prev];
        void persist(next);
        return next;
      });
      return nextSet.id;
    },
    [persist]
  );

  const deleteTileSet = useCallback(
    (id: string) => {
      setTileSets((prev) => {
        const next = prev.filter((set) => set.id !== id);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateTileSet = useCallback(
    (id: string, updater: (set: TileSet) => TileSet) => {
      setTileSets((prev) => {
        const next = prev.map((set) => (set.id === id ? updater(set) : set));
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const addTileToSet = useCallback(
    (setId: string) => {
      const tileId = createId('tile');
      setTileSets((prev) => {
        const next = prev.map((set) => {
          if (set.id !== setId) {
            return set;
          }
          const newTile: TileSetTile = {
            id: tileId,
            name: `Tile ${set.tiles.length + 1}`,
            tiles: [],
            grid: { rows: set.resolution, columns: set.resolution },
            preferredTileSize: 45,
            thumbnailUri: null,
            previewUri: null,
            expectedConnectivity: '00000000',
            updatedAt: Date.now(),
          };
          return {
            ...set,
            tiles: [newTile, ...set.tiles],
            updatedAt: Date.now(),
          };
        });
        void persist(next);
        return next;
      });
      return tileId;
    },
    [persist]
  );

  const updateTileInSet = useCallback(
    (
      setId: string,
      tileId: string,
      updater: (tile: TileSetTile, set: TileSet) => TileSetTile
    ) => {
      setTileSets((prev) => {
        const next = prev.map((set) => {
          if (set.id !== setId) {
            return set;
          }
          const tiles = set.tiles.map((tile) =>
            tile.id === tileId ? updater(tile, set) : tile
          );
          return {
            ...set,
            tiles,
            updatedAt: Date.now(),
          };
        });
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const deleteTileFromSet = useCallback(
    (setId: string, tileId: string) => {
      setTileSets((prev) => {
        const next = prev.map((set) => {
          if (set.id !== setId) {
            return set;
          }
          return {
            ...set,
            tiles: set.tiles.filter((tile) => tile.id !== tileId),
            updatedAt: Date.now(),
          };
        });
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  return {
    tileSets,
    createTileSet,
    createTileSetAsync,
    deleteTileSet,
    reloadTileSets: loadFromStorage,
    updateTileSet,
    addTileToSet,
    updateTileInSet,
    deleteTileFromSet,
  };
};
