import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    PixelRatio,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { PatternThumbnail } from '@/components/pattern-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { TileAsset } from '@/components/tile-asset';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { type TileAtlas } from '@/utils/tile-atlas';
import { type Tile } from '@/utils/tile-grid';
import {
  paletteProfileLog,
  paletteProfileMeasure,
  paletteProfileStartRender,
} from '@/utils/palette-profile';
import { getConnectionCountFromFileName } from '@/utils/tile-compat';

type Brush =
  | { mode: 'random' }
  | { mode: 'draw' }
  | { mode: 'erase' }
  | { mode: 'clone' }
  | { mode: 'pattern' }
  | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean; mirrorY: boolean };

type Props = {
  tileSources: TileSource[];
  selected: Brush;
  strokeColor?: string;
  strokeWidth?: number;
  strokeScaleByName?: Map<string, number>;
  atlas?: TileAtlas | null;
  selectedPattern?: {
    tiles: { imageIndex: number; rotation: number; mirrorX: boolean; mirrorY: boolean; name?: string }[];
    width: number;
    height: number;
    rotation: number;
    mirrorX: boolean;
  } | null;
  /** Resolves a pattern tile to source/name using the pattern's tile set context (same as pattern dialog). */
  resolvePatternTile?: (tile: Tile) => { source: unknown | null; name: string };
  /** When set, this node is shown as the pattern thumbnail in the palette (same as pattern chooser). */
  patternThumbnailNode?: ReactNode;
  onSelect: (brush: Brush) => void;
  onRotate: (index: number) => void;
  onMirror: (index: number) => void;
  onMirrorVertical: (index: number) => void;
  onPatternPress?: () => void;
  onPatternLongPress?: () => void;
  onPatternDoubleTap?: () => void;
  onRandomLongPress?: () => void;
  onRandomDoubleTap?: () => void;
  getRotation: (index: number) => number;
  getMirror: (index: number) => boolean;
  getMirrorVertical: (index: number) => boolean;
  /** When user picks an orientation in the long-press modal, set palette tile to that transform. */
  onSetOrientation?: (
    index: number,
    orientation: { rotation: number; mirrorX: boolean; mirrorY: boolean }
  ) => void;
  /** All patterns for the patterns section (Pattern button + these thumbs). Shown in a collapsible section like tile groups. */
  patternList?: Array<{
    id: string;
    pattern: { tiles: Tile[]; width: number; height: number };
    rotation: number;
    mirrorX: boolean;
    tileSetIds?: string[];
  }>;
  /** Resolve a tile for a pattern thumbnail (tile set context). */
  resolveTileForPatternList?: (
    tile: Tile,
    tileSetIds: string[] | undefined
  ) => { source: unknown | null; name: string };
  onSelectPattern?: (patternId: string) => void;
  /** When user taps the pattern icon on the separator bar, open the pattern management modal. */
  onPatternSeparatorIconPress?: () => void;
  /** When user has 0 patterns and taps the New tile in the patterns section, start create pattern flow. */
  onPatternCreatePress?: () => void;
  /** When user long-presses a pattern thumb, open Pattern Properties for that pattern. */
  onPatternThumbLongPress?: (patternId: string) => void;
  /** When user double-taps a pattern thumb, rotate the pattern (like double-tap on a tile). */
  onPatternThumbDoubleTap?: (patternId: string) => void;
  /** Current pattern id when brush mode is pattern (to highlight the pattern thumb). */
  selectedPatternId?: string | null;
  height: number;
  itemSize: number;
  rowGap: number;
  rows?: number;
  showPattern?: boolean;
};

type FavoritesState = {
  favorites: Record<string, string>;
  lastColor: string;
  /** Last color to pre-select when opening Tile Properties for an unfavorited tile. */
  lastUnfavoritedColor: string;
};

const FAVORITES_STORAGE_KEY = 'tile-brush-favorites-v1';
const defaultFavoritesState: FavoritesState = {
  favorites: {},
  lastColor: '#f59e0b',
  lastUnfavoritedColor: '#f59e0b',
};

/** Draft value meaning "remove from favorites". */
const UNFAVORITE_SENTINEL = '__unfavorite__';

const SEPARATOR_BAR_WIDTH = 18;
/** Section key for the collapsible patterns section (connection counts are 0–8). */
const PATTERNS_SECTION_KEY = -1;
/** Section key for the collapsible favorites section. */
const FAVORITES_SECTION_KEY = -2;

const connectionCountCache = new Map<string, number>();

