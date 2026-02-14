import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
    TILE_CATEGORIES,
    TILE_MANIFEST,
    type TileCategory,
    type TileSource,
} from '@/assets/images/tiles/manifest';
import { parseTileConnections, transformConnections } from '@/utils/tile-compat';
import { renderTileCanvasToSvg } from '@/utils/tile-export';
import { type Tile } from '@/utils/tile-grid';
import type { TileSetExportPayload } from '@/utils/tile-ugc-format';

export type TileSetTile = {
  id: string;
  name: string;
  tiles: Tile[];
  grid: { rows: number; columns: number };
  preferredTileSize: number;
  thumbnailUri: string | null;
  previewUri: string | null;
  updatedAt: number;
};

export type TileSet = {
  id: string;
  name: string;
  category: TileCategory;
  categories: TileCategory[];
  resolution: number;
  lineWidth: number;
  lineColor: string;
  tiles: TileSetTile[];
  updatedAt: number;
};

const STORAGE_KEY = 'tile-sets-v1';
const BAKED_STORAGE_KEY = 'tile-sets-bakes-v1';
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');
const qualifyBakedName = (setId: string, name: string) =>
  name.startsWith(`${setId}:`) ? name : `${setId}:${name}`;
const getLegacyBakedName = (setId: string, name: string) =>
  name.startsWith(`${setId}:`) ? name.slice(setId.length + 1) : name;
const parseBakedName = (name: string) => {
  const matchWithTimestamp = name.match(/^(.*)_\d+_([01]{8})\.svg$/);
  if (matchWithTimestamp) {
    return { tileId: matchWithTimestamp[1], bits: matchWithTimestamp[2] };
  }
  const match = name.match(/^(.*)_([01]{8})\.svg$/);
  if (!match) {
    return null;
  }
  return { tileId: match[1], bits: match[2] };
};

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const clampResolution = (value: number) => Math.min(8, Math.max(2, value));
const normalizeCategories = (value: unknown, fallback: TileCategory) => {
  if (!Array.isArray(value)) {
    return [fallback];
  }
  const valid = value.filter(
    (entry): entry is TileCategory =>
      typeof entry === 'string' && (TILE_CATEGORIES as string[]).includes(entry)
  );
  return valid.length > 0 ? valid : [fallback];
};

