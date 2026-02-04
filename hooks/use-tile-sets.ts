import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { TILE_CATEGORIES, type TileCategory } from '@/assets/images/tiles/manifest';
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
      const nextSet: TileSet = {
        id: createId('tileset'),
        name: payload.name ?? 'New Tile Set',
        category: payload.category,
        resolution: clampResolution(payload.resolution),
        lineWidth: payload.lineWidth ?? 3,
        lineColor: payload.lineColor ?? '#ffffff',
        tiles: [],
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
    deleteTileSet,
    reloadTileSets: loadFromStorage,
    updateTileSet,
    addTileToSet,
    updateTileInSet,
    deleteTileFromSet,
  };
};
