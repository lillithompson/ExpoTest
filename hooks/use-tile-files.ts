import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type TileCategory } from '@/assets/images/tiles/manifest';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { type GridLayout, type Tile } from '@/utils/tile-grid';

export type TileFile = {
  id: string;
  name: string;
  tiles: Tile[];
  grid: { rows: number; columns: number };
  category: TileCategory;
  preferredTileSize: number;
  thumbnailUri: string | null;
  updatedAt: number;
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
  preferredTileSize: 45,
  thumbnailUri: null,
  updatedAt: Date.now(),
});

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
        const parsed = filesRaw
          ? (JSON.parse(filesRaw) as Array<Partial<TileFile>>).map((file) => ({
              id: file.id ?? createId(),
              name: file.name ?? 'Canvas',
              tiles: file.tiles ?? [],
              grid: file.grid ?? { rows: 0, columns: 0 },
              category: (file.category ?? fallbackCategory) as TileCategory,
              preferredTileSize: file.preferredTileSize ?? 45,
              thumbnailUri: file.thumbnailUri ?? null,
              updatedAt: file.updatedAt ?? Date.now(),
            }))
          : [];
        const activeId = activeRaw || null;
        if (parsed.length === 0) {
          const initial = defaultFile(fallbackCategory);
          setFiles([initial]);
          setActiveFileId(initial.id);
          await AsyncStorage.setItem(FILES_KEY, JSON.stringify([initial]));
          await AsyncStorage.setItem(ACTIVE_KEY, initial.id);
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
      preferredTileSize: number;
      thumbnailUri?: string | null;
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
                category: payload.category,
                preferredTileSize: payload.preferredTileSize,
                thumbnailUri:
                  payload.thumbnailUri !== undefined
                    ? payload.thumbnailUri
                    : file.thumbnailUri,
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
    (category: TileCategory, preferredTileSize = 45) => {
      const nextFile: TileFile = {
        id: createId(),
        name: `Canvas ${Date.now()}`,
        tiles: [],
        grid: { rows: 0, columns: 0 },
        category,
        preferredTileSize,
        thumbnailUri: null,
        updatedAt: Date.now(),
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
    async (file: TileFile, tileSources: { source: unknown }[]) => {
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
    upsertActiveFile,
    ready,
  };
};
