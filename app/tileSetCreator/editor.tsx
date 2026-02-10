import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    TILE_CATEGORIES,
    TILE_MANIFEST,
    type TileCategory,
} from '@/assets/images/tiles/manifest';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TileAsset } from '@/components/tile-asset';
import { useTileFiles } from '@/hooks/use-tile-files';
import { useTileSets, type TileSetTile } from '@/hooks/use-tile-sets';
import {
    getTransformedConnectionsForName,
    parseTileConnections,
    transformConnections,
} from '@/utils/tile-compat';
import { exportTileCanvasAsSvg } from '@/utils/tile-export';
import { normalizeTiles, type Tile } from '@/utils/tile-grid';

const HEADER_HEIGHT = 50;
const FILE_GRID_COLUMNS_MOBILE = 4;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const normalizeCategories = (value: TileCategory[] | null | undefined) => {
  if (!value || value.length === 0) {
    return [TILE_CATEGORIES[0]];
  }
  const valid = value.filter((entry) => (TILE_CATEGORIES as string[]).includes(entry));
  return valid.length > 0 ? valid : [TILE_CATEGORIES[0]];
};
const getSourcesForCategories = (categories: TileCategory[]) =>
  categories.flatMap((category) => TILE_MANIFEST[category] ?? []);
const getBorderStatus = (tile: TileSetTile, sources: Array<{ name?: string }>) => {
  const rows = tile.grid.rows;
  const columns = tile.grid.columns;
  if (rows <= 0 || columns <= 0) {
    return { statuses: Array(8).fill(false), bits: '00000000' };
  }
  const total = rows * columns;
  const rendered = tile.tiles.map((tileItem) => {
    if (!tileItem || tileItem.imageIndex < 0) {
      return null;
    }
    const name = sources[tileItem.imageIndex]?.name ?? '';
    return getTransformedConnectionsForName(
      name,
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
  return { statuses, bits: statuses.map((value) => (value ? '1' : '0')).join('') };
};

export default function TileSetEditorScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ setId?: string }>();
  const setId = params.setId ?? '';
  const { replaceTileSourceNamesWithError } = useTileFiles(
    TILE_CATEGORIES[0] as TileCategory
  );
  const {
    tileSets,
    addTileToSet,
    deleteTileFromSet,
    updateTileSet,
    reloadTileSets,
  } = useTileSets({ onTileSourceNamesRemoved: replaceTileSourceNamesWithError });
  const tileSet = tileSets.find((set) => set.id === setId) ?? null;
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectBarAnim = useRef(new Animated.Value(0)).current;
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextTileId, setContextTileId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  const contentWidth = Math.max(0, width);
  const calculatedWidth = Math.floor(
    (contentWidth -
      FILE_GRID_SIDE_PADDING * 2 -
      FILE_GRID_GAP * (FILE_GRID_COLUMNS_MOBILE - 1)) /
      FILE_GRID_COLUMNS_MOBILE
  );
  const cardWidth =
    Platform.OS === 'web' ? Math.min(100, calculatedWidth) : calculatedWidth;

  useEffect(() => {
    Animated.timing(selectBarAnim, {
      toValue: isSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isSelectMode, selectBarAnim]);

  useFocusEffect(
    useCallback(() => {
      reloadTileSets();
    }, [reloadTileSets])
  );

  useEffect(() => {
    if (!tileSet) {
      return;
    }
    setNameDraft(tileSet.name);
  }, [tileSet?.id, tileSet?.name]);

  const contextTile = tileSet?.tiles.find((tile) => tile.id === contextTileId) ?? null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
  };

  const deleteSelected = () => {
    if (!tileSet || selectedIds.size === 0) {
      clearSelection();
      return;
    }
    selectedIds.forEach((id) => deleteTileFromSet(tileSet.id, id));
    clearSelection();
  };

  if (!tileSet) {
    return (
      <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
        <ThemedText type="title" style={styles.emptyText}>
          Tile set not found
        </ThemedText>
      </ThemedView>
    );
  }

  const activeCategories = normalizeCategories(
    tileSet.categories && tileSet.categories.length > 0
      ? tileSet.categories
      : [tileSet.category]
  );
  const sources = getSourcesForCategories(activeCategories);
  const commitName = () => {
    const trimmed = nameDraft.trim();
    updateTileSet(tileSet.id, (set) => ({
      ...set,
      name: trimmed.length > 0 ? trimmed : set.name,
      updatedAt: Date.now(),
    }));
  };
  const remapTileSetTiles = (
    nextCategories: TileCategory[],
    tilesToRemap: TileSetTile[]
  ) => {
    const prevSources = sources;
    const nextSources = getSourcesForCategories(nextCategories);
    const sameSources =
      prevSources.length === nextSources.length &&
      prevSources.every((source, index) => source === nextSources[index]);
    if (sameSources) {
      return tilesToRemap;
    }
    const nextLookup = new Map<
      string,
      Array<{ index: number; rotation: number; mirrorX: boolean; mirrorY: boolean }>
    >();
    nextSources.forEach((source, index) => {
      const base = parseTileConnections(source.name);
      if (!base) {
        return;
      }
      const rotations = [0, 90, 180, 270];
      const mirrors = [
        { mirrorX: false, mirrorY: false },
        { mirrorX: true, mirrorY: false },
        { mirrorX: false, mirrorY: true },
        { mirrorX: true, mirrorY: true },
      ];
      rotations.forEach((rotation) => {
        mirrors.forEach(({ mirrorX, mirrorY }) => {
          const key = transformConnections(base, rotation, mirrorX, mirrorY)
            .map((value) => (value ? '1' : '0'))
            .join('');
          const existing = nextLookup.get(key);
          const entry = { index, rotation, mirrorX, mirrorY };
          if (existing) {
            existing.push(entry);
          } else {
            nextLookup.set(key, [entry]);
          }
        });
      });
    });
    return tilesToRemap.map((tile) => {
      const total = tile.grid.rows * tile.grid.columns;
      const normalized = normalizeTiles(tile.tiles, total, prevSources.length);
      const remapped = normalized.map((placement) => {
        if (!placement || placement.imageIndex < 0) {
          return placement;
        }
        const previousSource = prevSources[placement.imageIndex];
        if (!previousSource) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const existingIndex = nextSources.indexOf(previousSource);
        if (existingIndex >= 0) {
          return {
            imageIndex: existingIndex,
            rotation: placement.rotation,
            mirrorX: placement.mirrorX,
            mirrorY: placement.mirrorY,
          };
        }
        const previousConnections = parseTileConnections(previousSource.name);
        if (!previousConnections) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const renderedKey = transformConnections(
          previousConnections,
          placement.rotation,
          placement.mirrorX,
          placement.mirrorY
        )
          .map((value) => (value ? '1' : '0'))
          .join('');
        const candidates = nextLookup.get(renderedKey);
        if (!candidates || candidates.length === 0) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const match = candidates[0];
        return {
          imageIndex: match.index,
          rotation: match.rotation,
          mirrorX: match.mirrorX,
          mirrorY: match.mirrorY,
        };
      });
      return {
        ...tile,
        tiles: remapped as Tile[],
        updatedAt: Date.now(),
      };
    });
  };
  const closeContextMenu = () => {
    setShowContextMenu(false);
    setContextTileId(null);
  };
  const duplicateTile = (tile: TileSetTile) => {
    updateTileSet(tileSet.id, (set) => {
      const nextTile: TileSetTile = {
        ...tile,
        id: createId('tile'),
        name: `${tile.name} Copy`,
        updatedAt: Date.now(),
      };
      return {
        ...set,
        tiles: [nextTile, ...set.tiles],
        updatedAt: Date.now(),
      };
    });
  };
  const downloadTileSvg = (tile: TileSetTile) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return;
    }
    const { bits } = getBorderStatus(tile, sources);
    void exportTileCanvasAsSvg({
      tiles: tile.tiles,
      gridLayout: {
        rows: tile.grid.rows,
        columns: tile.grid.columns,
        tileSize: tile.preferredTileSize,
      },
      tileSources: sources,
      gridGap: 0,
      errorSource: null,
      lineColor: tileSet.lineColor,
      lineWidth: tileSet.lineWidth,
      backgroundColor: null,
      fileName: `${tileSet.name}_${bits}.svg`,
    });
  };

  return (
    <ThemedView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
        },
      ]}
    >
      {insets.top > 0 && (
        <View pointerEvents="none" style={[styles.statusBarBackground, { height: insets.top }]} />
      )}
      <ThemedView style={styles.fileHeader}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.replace('/tileSetCreator')}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back to tile sets"
          >
            <ThemedText type="defaultSemiBold" style={styles.backText}>
              &lt;
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => router.replace('/tileSetCreator')}
            accessibilityRole="button"
            accessibilityLabel="Go to tile sets"
          >
            <ThemedText type="defaultSemiBold" style={styles.fileTitle}>
              {tileSet.name}
            </ThemedText>
          </Pressable>
        </View>
        <ThemedView style={styles.fileHeaderActions}>
          <Pressable
            onPress={() => {
              const tileId = addTileToSet(tileSet.id);
              router.push({
                pathname: '/tileSetCreator/modifyTile',
                params: { setId: tileSet.id, tileId },
              });
            }}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Create new tile"
          >
            <MaterialCommunityIcons name="plus" size={24} color="#2a2a2a" />
          </Pressable>
          <Pressable
            onPress={() => setIsSelectMode(true)}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Select tiles"
          >
            <MaterialCommunityIcons name="checkbox-marked-outline" size={22} color="#2a2a2a" />
          </Pressable>
          <Pressable
            onPress={() => setShowSettingsOverlay(true)}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Open tile set settings"
          >
            <MaterialCommunityIcons name="tune-vertical-variant" size={22} color="#2a2a2a" />
          </Pressable>
        </ThemedView>
      </ThemedView>
      <Animated.View
        style={[
          styles.fileSelectBar,
          {
            height: selectBarAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 44],
            }),
            opacity: selectBarAnim,
          },
        ]}
        pointerEvents={isSelectMode ? 'auto' : 'none'}
      >
        <Pressable
          onPress={deleteSelected}
          style={styles.fileSelectDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete selected tiles"
        >
          <ThemedText type="defaultSemiBold" style={styles.fileSelectDeleteText}>
            Delete
          </ThemedText>
        </Pressable>
        <ThemedText type="defaultSemiBold" style={styles.fileSelectCount}>
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : ''}
        </ThemedText>
        <Pressable
          onPress={clearSelection}
          style={styles.fileSelectButton}
          accessibilityRole="button"
          accessibilityLabel="Exit selection mode"
        >
          <ThemedText type="defaultSemiBold" style={styles.fileSelectExitText}>
            X
          </ThemedText>
        </Pressable>
      </Animated.View>
      <ScrollView
        style={styles.fileScroll}
        contentContainerStyle={styles.fileGrid}
        showsVerticalScrollIndicator
      >
        {[...tileSet.tiles]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((tile) => {
            const thumbAspect =
              tile.grid.columns > 0 && tile.grid.rows > 0
                ? tile.grid.columns / tile.grid.rows
                : 1;
            return (
              <Pressable
                key={tile.id}
                style={[styles.fileCard, { width: cardWidth }]}
                onPress={() => {
                  if (isSelectMode) {
                    toggleSelect(tile.id);
                  } else {
                    router.push({
                      pathname: '/tileSetCreator/modifyTile',
                      params: { setId: tileSet.id, tileId: tile.id },
                    });
                  }
                }}
                onLongPress={() => {
                  if (Platform.OS !== 'web' || isSelectMode) {
                    return;
                  }
                  setContextTileId(tile.id);
                  setShowContextMenu(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${tile.name}`}
              >
                <ThemedView
                  style={[
                    styles.fileThumb,
                    selectedIds.has(tile.id) && styles.fileThumbSelected,
                    { width: cardWidth, aspectRatio: thumbAspect },
                  ]}
                >
              {tile.thumbnailUri ? (
                    <TileAsset
                      source={{ uri: tile.thumbnailUri }}
                      name="thumbnail.png"
                      style={styles.fileThumbImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <ThemedView style={styles.fileThumbGrid}>
                      {Array.from({ length: tile.grid.rows }, (_, rowIndex) => (
                        <ThemedView
                          key={`row-${tile.id}-${rowIndex}`}
                          style={styles.fileThumbRow}
                        >
                          {Array.from({ length: tile.grid.columns }, (_, colIndex) => {
                            const index = rowIndex * tile.grid.columns + colIndex;
                            const tileItem = tile.tiles[index];
                            const source =
                              tileItem && tileItem.imageIndex >= 0
                                ? sources[tileItem.imageIndex]?.source
                                : null;
                            return (
                              <ThemedView
                                key={`cell-${tile.id}-${index}`}
                                style={styles.fileThumbCell}
                              >
                                {source && tileItem && (
                                  <TileAsset
                                    source={source}
                                    name={sources[tileItem.imageIndex]?.name}
                                    strokeColor={tileSet.lineColor}
                                    strokeWidth={tileSet.lineWidth}
                                    style={[
                                      styles.fileThumbImage,
                                      {
                                        transform: [
                                          { scaleX: tileItem.mirrorX ? -1 : 1 },
                                          { scaleY: tileItem.mirrorY ? -1 : 1 },
                                          { rotate: `${tileItem.rotation ?? 0}deg` },
                                        ],
                                      },
                                    ]}
                                    resizeMode="cover"
                                  />
                                )}
                              </ThemedView>
                            );
                          })}
                        </ThemedView>
                      ))}
                    </ThemedView>
                  )}
                </ThemedView>
              </Pressable>
            );
          })}
      </ScrollView>
      {showContextMenu && contextTile && (
        <ThemedView style={styles.contextOverlay} accessibilityRole="dialog">
          <Pressable style={styles.contextBackdrop} onPress={closeContextMenu} />
          <ThemedView style={styles.contextMenu}>
            <ThemedText type="defaultSemiBold" style={styles.contextTitle}>
              {contextTile.name}
            </ThemedText>
            <Pressable
              onPress={() => {
                duplicateTile(contextTile);
                closeContextMenu();
              }}
              style={styles.contextAction}
              accessibilityRole="button"
              accessibilityLabel="Duplicate tile"
            >
              <ThemedText type="defaultSemiBold" style={styles.contextActionText}>
                Duplicate
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                downloadTileSvg(contextTile);
                closeContextMenu();
              }}
              style={styles.contextAction}
              accessibilityRole="button"
              accessibilityLabel="Download tile as SVG"
            >
              <ThemedText type="defaultSemiBold" style={styles.contextActionText}>
                Download SVG
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => {
                deleteTileFromSet(tileSet.id, contextTile.id);
                closeContextMenu();
              }}
              style={styles.contextAction}
              accessibilityRole="button"
              accessibilityLabel="Delete tile"
            >
              <ThemedText type="defaultSemiBold" style={styles.contextDeleteText}>
                Delete
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={closeContextMenu}
              style={[styles.contextAction, styles.contextCancel]}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <ThemedText type="defaultSemiBold" style={styles.contextActionText}>
                Cancel
              </ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      )}
      {showSettingsOverlay && (
        <ThemedView style={[styles.settingsScreen, { paddingTop: insets.top }]} accessibilityRole="dialog">
          <ThemedView style={styles.settingsHeader}>
            <ThemedText type="title">Tile Set Settings</ThemedText>
            <Pressable
              onPress={() => setShowSettingsOverlay(false)}
              style={styles.settingsClose}
              accessibilityRole="button"
              accessibilityLabel="Close tile set settings"
            >
              <ThemedText type="defaultSemiBold">X</ThemedText>
            </Pressable>
          </ThemedView>
          <ScrollView
            style={styles.settingsScroll}
            contentContainerStyle={styles.settingsContent}
            showsVerticalScrollIndicator
          >
            <ThemedView style={styles.sectionGroup}>
              <ThemedText type="defaultSemiBold">Name</ThemedText>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={commitName}
                onSubmitEditing={commitName}
                style={styles.settingsInput}
                placeholder="Tile Set Name"
                placeholderTextColor="#9ca3af"
                returnKeyType="done"
              />
            </ThemedView>
          </ScrollView>
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#3f3f3f',
  },
  statusBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#e5e5e5',
    zIndex: 5,
  },
  fileHeader: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#E2E3E9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  backButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: {
    color: '#2a2a2a',
  },
  fileTitle: {
    color: '#2a2a2a',
    fontSize: 18,
    lineHeight: 20,
  },
  fileHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    flexShrink: 0,
  },
  headerIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  fileSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#1f1f1f',
    overflow: 'hidden',
  },
  fileSelectButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  fileSelectDelete: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  fileSelectDeleteText: {
    color: '#dc2626',
  },
  fileSelectExitText: {
    color: '#fff',
  },
  fileSelectCount: {
    color: '#9ca3af',
  },
  fileScroll: {
    flex: 1,
  },
  fileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: FILE_GRID_GAP,
    paddingHorizontal: FILE_GRID_SIDE_PADDING,
    paddingTop: 8,
    paddingBottom: 12,
  },
  fileCard: {
    alignItems: 'center',
  },
  fileThumb: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    padding: 4,
    overflow: 'hidden',
  },
  fileThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  fileThumbGrid: {
    flex: 1,
  },
  fileThumbRow: {
    flexDirection: 'row',
    flex: 1,
  },
  fileThumbCell: {
    flex: 1,
    backgroundColor: '#000',
  },
  fileThumbImage: {
    width: '100%',
    height: '100%',
  },
  contextOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contextBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  contextMenu: {
    width: 240,
    padding: 12,
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#111',
    backgroundColor: '#fff',
  },
  contextTitle: {
    color: '#111',
    marginBottom: 4,
  },
  contextAction: {
    paddingVertical: 6,
  },
  contextActionText: {
    color: '#111',
  },
  contextDeleteText: {
    color: '#b91c1c',
  },
  contextCancel: {
    marginTop: 2,
  },
  emptyText: {
    color: '#fff',
    padding: 16,
  },
  settingsScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 20,
  },
  settingsHeader: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  settingsClose: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  settingsScroll: {
    flex: 1,
  },
  settingsContent: {
    padding: 16,
    gap: 12,
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
    backgroundColor: '#fff',
  },
  overlayList: {
    gap: 8,
  },
  sectionGroup: {
    gap: 8,
  },
  inlineOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  overlayItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  overlayItemSelected: {
    borderColor: '#22c55e',
  },
  errorText: {
    color: '#ef4444',
    marginTop: 6,
  },
});
