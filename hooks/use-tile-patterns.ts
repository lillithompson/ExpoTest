import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { type TileCategory } from '@/assets/images/tiles/manifest';
import { type Tile } from '@/utils/tile-grid';

export type TilePattern = {
  id: string;
  name: string;
  category: TileCategory;
  width: number;
  height: number;
  tiles: Tile[];
  /** UGC tile set IDs this pattern uses; required to resolve tile names when displaying. */
  tileSetIds?: string[];
  createdAt: number;
};

const STORAGE_KEY = 'tile-patterns-v1';

const createId = () =>
  `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useTilePatterns = () => {
  const [patterns, setPatterns] = useState<TilePattern[]>([]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!mounted) {
          return;
        }
        const parsed = raw ? (JSON.parse(raw) as TilePattern[]) : [];
        setPatterns(parsed ?? []);
      } catch (error) {
        console.warn('Failed to load patterns', error);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const persist = useCallback(async (next: TilePattern[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to save patterns', error);
    }
  }, []);

  const createPattern = useCallback(
    (payload: {
      name?: string;
      category: TileCategory;
      width: number;
      height: number;
      tiles: Tile[];
      tileSetIds?: string[];
    }) => {
      const nextPattern: TilePattern = {
        id: createId(),
        name: payload.name ?? `Pattern ${Date.now()}`,
        category: payload.category,
        width: payload.width,
        height: payload.height,
        tiles: payload.tiles,
        ...(Array.isArray(payload.tileSetIds) &&
          payload.tileSetIds.length > 0 && { tileSetIds: payload.tileSetIds }),
        createdAt: Date.now(),
      };
      setPatterns((prev) => {
        const next = [nextPattern, ...prev];
        void persist(next);
        return next;
      });
      return nextPattern.id;
    },
    [persist]
  );

  const deletePatterns = useCallback(
    (ids: string[]) => {
      setPatterns((prev) => {
        const next = prev.filter((pattern) => !ids.includes(pattern.id));
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const clearAllPatterns = useCallback(async () => {
    setPatterns([]);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    } catch (error) {
      console.warn('Failed to clear patterns', error);
    }
  }, []);

  const updatePattern = useCallback(
    (id: string, updater: (pattern: TilePattern) => TilePattern) => {
      setPatterns((prev) => {
        const next = prev.map((pattern) =>
          pattern.id === id ? updater(pattern) : pattern
        );
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const patternsByCategory = useMemo(() => {
    const map = new Map<TileCategory, TilePattern[]>();
    patterns.forEach((pattern) => {
      const list = map.get(pattern.category) ?? [];
      list.push(pattern);
      map.set(pattern.category, list);
    });
    return map;
  }, [patterns]);

  return {
    patterns,
    patternsByCategory,
    createPattern,
    deletePatterns,
    clearAllPatterns,
    updatePattern,
  };
};
