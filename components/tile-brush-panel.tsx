import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { ThemedText } from '@/components/themed-text';
import { TileAsset } from '@/components/tile-asset';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { type TileAtlas } from '@/utils/tile-atlas';
import { type Tile } from '@/utils/tile-grid';

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
  height: number;
  itemSize: number;
  rowGap: number;
  rows?: number;
  showPattern?: boolean;
};

type FavoritesState = {
  favorites: Record<string, string>;
  lastColor: string;
};

const FAVORITES_STORAGE_KEY = 'tile-brush-favorites-v1';
const defaultFavoritesState: FavoritesState = {
  favorites: {},
  lastColor: '#f59e0b',
};

/** Draft value meaning "remove from favorites". */
const UNFAVORITE_SENTINEL = '__unfavorite__';

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
  onPatternLongPress,
  onPatternDoubleTap,
  onRandomLongPress,
  onRandomDoubleTap,
  getRotation,
  getMirror,
  getMirrorVertical,
  onSetOrientation,
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

  const tileEntries = useMemo(
    () =>
      tileSources.map((tile, index) => ({
        type: 'fixed' as const,
        tile,
        index,
        isFavorite: Boolean(favorites[tile.name]),
      })),
    [favorites, tileSources]
  );
  const favoriteColorOptions = useMemo(
    () => ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'],
    []
  );
  const orderedTileEntries = useMemo(() => {
    const colorRank = (color: string) => {
      const i = favoriteColorOptions.indexOf(color);
      return i >= 0 ? i : favoriteColorOptions.length;
    };
    return [...tileEntries].sort((a, b) => {
      if (a.isFavorite === b.isFavorite) {
        if (!a.isFavorite) return a.index - b.index;
        const rankA = colorRank(favorites[a.tile.name] ?? '');
        const rankB = colorRank(favorites[b.tile.name] ?? '');
        if (rankA !== rankB) return rankA - rankB;
        return a.index - b.index;
      }
      return a.isFavorite ? -1 : 1;
    });
  }, [tileEntries, favorites, favoriteColorOptions]);
  const cycleRef = useRef<Record<string, number>>({});

  const openFavoriteDialog = (entry: { tile: TileSource; index: number }) => {
    const existing = favorites[entry.tile.name];
    if (existing) {
      setFavoriteColorDraft(existing);
      setFavoriteDialog({ name: entry.tile.name, index: entry.index, mode: 'remove' });
      return;
    }
    setFavoriteColorDraft(lastFavoriteColorRef.current);
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
    });
  };

  const removeFromFavorites = () => {
    if (!favoriteDialog) return;
    const nextFavorites = { ...favorites };
    delete nextFavorites[favoriteDialog.name];
    favoritesStore.setState({
      favorites: nextFavorites,
      lastColor: lastFavoriteColorRef.current,
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
      const nextFavorites = { ...favorites };
      delete nextFavorites[favoriteDialog.name];
      favoritesStore.setState({
        favorites: nextFavorites,
        lastColor: lastFavoriteColorRef.current,
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
            ...(showPattern ? [{ type: 'pattern' as const }] : []),
            ...orderedTileEntries,
          ].map((entry, idx) => {
            const isRandom = entry.type === 'random';
            const isDraw = entry.type === 'draw';
            const isErase = entry.type === 'erase';
            const isClone = entry.type === 'clone';
            const isPattern = entry.type === 'pattern';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isDraw
                ? selected.mode === 'draw'
                : isErase
                  ? selected.mode === 'erase'
                  : isClone
                    ? selected.mode === 'clone'
                    : isPattern
                      ? selected.mode === 'pattern'
                      : selected.mode === 'fixed' && selected.index === entry.index;
            const rowIndex = idx % rowCount;
            const isLastRow = rowIndex === rowCount - 1;
            const isLabelMode = isRandom || isDraw || isErase || isClone || isPattern;
            const rotation =
              !isLabelMode ? getRotation(entry.index) : 0;
            const mirrorX =
              !isLabelMode ? getMirror(entry.index) : false;
            const mirrorY =
              !isLabelMode ? getMirrorVertical(entry.index) : false;
            const favoriteColor =
              !isLabelMode ? favorites[entry.tile.name] : null;
            const tileScale =
              !isLabelMode ? strokeScaleByName?.get(entry.tile.name) ?? 1 : 1;
            const previewRotationCW = ((selectedPattern?.rotation ?? 0) + 360) % 360;
            const previewRotationCCW = (360 - previewRotationCW) % 360;
            const previewMirrorX = selectedPattern?.mirrorX ?? false;
            const previewWidth =
              previewRotationCW % 180 === 0
                ? selectedPattern?.width ?? 0
                : selectedPattern?.height ?? 0;
            const previewHeight =
              previewRotationCW % 180 === 0
                ? selectedPattern?.height ?? 0
                : selectedPattern?.width ?? 0;
            const previewMax = Math.max(10, Math.floor(itemSize * 0.6));
            const previewTileSize = Math.max(
              4,
              Math.floor(previewMax / Math.max(1, previewHeight))
            );
            const previewSizeSquare =
              previewWidth > 0 && previewHeight > 0
                ? Math.min(previewWidth, previewHeight)
                : 0;
            const previewStartRow =
              previewHeight > 0 && previewSizeSquare > 0
                ? Math.floor((previewHeight - previewSizeSquare) / 2)
                : 0;
            const previewStartCol =
              previewWidth > 0 && previewSizeSquare > 0
                ? Math.floor((previewWidth - previewSizeSquare) / 2)
                : 0;
            const previewTileSizeFill =
              previewSizeSquare > 0
                ? Math.max(1, Math.ceil(itemSize / previewSizeSquare))
                : 0;
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
                          : isPattern
                            ? 'pattern'
                            : `tile-${entry.index}`
                }
                onPressIn={() =>
                  onSelect(
                    isRandom
                      ? { mode: 'random' }
                      : isDraw
                        ? { mode: 'draw' }
                        : isErase
                          ? { mode: 'erase' }
                          : isClone
                            ? { mode: 'clone' }
                            : isPattern
                              ? { mode: 'pattern' }
                              : { mode: 'fixed', index: entry.index, rotation, mirrorX, mirrorY }
                  )
                }
                onPress={() => {
                  if (isErase || isClone) {
                    return;
                  }
                  const now = Date.now();
                  const lastTap = lastTapRef.current;
                  if (isRandom) {
                    if (
                      lastTap &&
                      lastTap.index === entry.index &&
                      now - lastTap.time < 260
                    ) {
                      onRandomDoubleTap?.();
                      lastTapRef.current = null;
                    } else {
                      lastTapRef.current = { time: now, index: entry.index };
                    }
                    return;
                  }
                  if (isPattern) {
                    if (
                      lastTap &&
                      lastTap.index === entry.index &&
                      now - lastTap.time < 260
                    ) {
                      onPatternDoubleTap?.();
                      lastTapRef.current = null;
                    } else {
                      lastTapRef.current = { time: now, index: entry.index };
                    }
                    return;
                  }
                  if (lastTap && lastTap.index === entry.index && now - lastTap.time < 260) {
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
                    lastTapRef.current = { time: now, index: entry.index };
                  }
                }}
                onLongPress={() => {
                  if (isRandom) {
                    onRandomLongPress?.();
                    return;
                  }
                  if (isPattern) {
                    onPatternLongPress?.();
                    return;
                  }
                  if (!isRandom && !isErase && !isClone && !isPattern) {
                    openFavoriteDialog(entry);
                  }
                }}
                style={[
                  styles.item,
                  { width: itemSize, height: itemSize },
                  isLabelMode && styles.itemLabelMode,
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
                          : isPattern
                            ? 'Pattern brush'
                            : `Brush ${entry.tile.name}`
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
                ) : isPattern ? (
                  selectedPattern && (patternThumbnailNode ?? previewSizeSquare > 0) ? (
                    <View style={[styles.patternButton, styles.patternThumbnailFull]}>
                      {patternThumbnailNode ?? (
                        <View
                          style={{
                            width: previewSizeSquare * previewTileSizeFill,
                            height: previewSizeSquare * previewTileSizeFill,
                            flexDirection: 'column',
                          }}
                        >
                          {Array.from({ length: previewSizeSquare }, (_, rowIndex) => {
                            const actualRow = previewStartRow + rowIndex;
                            return (
                              <View
                                key={`pattern-preview-row-${rowIndex}`}
                                style={{ flexDirection: 'row' }}
                              >
                                {Array.from(
                                  { length: previewSizeSquare },
                                  (_, colIndex) => {
                                    const actualCol = previewStartCol + colIndex;
                                    let mappedRow = actualRow;
                                    let mappedCol = actualCol;
                                    if (previewMirrorX) {
                                      mappedCol = previewWidth - 1 - mappedCol;
                                    }
                                    let sourceRow = mappedRow;
                                    let sourceCol = mappedCol;
                                    if (previewRotationCCW === 90) {
                                      sourceRow = mappedCol;
                                      sourceCol =
                                        (selectedPattern?.width ?? 0) - 1 - mappedRow;
                                    } else if (previewRotationCCW === 180) {
                                      sourceRow =
                                        (selectedPattern?.height ?? 0) - 1 - mappedRow;
                                      sourceCol =
                                        (selectedPattern?.width ?? 0) - 1 - mappedCol;
                                    } else if (previewRotationCCW === 270) {
                                      sourceRow =
                                        (selectedPattern?.height ?? 0) - 1 - mappedCol;
                                      sourceCol = mappedRow;
                                    }
                                    const index =
                                      sourceRow * (selectedPattern?.width ?? 0) + sourceCol;
                                    const tile = selectedPattern?.tiles[index];
                                    const resolved =
                                      tile && resolvePatternTile
                                        ? resolvePatternTile(tile as Tile)
                                        : tile && tile.imageIndex >= 0
                                          ? {
                                              source: tileSources[tile.imageIndex]?.source ?? null,
                                              name: tileSources[tile.imageIndex]?.name ?? '',
                                            }
                                          : { source: null as unknown | null, name: '' };
                                    const tileName = resolved.name;
                                    const source = resolved.source;
                                    return (
                                      <View
                                        key={`pattern-preview-cell-${rowIndex}-${colIndex}`}
                                        style={{
                                          width: previewTileSizeFill,
                                          height: previewTileSizeFill,
                                          backgroundColor: 'transparent',
                                        }}
                                      >
                                        {source && tile && (
                                          <TileAsset
                                            source={source}
                                            name={tileName}
                                            strokeColor={strokeColor}
                                            strokeWidth={
                                              strokeWidth !== undefined
                                                ? strokeWidth *
                                                  (strokeScaleByName?.get(tileName) ?? 1)
                                                : undefined
                                            }
                                            style={{
                                              width: '100%',
                                              height: '100%',
                                              transform: [
                                                { scaleX: tile.mirrorX ? -1 : 1 },
                                                { scaleY: tile.mirrorY ? -1 : 1 },
                                                {
                                                  rotate: `${(tile.rotation + previewRotationCW) % 360}deg`,
                                                },
                                              ],
                                            }}
                                            resizeMode="cover"
                                          />
                                        )}
                                      </View>
                                    );
                                  }
                                )}
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={styles.labelButton}>
                      <MaterialCommunityIcons
                        name="view-grid-outline"
                        size={itemSize * 0.4}
                        color="#fff"
                        style={styles.labelIcon}
                      />
                      <ThemedText type="default" style={styles.labelTextSmall}>
                        Pattern
                      </ThemedText>
                    </View>
                  )
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
                        if (favoriteDialog?.mode === 'remove') {
                          applyFavoriteColorImmediate(color);
                        }
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
    borderTopWidth: 1,
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
  item: {
    marginRight: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    overflow: 'hidden',
  },
  itemLabelMode: {
    backgroundColor: '#1a1a28',
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