/** All 8 orientation variants: 4 rotations × 2 (no mirror / mirror X). */
const ORIENTATION_VARIANTS: Array<{
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}> = [
  { rotation: 0, mirrorX: false, mirrorY: false },
  { rotation: 90, mirrorX: false, mirrorY: false },
  { rotation: 180, mirrorX: false, mirrorY: false },
  { rotation: 270, mirrorX: false, mirrorY: false },
  { rotation: 0, mirrorX: true, mirrorY: false },
  { rotation: 90, mirrorX: true, mirrorY: false },
  { rotation: 180, mirrorX: true, mirrorY: false },
  { rotation: 270, mirrorX: true, mirrorY: false },
];

const favoritesStore = (() => {
  let state: FavoritesState = defaultFavoritesState;
  let loaded = false;
  let loading: Promise<void> | null = null;
  const listeners = new Set<(next: FavoritesState) => void>();

  const notify = () => {
    listeners.forEach((listener) => listener(state));
  };

  const setState = (next: FavoritesState) => {
    state = next;
    notify();
    void AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state));
  };

  const ensureLoaded = async () => {
    if (loaded) {
      return;
    }
    if (loading) {
      await loading;
      return;
    }
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(FAVORITES_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<FavoritesState>;
          state = {
            favorites: parsed?.favorites ?? {},
            lastColor: parsed?.lastColor ?? defaultFavoritesState.lastColor,
            lastUnfavoritedColor:
              parsed?.lastUnfavoritedColor ?? defaultFavoritesState.lastUnfavoritedColor,
          };
        }
      } catch {
        // ignore load failures
      } finally {
        loaded = true;
        loading = null;
        notify();
      }
    })();
    await loading;
  };

  const subscribe = (listener: (next: FavoritesState) => void) => {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  };

  const clearFavorites = () => {
    state = { ...state, favorites: {} };
    notify();
    void AsyncStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(state));
  };

  return { subscribe, setState, ensureLoaded, getState: () => state, clearFavorites };
})();

export function clearBrushFavorites(): void {
  favoritesStore.clearFavorites();
}