const TILE_SET_BAKE_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}tile-sets/`;

const toConnectionKey = (connections: boolean[] | null) =>
  connections ? connections.map((value) => (value ? '1' : '0')).join('') : null;

const getTileConnectivityBits = (tile: TileSetTile, sources: TileSource[]) => {
  const rows = tile.grid.rows;
  const columns = tile.grid.columns;
  if (rows <= 0 || columns <= 0) {
    return '00000000';
  }
  const total = rows * columns;
  const rendered = tile.tiles.map((tileItem) => {
    if (!tileItem || tileItem.imageIndex < 0) {
      return null;
    }
    const name = sources[tileItem.imageIndex]?.name ?? '';
    const connections = parseTileConnections(name);
    if (!connections) {
      return null;
    }
    return transformConnections(
      connections,
      tileItem.rotation ?? 0,
      tileItem.mirrorX ?? false,
      tileItem.mirrorY ?? false
    );
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
  const statuses = [
    north,
    pick(topRow, rightCol, 1),
    east,
    pick(bottomRow, rightCol, 3),
    south,
    pick(bottomRow, leftCol, 5),
    west,
    pick(topRow, leftCol, 7),
  ];
  return toConnectionKey(statuses) ?? '00000000';
};

const BAKE_VERSION = 4;
const buildBakeSignature = (set: TileSet) => {
  const tileSignature = set.tiles.map((tile) => `${tile.id}:${tile.updatedAt}`).join('|');
  return `${BAKE_VERSION}:${set.updatedAt}:${set.lineColor}:${set.lineWidth}:${tileSignature}`;
};


export type BakedNameReplacement = { oldName: string; newName: string };

export type TileSourceNamesRemovedOptions = { namePrefix?: string };

export const useTileSets = (options?: {
  onBakedNamesReplaced?: (replacements: BakedNameReplacement[]) => void;
  onTileSourceNamesRemoved?: (
    names: string[],
    opts?: TileSourceNamesRemovedOptions
  ) => void;
}) => {
  const [tileSets, setTileSets] = useState<TileSet[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bakedSourcesBySetId, setBakedSourcesBySetId] = useState<
    Record<string, TileSource[]>
  >({});
  const [currentBakedNamesBySetId, setCurrentBakedNamesBySetId] = useState<
    Record<string, string[]>
  >({});
  const bakeSignatureRef = useRef<Record<string, string>>({});
  const tileSignatureRef = useRef<Record<string, Record<string, string>>>({});
  const svgSourceCacheRef = useRef<Map<string, string>>(new Map());
  const onBakedNamesReplacedRef = useRef(options?.onBakedNamesReplaced);
  const onTileSourceNamesRemovedRef = useRef(options?.onTileSourceNamesRemoved);
  onBakedNamesReplacedRef.current = options?.onBakedNamesReplaced;
  onTileSourceNamesRemovedRef.current = options?.onTileSourceNamesRemoved;

  const yieldToEventLoop = useCallback(async () => {
    if (typeof requestAnimationFrame === 'function') {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }, []);

  const loadFromStorage = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const rawBakes = await AsyncStorage.getItem(BAKED_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<TileSet>[]) : [];
      const next = parsed.map((set) => {
        const category =
          typeof set.category === 'string' &&
          (TILE_CATEGORIES as string[]).includes(set.category)
            ? (set.category as TileCategory)
            : TILE_CATEGORIES[0];
        const categories = normalizeCategories(set.categories, category);
        return {
          id: set.id ?? createId('tileset'),
          name: set.name ?? 'Tile Set',
          category: categories[0] ?? category,
          categories,
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
              updatedAt: tile.updatedAt ?? Date.now(),
            })),
          updatedAt: set.updatedAt ?? Date.now(),
        } as TileSet;
      });
      if (rawBakes) {
        try {
          const parsedBakes = JSON.parse(rawBakes) as Record<
            string,
            { signature: string; sources: TileSource[]; tileSignatures?: Record<string, string> }
          >;
          const nextBakes: Record<string, TileSource[]> = {};
          const nextBakeSignatures: Record<string, string> = {};
          const nextTileSignatures: Record<string, Record<string, string>> = {};
          Object.entries(parsedBakes).forEach(([setId, cache]) => {
            if (!cache?.signature || !Array.isArray(cache.sources)) {
              return;
            }
            nextBakes[setId] = cache.sources.map((source) => {
              if (!source || typeof source.name !== 'string') {
                return source;
              }
              const legacy = getLegacyBakedName(setId, source.name);
              const qualified = qualifyBakedName(setId, legacy);
              return source.name === qualified ? source : { ...source, name: qualified };
            });
            nextBakeSignatures[setId] = cache.signature;
            if (cache.tileSignatures) {
              nextTileSignatures[setId] = cache.tileSignatures;
            }
          });
          setBakedSourcesBySetId(nextBakes);
          bakeSignatureRef.current = nextBakeSignatures;
          tileSignatureRef.current = nextTileSignatures;
        } catch {
          // ignore bake cache errors
        }
      }
      setTileSets(next);
      setIsLoaded(true);
    } catch (error) {
      console.warn('Failed to load tile sets', error);
      setIsLoaded(true);
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

  useEffect(() => {
    if (!TILE_SET_BAKE_DIR && Platform.OS !== 'web') {
      return;
    }
    let cancelled = false;
    const bakeAll = async () => {
      if (Platform.OS !== 'web') {
        try {
          await FileSystem.makeDirectoryAsync(TILE_SET_BAKE_DIR, { intermediates: true });
        } catch {
          // ignore
        }
      }
      const updates: Record<string, TileSource[]> = {};
      const currentNameUpdates: Record<string, string[]> = {};
      const nameReplacements: BakedNameReplacement[] = [];
      for (const set of tileSets) {
        const signature = buildBakeSignature(set);
        if (bakeSignatureRef.current[set.id] === signature) {
          continue;
        }
        const categories =
          set.categories && set.categories.length > 0 ? set.categories : [set.category];
        const sources = categories.flatMap(
          (category) => TILE_MANIFEST[category] ?? []
        );
        const setDir = Platform.OS === 'web' ? null : `${TILE_SET_BAKE_DIR}${set.id}/`;
        if (setDir) {
          try {
            await FileSystem.makeDirectoryAsync(setDir, { intermediates: true });
          } catch {
            // ignore
          }
        }
        const prevSources = bakedSourcesBySetId[set.id] ?? [];
        const prevByTileId = new Map<string, TileSource>();
        prevSources.forEach((source) => {
          if (!source || typeof source.name !== 'string') {
            return;
          }
          const legacy = getLegacyBakedName(set.id, source.name);
          const parsed = parseBakedName(legacy);
          if (parsed) {
            prevByTileId.set(parsed.tileId, source);
          }
        });
        if (prevSources.length === 0) {
          const placeholderSources: TileSource[] = set.tiles.map((tile) => {
            const bits = getTileConnectivityBits(tile, sources);
            const fileName = `${tile.id}_${tile.updatedAt}_${bits}.svg`;
            const qualifiedName = qualifyBakedName(set.id, fileName);
            const prevSource = prevByTileId.get(tile.id);
            if (prevSource) {
              return { ...prevSource, name: qualifiedName };
            }
            return { name: qualifiedName, source: ERROR_TILE };
          });
          if (placeholderSources.length > 0) {
            setBakedSourcesBySetId((prev) => ({
              ...prev,
              [set.id]: placeholderSources,
            }));
          }
        }
        const bakedSources: TileSource[] = [];
        const currentNames: string[] = [];
        const perTileSignatures: Record<string, string> = {};
        const existingTileSignatures = tileSignatureRef.current[set.id] ?? {};
        for (let index = 0; index < set.tiles.length; index += 1) {
          const tile = set.tiles[index];
          const tileSignature = `${tile.id}:${tile.updatedAt}:${set.lineColor}:${set.lineWidth}`;
          perTileSignatures[tile.id] = tileSignature;
          const prevSignature = existingTileSignatures[tile.id];
          const prevSource = prevByTileId.get(tile.id);
          if (prevSignature === tileSignature && prevSource) {
            const bits = getTileConnectivityBits(tile, sources);
            const fileName = `${tile.id}_${tile.updatedAt}_${bits}.svg`;
            const qualifiedName = qualifyBakedName(set.id, fileName);
            bakedSources.push({ ...prevSource, name: qualifiedName });
            currentNames.push(qualifiedName);
          } else {
            const bits = getTileConnectivityBits(tile, sources);
            const fileName = `${tile.id}_${tile.updatedAt}_${bits}.svg`;
            const qualifiedName = qualifyBakedName(set.id, fileName);
            currentNames.push(qualifiedName);
            if (prevSource && prevSource.name && prevSource.name !== qualifiedName) {
              nameReplacements.push({ oldName: prevSource.name, newName: qualifiedName });
            }
            const fallbackRows =
              tile.grid.rows > 0 ? tile.grid.rows : set.resolution;
            const fallbackColumns =
              tile.grid.columns > 0 ? tile.grid.columns : set.resolution;
            const svg = await renderTileCanvasToSvg({
              tiles: tile.tiles,
              gridLayout: {
                rows: fallbackRows,
                columns: fallbackColumns,
                tileSize: tile.preferredTileSize,
              },
              tileSources: sources,
              gridGap: 0,
              errorSource: null,
              lineColor: undefined,
              lineWidth: undefined,
              backgroundColor: null,
              sourceXmlCache: svgSourceCacheRef.current,
              outputSize: set.resolution * 256,
            });
          if (!svg) {
            if (prevSource) {
              bakedSources.push({ ...prevSource, name: qualifiedName });
            } else {
              bakedSources.push({ name: qualifiedName, source: ERROR_TILE });
            }
          } else if (Platform.OS === 'web') {
            const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
            bakedSources.push({
              name: qualifiedName,
              source: { uri: dataUri },
            });
          } else if (setDir) {
            const target = `${setDir}${fileName}`;
            try {
              await FileSystem.writeAsStringAsync(target, svg, {
                encoding: FileSystem.EncodingType.UTF8,
              });
            } catch {
              // ignore write errors
            }
            bakedSources.push({
              name: qualifiedName,
              source: { uri: target },
            });
          }
          }
          if (index > 0 && index % 4 === 0) {
            await yieldToEventLoop();
          }
        }
        currentNameUpdates[set.id] = currentNames;
        const mergedByName = new Map<string, TileSource>();
        if (set.tiles.length > 0) {
          prevSources.forEach((source) => {
            if (source?.name) {
              mergedByName.set(source.name, source);
            }
          });
          bakedSources.forEach((source) => {
            if (source?.name) {
              mergedByName.set(source.name, source);
            }
          });
        }
        updates[set.id] = Array.from(mergedByName.values());
        bakeSignatureRef.current[set.id] = signature;
        tileSignatureRef.current[set.id] = perTileSignatures;
      }

      if (cancelled) {
        return;
      }

      setBakedSourcesBySetId((prev) => ({ ...prev, ...updates }));
      if (!cancelled) {
        setCurrentBakedNamesBySetId((prev) => {
          const next = { ...prev, ...currentNameUpdates };
          Object.keys(next).forEach((key) => {
            if (!tileSets.find((set) => set.id === key)) {
              delete next[key];
            }
          });
          return next;
        });
        if (nameReplacements.length > 0) {
          const result = onBakedNamesReplacedRef.current?.(nameReplacements);
          if (result != null && typeof (result as Promise<unknown>).then === 'function') {
            await (result as Promise<void>);
          }
        }
      }
    };

    void bakeAll();
    return () => {
      cancelled = true;
    };
  }, [tileSets, yieldToEventLoop]);

  const persist = useCallback(async (next: TileSet[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to save tile sets', error);
    }
  }, []);

  const persistBakes = useCallback(async () => {
    try {
      const payload: Record<
        string,
        { signature: string; sources: TileSource[]; tileSignatures?: Record<string, string> }
      > = {};
      Object.entries(bakedSourcesBySetId).forEach(([setId, sources]) => {
        const signature = bakeSignatureRef.current[setId];
        if (!signature || !Array.isArray(sources)) {
          return;
        }
        payload[setId] = {
          signature,
          sources,
          tileSignatures: tileSignatureRef.current[setId],
        };
      });
      await AsyncStorage.setItem(BAKED_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to save baked tile sets', error);
    }
  }, [bakedSourcesBySetId]);

  useEffect(() => {
    void persistBakes();
  }, [bakedSourcesBySetId, persistBakes]);

  const createTileSet = useCallback(
    (payload: {
      name?: string;
      category: TileCategory;
      resolution: number;
      lineWidth?: number;
      lineColor?: string;
    }) => {
      const createdAt = Date.now();
      const tileId = createId('tile');
      const resolution = clampResolution(payload.resolution);
      const initialTile: TileSetTile = {
        id: tileId,
        name: 'Tile 1',
        tiles: [],
        grid: { rows: resolution, columns: resolution },
        preferredTileSize: 45,
        thumbnailUri: null,
        previewUri: null,
        updatedAt: createdAt,
      };
      const nextSet: TileSet = {
        id: createId('tileset'),
        name: payload.name ?? 'New Tile Set',
        category: payload.category,
        categories: [payload.category],
        resolution,
        lineWidth: payload.lineWidth ?? 13,
        lineColor: payload.lineColor ?? '#ffffff',
        tiles: [initialTile],
        updatedAt: createdAt,
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
      const sources = bakedSourcesBySetId[id] ?? [];
      const removedNames = sources
        .map((s) => (s && typeof s.name === 'string' ? s.name : null))
        .filter((n): n is string => n !== null);
      if (removedNames.length > 0) {
        onTileSourceNamesRemovedRef.current?.(removedNames);
      }
      setTileSets((prev) => {
        const next = prev.filter((set) => set.id !== id);
        void persist(next);
        return next;
      });
    },
    [bakedSourcesBySetId, persist]
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

  const importTileSet = useCallback(
    (
      payload: TileSetExportPayload,
      options?: { preserveBakedNames?: boolean }
    ) => {
      const now = Date.now();
      const setId = createId('tileset');
      const preserve = options?.preserveBakedNames === true;
      const tiles: TileSetTile[] = payload.tiles.map((t) => ({
        id: preserve && typeof t.id === 'string' ? t.id : createId('tile'),
        name: t.name,
        tiles: t.tiles,
        grid: t.grid,
        preferredTileSize: t.preferredTileSize,
        thumbnailUri: null,
        previewUri: null,
        updatedAt:
          preserve && typeof (t as { updatedAt?: number }).updatedAt === 'number'
            ? (t as { updatedAt: number }).updatedAt
            : now,
      }));
      const newSet: TileSet = {
        id: setId,
        name: payload.name,
        category: payload.category,
        categories: payload.categories ?? [payload.category],
        resolution: clampResolution(payload.resolution),
        lineWidth: payload.lineWidth ?? 3,
        lineColor: payload.lineColor ?? '#ffffff',
        tiles,
        updatedAt: now,
      };
      setTileSets((prev) => {
        const next = [newSet, ...prev];
        void persist(next);
        return next;
      });
      return setId;
    },
    [persist]
  );

  const deleteTileFromSet = useCallback(
    (setId: string, tileId: string) => {
      const sources = bakedSourcesBySetId[setId] ?? [];
      const removedNames = sources
        .filter((s) => {
          if (!s?.name) return false;
          const legacy = getLegacyBakedName(setId, s.name);
          const parsed = parseBakedName(legacy);
          if (parsed) {
            return parsed.tileId === tileId;
          }
          return legacy.startsWith(`${tileId}_`);
        })
        .map((s) => s.name as string);
      const qualifiedPrefix = `${setId}:${tileId}_`;
      if (removedNames.length > 0 || qualifiedPrefix.length > 0) {
        onTileSourceNamesRemovedRef.current?.(removedNames, {
          namePrefix: qualifiedPrefix,
        });
      }
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
    [bakedSourcesBySetId, persist]
  );

  return {
    tileSets,
    isLoaded,
    bakedSourcesBySetId,
    currentBakedNamesBySetId,
    createTileSet,
    importTileSet,
    deleteTileSet,
    reloadTileSets: loadFromStorage,
    updateTileSet,
    addTileToSet,
    updateTileInSet,
    deleteTileFromSet,
  };
};
