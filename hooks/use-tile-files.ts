import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TILE_CATEGORIES, type TileCategory } from '@/assets/images/tiles/manifest';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { applyRemovedSourcesToFile } from '@/utils/tile-file-sync';
import { type GridLayout, type Tile } from '@/utils/tile-grid';
import { getCellIndicesInRegion } from '@/utils/locked-regions';

export type TileFile = {
  id: string;
  name: string;
  tiles: Tile[];
  grid: { rows: number; columns: number };
  category: TileCategory;
  categories: TileCategory[];
  tileSetIds: string[];
  sourceNames: string[];
  preferredTileSize: number;
  lineWidth: number;
  lineColor: string;
  thumbnailUri: string | null;
  previewUri: string | null;
  updatedAt: number;
  /** Cell indices that are locked (cannot be modified by any tool). */
  lockedCells?: number[];
};

const FILES_KEY = 'tile-files-v1';
const ACTIVE_KEY = 'tile-files-active-v1';

const createId = () =>
  `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const defaultFile = (category: TileCategory): TileFile => ({
  id: createId(),
  name: 'Autosave',
  tiles: [],
  grid: { rows: 0, columns: 0 },
  category,
  categories: [category],
  tileSetIds: [],
  sourceNames: [],
  preferredTileSize: 45,
  lineWidth: 10,
  lineColor: '#ffffff',
  thumbnailUri: null,
  previewUri: null,
  updatedAt: Date.now(),
});

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

export const useTileFiles = (defaultCategory: TileCategory) => {
  const [files, setFiles] = useState<TileFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const savingRef = useRef<Promise<void> | null>(null);
  const defaultCategoryRef = useRef(defaultCategory);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [filesRaw, activeRaw] = await Promise.all([
          AsyncStorage.getItem(FILES_KEY),
          AsyncStorage.getItem(ACTIVE_KEY),
        ]);
        if (!mounted) {
          return;
        }
        const fallbackCategory = defaultCategoryRef.current;
        const isValidCategory = (value: unknown): value is TileCategory =>
          typeof value === 'string' && (TILE_CATEGORIES as string[]).includes(value);
        const parsed = filesRaw
          ? (JSON.parse(filesRaw) as Array<Partial<TileFile>>).map((file) => {
              const safeCategory = isValidCategory(file.category)
                ? file.category
                : fallbackCategory;
              const categories = normalizeCategories(file.categories, safeCategory);
              const tiles = Array.isArray(file.tiles) ? file.tiles : [];
              const grid =
                file.grid &&
                typeof file.grid.rows === 'number' &&
                typeof file.grid.columns === 'number'
                  ? file.grid
                  : { rows: 0, columns: 0 };
              const totalCells =
                typeof grid.rows === 'number' && typeof grid.columns === 'number'
                  ? grid.rows * grid.columns
                  : 0;
              let lockedCells: number[] = Array.isArray(file.lockedCells)
                ? file.lockedCells.filter(
                    (i): i is number =>
                      typeof i === 'number' &&
                      Number.isInteger(i) &&
                      i >= 0 &&
                      (totalCells <= 0 || i < totalCells)
                  )
                : [];
              const legacyRegions = (file as { lockedRegions?: Array<{ start: number; end: number }> }).lockedRegions;
              if (lockedCells.length === 0 && Array.isArray(legacyRegions)) {
                const cols = grid.columns ?? 0;
                const seen = new Set<number>();
                for (const r of legacyRegions) {
                  if (
                    r != null &&
                    typeof r.start === 'number' &&
                    typeof r.end === 'number' &&
                    cols > 0
                  ) {
                    getCellIndicesInRegion(r.start, r.end, cols).forEach((i) =>
                      seen.add(i)
                    );
                  }
                }
                lockedCells = Array.from(seen);
              }
              return {
                id: file.id ?? createId(),
                name: file.name ?? 'Canvas',
                tiles,
                grid,
                category: categories[0] ?? safeCategory,
                categories,
                tileSetIds: Array.isArray(file.tileSetIds)
                  ? file.tileSetIds.filter((entry) => typeof entry === 'string')
                  : [],
                sourceNames: Array.isArray(file.sourceNames)
                  ? file.sourceNames.filter((entry) => typeof entry === 'string')
                  : [],
                preferredTileSize: file.preferredTileSize ?? 45,
                lineWidth: file.lineWidth ?? 10,
                lineColor: file.lineColor ?? '#ffffff',
                thumbnailUri: file.thumbnailUri ?? null,
                previewUri: file.previewUri ?? null,
                updatedAt: file.updatedAt ?? Date.now(),
                lockedCells,
              };
            })
          : [];
        const activeId = activeRaw || null;
        if (parsed.length === 0) {
          setFiles([]);
          setActiveFileId(null);
          await AsyncStorage.setItem(FILES_KEY, JSON.stringify([]));
          await AsyncStorage.removeItem(ACTIVE_KEY);
        } else {
          setFiles(parsed);
          setActiveFileId(activeId ?? parsed[0].id);
        }
      } catch (error) {
        console.warn('Failed to load tile files', error);
      } finally {
        if (mounted) {
          setReady(true);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const persistFiles = useCallback(async (next: TileFile[], activeId: string | null) => {
    if (savingRef.current) {
      await savingRef.current;
    }
    const promise = (async () => {
      await AsyncStorage.setItem(FILES_KEY, JSON.stringify(next));
      if (activeId) {
        await AsyncStorage.setItem(ACTIVE_KEY, activeId);
      }
    })();
    savingRef.current = promise;
    try {
      await promise;
    } finally {
      if (savingRef.current === promise) {
        savingRef.current = null;
      }
    }
  }, []);

  const upsertActiveFile = useCallback(
    (payload: {
      tiles: Tile[];
      gridLayout: GridLayout;
      category: TileCategory;
      categories?: TileCategory[];
      tileSetIds?: string[];
      sourceNames?: string[];
      preferredTileSize: number;
      lineWidth?: number;
      lineColor?: string;
      thumbnailUri?: string | null;
      previewUri?: string | null;
      lockedCells?: number[];
    }) => {
      if (!activeFileId) {
        return;
      }
      setFiles((prev) => {
        const next = prev.map((file) =>
          file.id === activeFileId
            ? {
                ...file,
                tiles: payload.tiles,
                grid: { rows: payload.gridLayout.rows, columns: payload.gridLayout.columns },
                category: payload.categories?.[0] ?? payload.category,
                categories:
                  payload.categories ??
                  file.categories ??
                  (payload.category ? [payload.category] : [file.category]),
                tileSetIds:
                  payload.tileSetIds !== undefined ? payload.tileSetIds : file.tileSetIds,
                sourceNames:
                  payload.sourceNames !== undefined ? payload.sourceNames : file.sourceNames,
                preferredTileSize: payload.preferredTileSize,
                lineWidth:
                  payload.lineWidth !== undefined ? payload.lineWidth : file.lineWidth,
                lineColor:
                  payload.lineColor !== undefined ? payload.lineColor : file.lineColor,
                thumbnailUri:
                  payload.thumbnailUri !== undefined
                    ? payload.thumbnailUri
                    : file.thumbnailUri,
                previewUri:
                  payload.previewUri !== undefined ? payload.previewUri : file.previewUri,
                lockedCells:
                  payload.lockedCells !== undefined
                    ? payload.lockedCells
                    : file.lockedCells,
                updatedAt: Date.now(),
              }
            : file
        );
        void persistFiles(next, activeFileId);
        return next;
      });
    },
    [activeFileId, persistFiles]
  );

  const updateActiveFileLockedCells = useCallback(
    (lockedCells: number[]) => {
      if (!activeFileId) {
        return;
      }
      setFiles((prev) => {
        const next = prev.map((file) =>
          file.id === activeFileId
            ? { ...file, lockedCells, updatedAt: Date.now() }
            : file
        );
        void persistFiles(next, activeFileId);
        return next;
      });
    },
    [activeFileId, persistFiles]
  );

  const setActive = useCallback(
    (id: string) => {
      const now = Date.now();
      setFiles((prev) => {
        const next = prev.map((file) =>
          file.id === id ? { ...file, updatedAt: now } : file
        );
        void persistFiles(next, id);
        return next;
      });
      setActiveFileId(id);
      void AsyncStorage.setItem(ACTIVE_KEY, id);
    },
    [persistFiles]
  );

  const createFile = useCallback(
    (
      category: TileCategory,
      preferredTileSize = 45,
      options?: {
        categories?: TileCategory[];
        tileSetIds?: string[];
        sourceNames?: string[];
        lineWidth?: number;
        lineColor?: string;
      }
    ) => {
      const nextCategories =
        options?.categories && options.categories.length > 0
          ? options.categories
          : [category];
        const nextFile: TileFile = {
        id: createId(),
        name: `Canvas ${Date.now()}`,
        tiles: [],
        grid: { rows: 0, columns: 0 },
        category: nextCategories[0] ?? category,
        categories: nextCategories,
        tileSetIds: options?.tileSetIds ?? [],
        sourceNames: options?.sourceNames ?? [],
        preferredTileSize,
        lineWidth: options?.lineWidth ?? 10,
        lineColor: options?.lineColor ?? '#ffffff',
        thumbnailUri: null,
        previewUri: null,
        updatedAt: Date.now(),
                lockedCells: [],
      };
      setFiles((prev) => {
        const next = [nextFile, ...prev];
        void persistFiles(next, nextFile.id);
        return next;
      });
      setActiveFileId(nextFile.id);
      void AsyncStorage.setItem(ACTIVE_KEY, nextFile.id);
      return nextFile.id;
    },
    [persistFiles]
  );

  const duplicateFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const source = prev.find((file) => file.id === id);
        if (!source) {
          return prev;
        }
        const nextFile: TileFile = {
          ...source,
          id: createId(),
          name: `${source.name} Copy`,
          tiles: source.tiles.map((tile) => ({ ...tile })),
          updatedAt: Date.now(),
          lockedCells: Array.isArray(source.lockedCells)
            ? [...source.lockedCells]
            : [],
        };
        setActiveFileId(nextFile.id);
        void AsyncStorage.setItem(ACTIVE_KEY, nextFile.id);
        const next = [nextFile, ...prev];
        void persistFiles(next, nextFile.id);
        return next;
      });
    },
    [persistFiles]
  );

  const downloadFile = useCallback(
    async (
      file: TileFile,
      tileSources: { source: unknown }[],
      options?: {
        backgroundColor?: string;
        backgroundLineColor?: string;
        backgroundLineWidth?: number;
        strokeScaleByName?: Map<string, number>;
      }
    ) => {
      const dataUrl = await renderTileCanvasToDataUrl({
        tiles: file.tiles,
        gridLayout: {
          rows: file.grid.rows,
          columns: file.grid.columns,
          tileSize: file.preferredTileSize,
        },
        tileSources: tileSources as any,
        gridGap: 0,
        blankSource: null,
        errorSource: null,
        lineColor: file.lineColor,
        lineWidth: file.lineWidth,
        backgroundColor: options?.backgroundColor,
        strokeScaleByName: options?.strokeScaleByName,
        maxDimension: 0,
      });
      if (!dataUrl || typeof document === 'undefined') {
        return;
      }
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${file.name}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    []
  );

  const deleteFile = useCallback(
    (id: string) => {
      setFiles((prev) => {
        const remaining = prev.filter((file) => file.id !== id);
        if (remaining.length === 0) {
          setActiveFileId(null);
          void persistFiles([], null);
          return [];
        }
        const nextActive =
          activeFileId === id ? remaining[0].id : activeFileId ?? remaining[0].id;
        setActiveFileId(nextActive);
        void persistFiles(remaining, nextActive);
        return remaining;
      });
    },
    [activeFileId, persistFiles]
  );

  const clearAllFiles = useCallback(async () => {
    setFiles([]);
    setActiveFileId(null);
    await AsyncStorage.setItem(FILES_KEY, JSON.stringify([]));
    await AsyncStorage.removeItem(ACTIVE_KEY);
  }, []);

  /**
   * Replaces tiles that reference removed sources (deleted tile set or tile)
   * with the tile_error tile so files do not become corrupted. Replaces both
   * tiles matched by name and tiles that reference a removed source by imageIndex.
   * When namePrefix is set (e.g. "setId:tileId_" for a single deleted tile), any
   * tile.name or sourceNames entry starting with that prefix is also replaced.
   */
  const replaceTileSourceNamesWithError = useCallback(
    (
      removedNames: string[],
      options?: { namePrefix?: string }
    ) => {
      if (removedNames.length === 0 && (options?.namePrefix ?? '') === '') {
        return;
      }
      setFiles((prev) => {
        let anyChanged = false;
        const next = prev.map((file) => {
          const result = applyRemovedSourcesToFile(
            { tiles: file.tiles, sourceNames: file.sourceNames },
            removedNames,
            options
          );
          if (!result.changed) {
            return file;
          }
          anyChanged = true;
          return {
            ...file,
            tiles: result.tiles,
            sourceNames: result.sourceNames,
            updatedAt: Date.now(),
          };
        });
        if (anyChanged) {
          void persistFiles(next, activeFileId);
        }
        return next;
      });
    },
    [activeFileId, persistFiles]
  );

  /**
   * Replaces tile source names across all files (e.g. when a user tile is modified
   * and the baked filename changes). Updates both tile.name and file.sourceNames
   * so that existing designs keep pointing at the new asset.
   */
  const replaceTileSourceNames = useCallback(
    (replacements: Array<{ oldName: string; newName: string }>) => {
      if (replacements.length === 0) {
        return;
      }
      const oldToNew = new Map(replacements.map((r) => [r.oldName, r.newName]));
      setFiles((prev) => {
        let anyChanged = false;
        const next = prev.map((file) => {
          let fileChanged = false;
          const newTiles = file.tiles.map((tile) => {
            const newName = tile.name ? oldToNew.get(tile.name) : undefined;
            if (newName) {
              fileChanged = true;
              return { ...tile, name: newName };
            }
            return tile;
          });
          const newSourceNames = file.sourceNames.map((n) => {
            const newName = oldToNew.get(n);
            if (newName) {
              fileChanged = true;
              return newName;
            }
            return n;
          });
          if (!fileChanged) {
            return file;
          }
          anyChanged = true;
          return {
            ...file,
            tiles: newTiles,
            sourceNames: newSourceNames,
            updatedAt: Date.now(),
          };
        });
        if (anyChanged) {
          void persistFiles(next, activeFileId);
        }
        return next;
      });
    },
    [activeFileId, persistFiles]
  );

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [files, activeFileId]
  );

  return {
    files,
    activeFile,
    activeFileId,
    setActive,
    createFile,
    duplicateFile,
    downloadFile,
    deleteFile,
    clearAllFiles,
    upsertActiveFile,
    updateActiveFileLockedCells,
    replaceTileSourceNames,
    replaceTileSourceNamesWithError,
    ready,
  };
};