export function TileBrushPanel({
  tileSources,
  selected,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
  atlas,
  selectedPattern,
  resolvePatternTile,
  patternThumbnailNode,
  onSelect,
  onRotate,
  onMirror,
  onMirrorVertical,
  onPatternPress,
  onPatternLongPress,
  onPatternDoubleTap,
  onRandomLongPress,
  onRandomDoubleTap,
  getRotation,
  getMirror,
  getMirrorVertical,
  onSetOrientation,
  patternList,
  resolveTileForPatternList,
  onSelectPattern,
  onPatternSeparatorIconPress,
  onPatternCreatePress,
  onPatternThumbLongPress,
  onPatternThumbDoubleTap,
  selectedPatternId,
  height,
  itemSize,
  rowGap,
  rows = 2,
  showPattern = true,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showIndicator = contentWidth > containerWidth;
  const rowCount = Math.max(1, rows);
  const columnHeight = itemSize * rowCount + rowGap * Math.max(0, rowCount - 1);
  const lastTapRef = useRef<{ time: number; index: number } | null>(null);
  const [favorites, setFavorites] = useState<Record<string, string>>(
    defaultFavoritesState.favorites
  );
  const [favoriteDialog, setFavoriteDialog] = useState<{
    name: string;
    index: number;
    mode: 'add' | 'remove';
  } | null>(null);
  const [favoriteColorDraft, setFavoriteColorDraft] = useState(
    defaultFavoritesState.lastColor
  );
  const lastFavoriteColorRef = useRef(defaultFavoritesState.lastColor);

  useEffect(() => {
    const unsubscribe = favoritesStore.subscribe((next) => {
      setFavorites(next.favorites);
      lastFavoriteColorRef.current = next.lastColor;
    });
    void favoritesStore.ensureLoaded();
    return unsubscribe;
  }, []);

  const [precomputedConnectionCounts, setPrecomputedConnectionCounts] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    import('@/assets/images/tiles/connection-counts').then((m) =>
      setPrecomputedConnectionCounts(m.TILE_CONNECTION_COUNTS)
    );
  }, []);

  const getConnectionCount = useCallback((name: string): number => {
    const pre = precomputedConnectionCounts?.[name];
    if (pre !== undefined) return pre;
    let count = connectionCountCache.get(name);
    if (count === undefined) {
      count = getConnectionCountFromFileName(name);
      connectionCountCache.set(name, count);
    }
    return count;
  }, [precomputedConnectionCounts]);

  const [useFullOrder, setUseFullOrder] = useState(false);
  const renderIdRef = useRef(0);
  renderIdRef.current += 1;
  const renderId = renderIdRef.current;
  paletteProfileStartRender(tileSources.length, useFullOrder, renderId);
  useEffect(() => {
    setUseFullOrder(false);
    const id = requestAnimationFrame(() => setUseFullOrder(true));
    return () => cancelAnimationFrame(id);
  }, [tileSources, favorites]);
  /** Connection counts deferred until after first paint to keep initial load fast. */
  const connectionCountByIndex = useMemo(
    () =>
      paletteProfileMeasure('connectionCountByIndexMs', () =>
        useFullOrder ? tileSources.map((tile) => getConnectionCount(tile.name)) : []
      ),
    [tileSources, useFullOrder, getConnectionCount]
  );
  const tileEntries = useMemo(
    () =>
      paletteProfileMeasure('tileEntriesMs', () =>
        tileSources.map((tile, index) => ({
          type: 'fixed' as const,
          tile,
          index,
          isFavorite: Boolean(favorites[tile.name]),
          connectionCount: connectionCountByIndex[index] ?? 0,
        }))
      ),
    [favorites, tileSources, connectionCountByIndex]
  );
  const favoriteColorOptions = useMemo(
    () => ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'],
    []
  );
  type PaletteEntry =
    | { type: 'separator'; connectionCount: number }
    | (typeof tileEntries)[number];
  const colorRank = useMemo(
    () => (color: string) => {
      const i = favoriteColorOptions.indexOf(color);
      return i >= 0 ? i : favoriteColorOptions.length;
    },
    [favoriteColorOptions]
  );
  /** Cheap order for first paint: favorites first, then rest; no connection grouping. */
  const simpleOrderedEntries = useMemo(
    (): PaletteEntry[] =>
      paletteProfileMeasure('simpleOrderedEntriesMs', () => {
        const favoritesList = tileEntries
          .filter((e) => e.isFavorite)
          .sort((a, b) => {
            const rankA = colorRank(favorites[a.tile.name] ?? '');
            const rankB = colorRank(favorites[b.tile.name] ?? '');
            if (rankA !== rankB) return rankA - rankB;
            return a.index - b.index;
          });
        const nonFavorites = tileEntries.filter((e) => !e.isFavorite);
        return [...favoritesList, ...nonFavorites];
      }),
    [tileEntries, favorites, colorRank]
  );
  const fullOrderedEntries = useMemo(
    (): PaletteEntry[] =>
      paletteProfileMeasure('fullOrderedEntriesMs', () => {
        const favoritesList = tileEntries
          .filter((e) => e.isFavorite)
          .sort((a, b) => {
            const rankA = colorRank(favorites[a.tile.name] ?? '');
            const rankB = colorRank(favorites[b.tile.name] ?? '');
            if (rankA !== rankB) return rankA - rankB;
            return a.index - b.index;
          });
        const byConnections = new Map<number, (typeof tileEntries)[number][]>();
        for (let n = 0; n <= 8; n++) byConnections.set(n, []);
        for (const e of tileEntries) {
          byConnections.get(e.connectionCount)!.push(e);
        }
        const result: PaletteEntry[] = [];
        if (favoritesList.length > 0) {
          result.push({ type: 'separator', connectionCount: FAVORITES_SECTION_KEY });
          result.push(...favoritesList);
        }
        for (let n = 0; n <= 8; n++) {
          const group = byConnections.get(n) ?? [];
          if (group.length > 0) {
            result.push({ type: 'separator', connectionCount: n });
            result.push(...group);
          }
        }
        return result;
      }),
    [tileEntries, favorites, colorRank]
  );
  const orderedTileEntries = useFullOrder ? fullOrderedEntries : simpleOrderedEntries;
  const [collapsedFolders, setCollapsedFolders] = useState<Set<number>>(
    () =>
      new Set([
        FAVORITES_SECTION_KEY,
        PATTERNS_SECTION_KEY,
        0, 1, 2, 3, 4, 5, 6, 7, 8,
      ])
  );
  type PatternSectionEntry =
    | { type: 'separator'; connectionCount: number }
    | { type: 'pattern-new' }
    | {
        type: 'pattern-thumb';
        id: string;
        pattern: { tiles: Tile[]; width: number; height: number };
        rotation: number;
        mirrorX: boolean;
        tileSetIds?: string[];
      };
  const fullOrderedEntriesWithPatterns = useMemo((): (PaletteEntry | PatternSectionEntry)[] => {
    if (!showPattern) {
      return orderedTileEntries;
    }
    const sep: PatternSectionEntry = {
      type: 'separator',
      connectionCount: PATTERNS_SECTION_KEY,
    };
    const hasNoPatterns = (patternList ?? []).length === 0;
    const thumbs: PatternSectionEntry[] = hasNoPatterns
      ? [{ type: 'pattern-new' }]
      : (patternList ?? []).map((p) => ({
          type: 'pattern-thumb' as const,
          id: p.id,
          pattern: p.pattern,
          rotation: p.rotation,
          mirrorX: p.mirrorX,
          tileSetIds: p.tileSetIds,
        }));
    return [sep, ...thumbs, ...orderedTileEntries];
  }, [orderedTileEntries, patternList, showPattern]);
  const displayOrderedEntries = useMemo(
    (): (PaletteEntry | PatternSectionEntry)[] =>
      paletteProfileMeasure('displayOrderedEntriesMs', () => {
        const result: (PaletteEntry | PatternSectionEntry)[] = [];
        let i = 0;
        const list = fullOrderedEntriesWithPatterns;
        while (i < list.length) {
          const e = list[i];
          if (e.type === 'separator') {
            result.push(e);
            i++;
            if (
              e.connectionCount === PATTERNS_SECTION_KEY &&
              collapsedFolders.has(PATTERNS_SECTION_KEY)
            ) {
              while (
                i < list.length &&
                (list[i].type === 'pattern-thumb' || list[i].type === 'pattern-new')
              ) {
                i++;
              }
            } else if (
              e.connectionCount !== PATTERNS_SECTION_KEY &&
              collapsedFolders.has(e.connectionCount)
            ) {
              while (i < list.length && list[i].type !== 'separator') i++;
            }
          } else {
            result.push(e);
            i++;
          }
        }
        return result;
      }),
    [fullOrderedEntriesWithPatterns, collapsedFolders]
  );
  useEffect(() => {
    paletteProfileLog();
  });
  const toggleFolder = (connectionCount: number) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(connectionCount)) next.delete(connectionCount);
      else next.add(connectionCount);
      return next;
    });
  };
  const cycleRef = useRef<Record<string, number>>({});

  const openFavoriteDialog = (entry: { tile: TileSource; index: number }) => {
    const existing = favorites[entry.tile.name];
    if (existing) {
      setFavoriteColorDraft(existing);
      setFavoriteDialog({ name: entry.tile.name, index: entry.index, mode: 'remove' });
      return;
    }
    setFavoriteColorDraft(UNFAVORITE_SENTINEL);
    setFavoriteDialog({ name: entry.tile.name, index: entry.index, mode: 'add' });
  };

  const applyFavoriteColorImmediate = (color: string) => {
    if (!favoriteDialog || color === UNFAVORITE_SENTINEL) return;
    const trimmed = color.trim();
    if (!trimmed) return;
    const current = favoritesStore.getState();
    favoritesStore.setState({
      favorites: { ...current.favorites, [favoriteDialog.name]: trimmed },
      lastColor: trimmed,
      lastUnfavoritedColor: trimmed,
    });
  };

  const removeFromFavorites = () => {
    if (!favoriteDialog) return;
    const removedColor = favorites[favoriteDialog.name];
    const nextFavorites = { ...favorites };
    delete nextFavorites[favoriteDialog.name];
    const current = favoritesStore.getState();
    favoritesStore.setState({
      favorites: nextFavorites,
      lastColor: lastFavoriteColorRef.current,
      lastUnfavoritedColor:
        removedColor && favoriteColorOptions.includes(removedColor)
          ? removedColor
          : current.lastUnfavoritedColor,
    });
    setFavoriteColorDraft(UNFAVORITE_SENTINEL);
  };

  const closeFavoriteDialog = () => {
    setFavoriteDialog(null);
  };

  const commitFavorite = () => {
    if (!favoriteDialog) {
      return;
    }
    if (favoriteColorDraft === UNFAVORITE_SENTINEL) {
      const removedColor = favorites[favoriteDialog.name];
      const nextFavorites = { ...favorites };
      delete nextFavorites[favoriteDialog.name];
      const current = favoritesStore.getState();
      favoritesStore.setState({
        favorites: nextFavorites,
        lastColor: lastFavoriteColorRef.current,
        lastUnfavoritedColor:
          removedColor && favoriteColorOptions.includes(removedColor)
            ? removedColor
            : current.lastUnfavoritedColor,
      });
      closeFavoriteDialog();
      return;
    }
    const nextColor = favoriteColorDraft.trim();
    if (!nextColor) {
      closeFavoriteDialog();
      return;
    }
    favoritesStore.setState({
      favorites: {
        ...favorites,
        [favoriteDialog.name]: nextColor,
      },
      lastColor: nextColor,
      lastUnfavoritedColor: nextColor,
    });
    lastFavoriteColorRef.current = nextColor;
    closeFavoriteDialog();
  };

  return (
    <View
      style={[
        styles.container,
        { height },
        Platform.OS === 'web' && styles.containerWeb,
      ]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={showIndicator}
        onContentSizeChange={(width) => setContentWidth(width)}
        style={[styles.scroll, Platform.OS === 'web' && styles.scrollWeb]}
        contentContainerStyle={styles.content}
        contentInset={{ top: 0, left: 0, bottom: 0, right: 0 }}
        scrollIndicatorInsets={{ top: 0, left: 0, bottom: 0, right: 0 }}
      >
        <View style={[styles.column, { height: columnHeight }]}>
          {[
            { type: 'random' as const },
            { type: 'draw' as const },
            { type: 'clone' as const },
            { type: 'erase' as const },
            ...displayOrderedEntries,
          ].map((entry, idx) => {
            const rowIndex = idx % rowCount;
            const isLastRow = rowIndex === rowCount - 1;
            if (entry.type === 'separator') {
              const n = entry.connectionCount;
              const isCollapsed = collapsedFolders.has(n);
              const isPatternsSection = n === PATTERNS_SECTION_KEY;
              return (
                <Pressable
                  key={`sep-${n}`}
                  onPress={() => toggleFolder(n)}
                  style={[
                    styles.separatorBar,
                    isCollapsed && styles.separatorBarCollapsed,
                    {
                      width: isCollapsed ? SEPARATOR_BAR_WIDTH * 2 : SEPARATOR_BAR_WIDTH,
                      height: columnHeight,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isPatternsSection
                      ? isCollapsed
                        ? 'Expand patterns'
                        : 'Collapse patterns'
                      : n === FAVORITES_SECTION_KEY
                        ? isCollapsed
                          ? 'Expand favorites'
                          : 'Collapse favorites'
                        : isCollapsed
                          ? `Expand folder ${n}`
                          : `Collapse folder ${n}`
                  }
                >
                  {isPatternsSection ? (
                    <>
                      <Pressable
                        style={styles.separatorBarIconWrapTop}
                        onPress={() => onPatternSeparatorIconPress?.()}
                        accessibilityRole="button"
                        accessibilityLabel="Open pattern management"
                      >
                        <MaterialCommunityIcons
                          name="view-grid-outline"
                          size={SEPARATOR_BAR_WIDTH * 0.75}
                          color="#374151"
                          style={styles.separatorBarIcon}
                        />
                      </Pressable>
                      {isCollapsed && (
                        <View style={styles.separatorBarIconWrap} pointerEvents="none">
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={SEPARATOR_BAR_WIDTH * 0.75}
                            color="#374151"
                            style={styles.separatorBarIcon}
                          />
                        </View>
                      )}
                    </>
                  ) : n === FAVORITES_SECTION_KEY ? (
                    <>
                      <MaterialCommunityIcons
                        name="heart"
                        size={SEPARATOR_BAR_WIDTH * 0.75}
                        color="#374151"
                        style={[styles.separatorBarIcon, { marginTop: 5 }]}
                      />
                      {isCollapsed && (
                        <View style={styles.separatorBarIconWrap} pointerEvents="none">
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={SEPARATOR_BAR_WIDTH * 0.75}
                            color="#374151"
                            style={styles.separatorBarIcon}
                          />
                        </View>
                      )}
                    </>
                  ) : (
                    <>
                      <ThemedText type="default" style={styles.separatorBarText}>
                        {String(n)}
                      </ThemedText>
                      {isCollapsed && (
                        <View style={styles.separatorBarIconWrap} pointerEvents="none">
                          <MaterialCommunityIcons
                            name="chevron-right"
                            size={SEPARATOR_BAR_WIDTH * 0.75}
                            color="#374151"
                            style={styles.separatorBarIcon}
                          />
                        </View>
                      )}
                    </>
                  )}
                </Pressable>
              );
            }
            const isRandom = entry.type === 'random';
            const isDraw = entry.type === 'draw';
            const isErase = entry.type === 'erase';
            const isClone = entry.type === 'clone';
            const isPatternThumb = entry.type === 'pattern-thumb';
            const isPatternNew = entry.type === 'pattern-new';
            const isTile = entry.type === 'fixed';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isDraw
                ? selected.mode === 'draw'
                : isErase
                  ? selected.mode === 'erase'
                  : isClone
                    ? selected.mode === 'clone'
                    : isPatternThumb
                      ? selected.mode === 'pattern' && selectedPatternId === entry.id
                      : isPatternNew
                        ? false
                        : isTile && selected.mode === 'fixed' && selected.index === entry.index;
            const isLabelMode = isRandom || isDraw || isErase || isClone;
            const rotation =
              isTile ? getRotation(entry.index) : 0;
            const mirrorX =
              isTile ? getMirror(entry.index) : false;
            const mirrorY =
              isTile ? getMirrorVertical(entry.index) : false;
            const favoriteColor =
              isTile ? favorites[entry.tile.name] : null;
            const tileScale =
              isTile ? strokeScaleByName?.get(entry.tile.name) ?? 1 : 1;
            return (
              <Pressable
                key={
                  isRandom
                    ? 'random'
                    : isDraw
                      ? 'draw'
                      : isErase
                        ? 'erase'
                        : isClone
                          ? 'clone'
                          : isPatternNew
                            ? 'pattern-new'
                            : isPatternThumb
                              ? `pattern-thumb-${entry.id}`
                              : isTile
                                ? `palette-${idx}`
                                : 'tile'
                }
                onPressIn={() => {
                  if (isPatternNew) {
                    onPatternCreatePress?.();
                    return;
                  }
                  if (isPatternThumb) {
                    onSelectPattern?.(entry.id);
                    onSelect({ mode: 'pattern' });
                    return;
                  }
                  onSelect(
                    isRandom
                      ? { mode: 'random' }
                      : isDraw
                        ? { mode: 'draw' }
                        : isErase
                          ? { mode: 'erase' }
                          : isClone
                            ? { mode: 'clone' }
                            : { mode: 'fixed', index: entry.index, rotation, mirrorX, mirrorY }
                  );
                }}
                onPress={() => {
                  if (isErase || isClone) {
                    return;
                  }
                  const now = Date.now();
                  const lastTap = lastTapRef.current;
                  if (isPatternThumb) {
                    if (
                      lastTap &&
                      lastTap.index === idx &&
                      now - lastTap.time < 260
                    ) {
                      onPatternThumbDoubleTap?.(entry.id);
                      lastTapRef.current = null;
                    } else {
                      lastTapRef.current = { time: now, index: idx };
                    }
                    return;
                  }
                  if (isRandom) {
                    if (
                      lastTap &&
                      lastTap.index === idx &&
                      now - lastTap.time < 260
                    ) {
                      onRandomDoubleTap?.();
                      lastTapRef.current = null;
                    } else {
                      lastTapRef.current = { time: now, index: idx };
                    }
                    return;
                  }
                  if (isTile && lastTap && lastTap.index === idx && now - lastTap.time < 260) {
                    const name = entry.tile.name;
                    const current = cycleRef.current[name] ?? 0;
                    const next = (current + 1) % 5;
                    cycleRef.current[name] = next;
                    if (current < 3) {
                      onRotate(entry.index);
                    } else if (current === 3) {
                      onMirror(entry.index);
                    } else {
                      onMirrorVertical(entry.index);
                    }
                    lastTapRef.current = null;
                  } else {
                    lastTapRef.current = { time: now, index: idx };
                  }
                }}
                onLongPress={() => {
                  if (isRandom) {
                    onRandomLongPress?.();
                    return;
                  }
                  if (isPatternThumb) {
                    onPatternThumbLongPress?.(entry.id);
                    return;
                  }
                  if (isTile) {
                    openFavoriteDialog(entry);
                  }
                }}
                style={[
                  styles.item,
                  { width: itemSize, height: itemSize },
                  isLabelMode && styles.itemLabelMode,
                  isPatternNew && styles.patternNewItemBg,
                  isSelected ? styles.itemSelected : styles.itemDimmed,
                  !isLastRow ? { marginBottom: rowGap } : styles.itemBottom,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isRandom
                    ? 'Random brush'
                    : isDraw
                      ? 'Draw brush'
                      : isErase
                        ? 'Erase brush'
                        : isClone
                          ? 'Clone brush'
                          : isPatternNew
                            ? 'Create new pattern'
                            : isPatternThumb
                              ? `Pattern ${entry.id}`
                              : isTile
                                ? `Brush ${entry.tile.name}`
                                : 'Brush'
                }
              >
                <View
                  style={[
                    styles.itemBorderOverlay,
                    {
                      borderColor: isSelected ? '#22c55e' : 'transparent',
                    },
                  ]}
                  pointerEvents="none"
                />
                {isRandom ? (
                  <View style={styles.labelButton}>
                    <MaterialCommunityIcons
                      name="shuffle-variant"
                      size={itemSize * 0.4}
                      color="#fff"
                      style={styles.labelIcon}
                    />
                    <ThemedText type="default" style={styles.labelTextSmall}>
                      Random
                    </ThemedText>
                  </View>
                ) : isDraw ? (
                  <View style={styles.labelButton}>
                    <MaterialCommunityIcons
                      name="pencil"
                      size={itemSize * 0.4}
                      color="#fff"
                      style={styles.labelIcon}
                    />
                    <ThemedText type="default" style={styles.labelTextSmall}>
                      Draw
                    </ThemedText>
                  </View>
                ) : isErase ? (
                  <View style={styles.labelButton}>
                    <MaterialCommunityIcons
                      name="eraser-variant"
                      size={itemSize * 0.4}
                      color="#fff"
                      style={styles.labelIcon}
                    />
                    <ThemedText type="default" style={styles.labelTextSmall}>
                      Erase
                    </ThemedText>
                  </View>
                ) : isClone ? (
                  <View style={styles.labelButton}>
                    <MaterialCommunityIcons
                      name="content-copy"
                      size={itemSize * 0.4}
                      color="#fff"
                      style={styles.labelIcon}
                    />
                    <ThemedText type="default" style={styles.labelTextSmall}>
                      Clone
                    </ThemedText>
                  </View>
                ) : isPatternNew ? (
                  <View style={styles.patternNewWrap}>
                    <LinearGradient
                      colors={['#172554', '#010409', '#000000']}
                      locations={[0, 0.6, 0.95]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.patternNewThumb,
                        {
                          width: itemSize - 16,
                          height: itemSize - 16,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.patternNewIconCenter,
                          (() => {
                            const iconSize =
                              Platform.OS === 'web'
                                ? (itemSize * 0.62) / PixelRatio.get()
                                : itemSize * 0.62;
                            return {
                              transform: [
                                { translateX: -iconSize / 2 },
                                { translateY: -iconSize / 2 },
                              ],
                            };
                          })(),
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="plus"
                          size={
                            Platform.OS === 'web'
                              ? (itemSize * 0.62) / PixelRatio.get()
                              : itemSize * 0.62
                          }
                          color="#9ca3af"
                        />
                      </View>
                    </LinearGradient>
                  </View>
                ) : isPatternThumb && resolveTileForPatternList ? (
                  <View
                    style={[
                      styles.tileContentWrapper,
                      { width: itemSize, height: itemSize },
                    ]}
                  >
                    <PatternThumbnail
                      pattern={entry.pattern}
                      rotationCW={entry.rotation}
                      mirrorX={entry.mirrorX}
                      tileSize={Math.max(
                        4,
                        Math.floor(
                          itemSize /
                            Math.max(
                              entry.rotation % 180 === 0
                                ? entry.pattern.width
                                : entry.pattern.height,
                              entry.rotation % 180 === 0
                                ? entry.pattern.height
                                : entry.pattern.width
                            )
                        )
                      )}
                      resolveTile={(t) =>
                        resolveTileForPatternList(t, entry.tileSetIds)
                      }
                      strokeColor={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeScaleByName={strokeScaleByName}
                    />
                  </View>
                ) : (
                  <View
                    style={[
                      styles.tileContentWrapper,
                      { width: itemSize, height: itemSize },
                    ]}
                  >
                    <View style={styles.imageBox}>
                      <TileAtlasSprite
                        atlas={atlas}
                        source={entry.tile.source}
                        name={entry.tile.name}
                        strokeColor={favoriteColor ?? strokeColor}
                        strokeWidth={
                          strokeWidth !== undefined ? strokeWidth * tileScale : undefined
                        }
                        preferAtlas={!favoriteColor}
                        style={[
                          styles.image,
                          {
                            transform: [
                              { scaleX: mirrorX ? -1 : 1 },
                              { scaleY: mirrorY ? -1 : 1 },
                              { rotate: `${rotation}deg` },
                            ],
                          },
                        ]}
                        resizeMode="cover"
                      />
                    </View>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Modal
        visible={favoriteDialog !== null}
        transparent
        animationType="fade"
        onRequestClose={closeFavoriteDialog}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
            <ThemedText type="title" style={styles.modalTitle}>
              Tile Properties
            </ThemedText>
            {(favoriteDialog?.mode === 'add' || favoriteDialog?.mode === 'remove') && (
              <View style={styles.modalSection}>
                <ThemedText type="defaultSemiBold" style={styles.sectionLabel}>
                  Favorite
                </ThemedText>
                <View style={styles.colorOptions}>
                  {favoriteColorOptions.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => {
                        setFavoriteColorDraft(color);
                        applyFavoriteColorImmediate(color);
                      }}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: color },
                        favoriteColorDraft === color && styles.colorSwatchSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose ${color}`}
                    />
                  ))}
                  <Pressable
                    onPress={removeFromFavorites}
                    style={[
                      styles.colorSwatch,
                      styles.unfavoriteSwatch,
                      favoriteColorDraft === UNFAVORITE_SENTINEL &&
                        styles.colorSwatchSelected,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Remove from favorites"
                  >
                    <MaterialCommunityIcons
                      name="star-off-outline"
                      size={20}
                      color="#6b7280"
                    />
                  </Pressable>
                </View>
              </View>
            )}
            {favoriteDialog != null && onSetOrientation && tileSources[favoriteDialog.index] && (
              <View style={styles.modalSection}>
                <ThemedText type="defaultSemiBold" style={styles.sectionLabel}>
                  Orientation
                </ThemedText>
                <View style={styles.orientationGrid}>
                  {[0, 1].map((row) => (
                    <View key={row} style={styles.orientationRow}>
                      {ORIENTATION_VARIANTS.slice(row * 4, row * 4 + 4).map((orient, i) => {
                        const idx = row * 4 + i;
                        const curR = getRotation(favoriteDialog.index);
                        const curX = getMirror(favoriteDialog.index);
                        const curY = getMirrorVertical(favoriteDialog.index);
                        const isActive =
                          curR === orient.rotation &&
                          curX === orient.mirrorX &&
                          curY === orient.mirrorY;
                        const tileSource = tileSources[favoriteDialog.index];
                        return (
                          <Pressable
                            key={idx}
                            onPress={() =>
                              onSetOrientation(favoriteDialog.index, {
                                rotation: orient.rotation,
                                mirrorX: orient.mirrorX,
                                mirrorY: orient.mirrorY,
                              })
                            }
                            style={[
                              styles.orientationThumb,
                              isActive && styles.orientationThumbSelected,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`Orientation ${idx + 1}`}
                          >
                            <View style={styles.orientationThumbImageWrap}>
                              <TileAtlasSprite
                                atlas={atlas}
                                source={tileSource.source}
                                name={tileSource.name}
                                strokeColor={favorites[tileSource.name] ?? strokeColor}
                                strokeWidth={
                                  strokeWidth !== undefined
                                    ? strokeWidth *
                                      (strokeScaleByName?.get(tileSource.name) ?? 1)
                                    : undefined
                                }
                                preferAtlas={false}
                                style={[
                                  styles.orientationThumbImage,
                                  {
                                    transform: [
                                      { scaleX: orient.mirrorX ? -1 : 1 },
                                      { scaleY: orient.mirrorY ? -1 : 1 },
                                      { rotate: `${orient.rotation}deg` },
                                    ],
                                  },
                                ]}
                                resizeMode="contain"
                              />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            )}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeFavoriteDialog}
                style={[styles.modalButton, styles.modalButtonGhost]}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <ThemedText type="defaultSemiBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={commitFavorite}
                style={[styles.modalButton, styles.modalButtonPrimary]}
                accessibilityRole="button"
                accessibilityLabel="Done"
              >
                <ThemedText type="defaultSemiBold" style={styles.modalButtonText}>
                  Done
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 2,
    borderTopColor: '#9ca3af',
    borderColor: '#1f1f1f',
    paddingHorizontal: 1,
    paddingVertical: 0,
    backgroundColor: '#3f3f3f',
  },
  containerWeb: {
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
  },
  scroll: {
    backgroundColor: '#3f3f3f',
  },
  scrollWeb: {
    width: '100%',
    minWidth: 0,
  },
  content: {
    flexGrow: 1,
    justifyContent: Platform.OS === 'web' ? 'flex-start' : 'center',
    paddingVertical: 0,
    backgroundColor: '#3f3f3f',
  },
  column: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: 0,
    backgroundColor: '#3f3f3f',
  },
  separatorBar: {
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
    backgroundColor: '#9ca3af',
  },
  separatorBarCollapsed: {
    backgroundColor: '#c4c8d0',
  },
  separatorBarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  separatorBarIconWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  /** Icon at top of separator bar to align with tops of numbers on other separators. */
  separatorBarIconWrapTop: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  separatorBarIcon: {
    opacity: 0.9,
  },
  item: {
    marginRight: 2,
    backgroundColor: '#0F1430',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    overflow: 'hidden',
  },
  itemLabelMode: {
    backgroundColor: '#0F1430',
  },
  itemBorderOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 4,
  },
  itemDimmed: {
    opacity: 0.7,
  },
  itemSelected: {
    opacity: 1,
  },
  itemBottom: {
    marginTop: 0,
  },
  patternNewItemBg: {
    backgroundColor: 'transparent',
  },
  patternNewWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 8,
  },
  patternNewThumb: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  patternNewIconCenter: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  tileContentWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBox: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  labelText: {
    color: '#fff',
  },
  labelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 2,
  },
  labelIcon: {
    marginBottom: -2,
  },
  labelTextSmall: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '400',
  },
  patternButton: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternThumbnailFull: {
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalPanel: {
    alignSelf: 'center',
    maxWidth: 280,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  modalScroll: {
    maxHeight: 320,
  },
  modalScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  modalTitle: {
    color: '#111',
  },
  modalSection: {
    gap: 10,
  },
  colorOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  unfavoriteSwatch: {
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderColor: '#111',
    borderWidth: 2,
  },
  sectionLabel: {
    color: '#111',
    marginBottom: 6,
  },
  orientationGrid: {
    gap: 6,
  },
  orientationRow: {
    flexDirection: 'row',
    gap: 6,
  },
  orientationThumb: {
    width: 48,
    height: 48,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  orientationThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  orientationThumbImageWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orientationThumbImage: {
    width: '100%',
    height: '100%',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    alignItems: 'center',
  },
  modalButtonGhost: {
    backgroundColor: '#fff',
  },
  modalButtonPrimary: {
    backgroundColor: '#111',
  },
  modalButtonText: {
    color: '#fff',
  },
});
