import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { TileAsset } from '@/components/tile-asset';
import { type TileSource } from '@/assets/images/tiles/manifest';
import { type TileAtlas } from '@/utils/tile-atlas';

type Brush =
  | { mode: 'random' }
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
    tiles: { imageIndex: number; rotation: number; mirrorX: boolean; mirrorY: boolean }[];
    width: number;
    height: number;
    rotation: number;
    mirrorX: boolean;
  } | null;
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

  return { subscribe, setState, ensureLoaded, getState: () => state };
})();

export function TileBrushPanel({
  tileSources,
  selected,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
  atlas,
  selectedPattern,
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
    () => ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#e5e7eb'],
    []
  );
  const orderedTileEntries = useMemo(
    () =>
      [...tileEntries].sort((a, b) => {
        if (a.isFavorite === b.isFavorite) {
          return a.index - b.index;
        }
        return a.isFavorite ? -1 : 1;
      }),
    [tileEntries]
  );
  const cycleRef = useRef<Record<string, number>>({});

  const openFavoriteDialog = (entry: { tile: TileSource; index: number }) => {
    const existing = favorites[entry.tile.name];
    if (existing) {
      setFavoriteDialog({ name: entry.tile.name, index: entry.index, mode: 'remove' });
      return;
    }
    setFavoriteColorDraft(lastFavoriteColorRef.current);
    setFavoriteDialog({ name: entry.tile.name, index: entry.index, mode: 'add' });
  };

  const closeFavoriteDialog = () => {
    setFavoriteDialog(null);
  };

  const commitFavorite = () => {
    if (!favoriteDialog) {
      return;
    }
    if (favoriteDialog.mode === 'remove') {
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
      style={[styles.container, { height }]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={showIndicator}
        onContentSizeChange={(width) => setContentWidth(width)}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInset={{ top: 0, left: 0, bottom: 0, right: 0 }}
        scrollIndicatorInsets={{ top: 0, left: 0, bottom: 0, right: 0 }}
      >
        <View style={[styles.column, { height: columnHeight }]}>
          {[
            { type: 'random' as const },
            { type: 'clone' as const },
            { type: 'erase' as const },
            ...(showPattern ? [{ type: 'pattern' as const }] : []),
            ...orderedTileEntries,
          ].map((entry, idx) => {
            const isRandom = entry.type === 'random';
            const isErase = entry.type === 'erase';
            const isClone = entry.type === 'clone';
            const isPattern = entry.type === 'pattern';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isErase
                ? selected.mode === 'erase'
                : isClone
                  ? selected.mode === 'clone'
                  : isPattern
                    ? selected.mode === 'pattern'
                    : selected.mode === 'fixed' && selected.index === entry.index;
            const rowIndex = idx % rowCount;
            const isLastRow = rowIndex === rowCount - 1;
            const rotation =
              !isRandom && !isErase && !isClone && !isPattern
                ? getRotation(entry.index)
                : 0;
            const mirrorX =
              !isRandom && !isErase && !isClone && !isPattern
                ? getMirror(entry.index)
                : false;
            const mirrorY =
              !isRandom && !isErase && !isClone && !isPattern
                ? getMirrorVertical(entry.index)
                : false;
            const favoriteColor =
              !isRandom && !isErase && !isClone && !isPattern
                ? favorites[entry.tile.name]
                : null;
            const tileScale =
              !isRandom && !isErase && !isClone && !isPattern
                ? strokeScaleByName?.get(entry.tile.name) ?? 1
                : 1;
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
            return (
              <Pressable
                key={
                  isRandom
                    ? 'random'
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
                  !isSelected && styles.itemDimmed,
                  isSelected && styles.itemSelected,
                  !isLastRow ? { marginBottom: rowGap } : styles.itemBottom,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isRandom
                    ? 'Random brush'
                    : isErase
                      ? 'Erase brush'
                      : isClone
                        ? 'Clone brush'
                        : isPattern
                          ? 'Pattern brush'
                          : `Brush ${entry.tile.name}`
                }
              >
                {isRandom ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Random
                  </ThemedText>
                ) : isErase ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Erase
                  </ThemedText>
                ) : isClone ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Clone
                  </ThemedText>
                ) : isPattern ? (
                  <View style={styles.patternButton}>
                    <ThemedText type="defaultSemiBold" style={styles.labelText}>
                      Pattern
                    </ThemedText>
                    {selectedPattern && previewWidth > 0 && previewHeight > 0 && (
                      <View
                        style={{
                          width: previewWidth * previewTileSize,
                          height: previewHeight * previewTileSize,
                          flexDirection: 'column',
                        }}
                      >
                        {Array.from({ length: previewHeight }, (_, rowIndex) => (
                          <View
                            key={`pattern-preview-row-${rowIndex}`}
                            style={{ flexDirection: 'row' }}
                          >
                            {Array.from({ length: previewWidth }, (_, colIndex) => {
                              let mappedRow = rowIndex;
                              let mappedCol = colIndex;
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
                              const tileName =
                                tile && tile.imageIndex >= 0
                                  ? tileSources[tile.imageIndex]?.name ?? ''
                                  : '';
                              const source =
                                tile && tile.imageIndex >= 0
                                  ? tileSources[tile.imageIndex]?.source ?? null
                                  : null;
                              return (
                                <View
                                  key={`pattern-preview-cell-${rowIndex}-${colIndex}`}
                                  style={{
                                    width: previewTileSize,
                                    height: previewTileSize,
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
                                          { rotate: `${(tile.rotation + previewRotationCW) % 360}deg` },
                                        ],
                                      }}
                                      resizeMode="cover"
                                    />
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : (
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
            <ThemedText type="title" style={styles.modalTitle}>
              {favoriteDialog?.mode === 'remove'
                ? 'Unfavorite?'
                : 'Favorite this tile?'}
            </ThemedText>
            {favoriteDialog?.mode === 'add' && (
              <View style={styles.modalSection}>
                <ThemedText type="defaultSemiBold">Color</ThemedText>
                <View style={styles.colorOptions}>
                  {favoriteColorOptions.map((color) => (
                    <Pressable
                      key={color}
                      onPress={() => setFavoriteColorDraft(color)}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: color },
                        favoriteColorDraft === color && styles.colorSwatchSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose ${color}`}
                    />
                  ))}
                </View>
                <TextInput
                  value={favoriteColorDraft}
                  onChangeText={setFavoriteColorDraft}
                  style={styles.colorInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="#f59e0b"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            )}
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeFavoriteDialog}
                style={[styles.modalButton, styles.modalButtonGhost]}
                accessibilityRole="button"
                accessibilityLabel="Cancel favorite"
              >
                <ThemedText type="defaultSemiBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={commitFavorite}
                style={[styles.modalButton, styles.modalButtonPrimary]}
                accessibilityRole="button"
                accessibilityLabel={
                  favoriteDialog?.mode === 'remove'
                    ? 'Remove from favorites'
                    : 'Favorite tile'
                }
              >
                <ThemedText type="defaultSemiBold" style={styles.modalButtonText}>
                  {favoriteDialog?.mode === 'remove' ? 'Remove' : 'Favorite'}
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
  scroll: {
    backgroundColor: '#3f3f3f',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
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
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  itemDimmed: {
    opacity: 0.75,
  },
  itemBottom: {
    marginTop: 0,
  },
  itemSelected: {
    borderColor: '#22c55e',
    borderWidth: 4,
    padding: 0,
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
  patternButton: {
    alignItems: 'center',
    gap: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalPanel: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
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
  colorSwatchSelected: {
    borderColor: '#111',
    borderWidth: 2,
  },
  colorInput: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
    backgroundColor: '#fff',
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
