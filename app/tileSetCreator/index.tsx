import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
import { TileAsset } from '@/components/tile-asset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileSets } from '@/hooks/use-tile-sets';

const HEADER_HEIGHT = 50;
const FILE_GRID_COLUMNS_MOBILE = 3;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const DEFAULT_CATEGORY = TILE_CATEGORIES[0];

export default function TileSetCreatorScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tileSets, createTileSet, createTileSetAsync, deleteTileSet } = useTileSets();
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectBarAnim = useRef(new Animated.Value(0)).current;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [newCategory, setNewCategory] = useState<TileCategory>(DEFAULT_CATEGORY);
  const [newResolution, setNewResolution] = useState(4);
  const [newName, setNewName] = useState('New Tile Set');
  const [isCreating, setIsCreating] = useState(false);
  const [createProgress, setCreateProgress] = useState({ current: 0, total: 51 });
  const progressAnim = useRef(new Animated.Value(0)).current;

  const contentWidth = Math.max(0, width);
  const fileCardWidth = Math.floor(
    (contentWidth -
      FILE_GRID_SIDE_PADDING * 2 -
      FILE_GRID_GAP * (FILE_GRID_COLUMNS_MOBILE - 1)) /
      FILE_GRID_COLUMNS_MOBILE
  );

  useEffect(() => {
    Animated.timing(selectBarAnim, {
      toValue: isSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isSelectMode, selectBarAnim]);

  useEffect(() => {
    if (!isCreating) {
      progressAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isCreating, progressAnim]);

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

  const openCreateModal = () => {
    setNewName('New Tile Set');
    setNewCategory(DEFAULT_CATEGORY);
    setNewResolution(4);
    setShowCreateModal(true);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) {
      clearSelection();
      return;
    }
    selectedIds.forEach((id) => deleteTileSet(id));
    clearSelection();
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
        <Pressable
          onPress={() => router.push('/')}
          accessibilityRole="button"
          accessibilityLabel="Go to files"
        >
          <ThemedText type="title" style={styles.fileTitle}>
            Tile Sets
          </ThemedText>
        </Pressable>
        <ThemedView style={styles.fileHeaderActions}>
          <Pressable
            onPress={openCreateModal}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Create new tile set"
          >
            <MaterialCommunityIcons name="plus" size={24} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => setIsSelectMode(true)}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Select tile sets"
          >
            <MaterialCommunityIcons name="checkbox-marked-outline" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => setShowSettingsOverlay(true)}
            style={styles.headerIcon}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <MaterialCommunityIcons name="cog" size={22} color="#fff" />
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
          accessibilityLabel="Delete selected tile sets"
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
        {[...tileSets]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((set) => {
            const tile = set.tiles[0];
            const sources = TILE_MANIFEST[set.category] ?? [];
            const thumbAspect =
              tile && tile.grid.columns > 0 && tile.grid.rows > 0
                ? tile.grid.columns / tile.grid.rows
                : 1;
            return (
              <Pressable
                key={set.id}
                style={[styles.fileCard, { width: fileCardWidth }]}
                onPress={() => {
                  if (isSelectMode) {
                    toggleSelect(set.id);
                  } else {
                    router.push({
                      pathname: '/tileSetCreator/editor',
                      params: { setId: set.id },
                    });
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${set.name}`}
              >
                <ThemedView
                  style={[
                    styles.fileThumb,
                    selectedIds.has(set.id) && styles.fileThumbSelected,
                    { width: fileCardWidth, aspectRatio: thumbAspect },
                  ]}
                >
                  {tile?.thumbnailUri ? (
                    <TileAsset
                      source={{ uri: tile.thumbnailUri }}
                      name="thumbnail.png"
                      style={styles.fileThumbImage}
                      resizeMode="cover"
                    />
                  ) : tile ? (
                    <ThemedView style={styles.fileThumbGrid}>
                      {Array.from({ length: tile.grid.rows }, (_, rowIndex) => (
                        <ThemedView
                          key={`row-${set.id}-${rowIndex}`}
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
                                key={`cell-${set.id}-${index}`}
                                style={styles.fileThumbCell}
                              >
                                {source && tileItem && (
                                  <TileAsset
                                    source={source}
                                    name={sources[tileItem.imageIndex]?.name}
                                    strokeColor={set.lineColor}
                                    strokeWidth={set.lineWidth}
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
                  ) : (
                    <View style={styles.fileThumbGrid} />
                  )}
                </ThemedView>
                <ThemedText numberOfLines={1} style={styles.fileCardName}>
                  {set.name}
                </ThemedText>
              </Pressable>
            );
          })}
      </ScrollView>
      {showCreateModal && (
        <ThemedView style={styles.overlay} accessibilityRole="dialog">
          <Pressable
            style={styles.overlayBackdrop}
            accessibilityRole="button"
            accessibilityLabel="Backdrop"
          />
          <ThemedView style={styles.overlayPanel}>
            <ThemedText type="title">New Tile Set</ThemedText>
            <ThemedView style={styles.sectionGroup}>
              <ThemedText type="defaultSemiBold">Name</ThemedText>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                style={styles.settingsInput}
                placeholder="New Tile Set"
                placeholderTextColor="#9ca3af"
                returnKeyType="done"
              />
            </ThemedView>
            <ThemedText type="defaultSemiBold">Tile Set</ThemedText>
            <ThemedView style={styles.overlayList}>
              {TILE_CATEGORIES.map((category) => (
                <Pressable
                  key={category}
                  onPress={() => setNewCategory(category)}
                  style={[
                    styles.overlayItem,
                    category === newCategory && styles.overlayItemSelected,
                  ]}
                >
                  <ThemedText type="defaultSemiBold">{category}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>
            <ThemedText type="defaultSemiBold">Resolution</ThemedText>
            <ThemedView style={styles.inlineOptions}>
              {Array.from({ length: 7 }, (_, index) => index + 2).map((value) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    setNewResolution(value);
                  }}
                  style={[
                    styles.overlayItem,
                    value === newResolution && styles.overlayItemSelected,
                  ]}
                >
                  <ThemedText type="defaultSemiBold">{value}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>
            <ThemedView style={styles.modalActions}>
              <Pressable
                onPress={() => setShowCreateModal(false)}
                style={[styles.actionButton, styles.actionButtonGhost]}
                accessibilityRole="button"
                accessibilityLabel="Cancel new tile set"
              >
                <ThemedText type="defaultSemiBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsCreating(true);
                  setShowCreateModal(false);
                  setCreateProgress({ current: 0, total: 51 });
                  void (async () => {
                    const id = await createTileSetAsync({
                      name: newName.trim() || 'New Tile Set',
                      category: newCategory,
                      resolution: newResolution,
                      onProgress: (current, total) =>
                        setCreateProgress({ current, total }),
                    });
                    setIsCreating(false);
                    router.push({
                      pathname: '/tileSetCreator/editor',
                      params: { setId: id },
                    });
                  })();
                }}
                style={[styles.actionButton, styles.actionButtonPrimary]}
                accessibilityRole="button"
                accessibilityLabel="Create new tile set"
              >
                <ThemedText type="defaultSemiBold" style={styles.actionButtonText}>
                  Create
                </ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        </ThemedView>
      )}
      {showSettingsOverlay && (
        <ThemedView style={styles.overlay} accessibilityRole="dialog">
          <Pressable
            style={styles.overlayBackdrop}
            onPress={() => setShowSettingsOverlay(false)}
            accessibilityRole="button"
            accessibilityLabel="Close settings"
          />
          <ThemedView style={styles.overlayPanel}>
            <ThemedText type="title">Settings</ThemedText>
            <Pressable
              onPress={() => setShowSettingsOverlay(false)}
              style={styles.overlayItem}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <ThemedText type="defaultSemiBold">Close</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      )}
      {isCreating && (
        <ThemedView style={styles.overlay} accessibilityRole="alert">
          <View style={styles.progressPanel}>
            <ThemedText type="defaultSemiBold">
              Creating tile set... {createProgress.current}/{createProgress.total}
            </ThemedText>
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    transform: [
                      {
                        translateX: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-120, 120],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </View>
          </View>
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
    backgroundColor: '#fff',
    zIndex: 5,
  },
  fileHeader: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#2a2a2a',
  },
  fileTitle: {
    color: '#fff',
  },
  fileHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
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
  fileCardName: {
    marginTop: 6,
    color: '#e5e7eb',
  },
  fileThumb: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    padding: 4,
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  overlayPanel: {
    width: '85%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  overlayList: {
    gap: 8,
  },
  inlineOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionGroup: {
    gap: 8,
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
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    alignItems: 'center',
  },
  actionButtonGhost: {
    backgroundColor: '#fff',
  },
  actionButtonPrimary: {
    backgroundColor: '#111',
  },
  actionButtonText: {
    color: '#fff',
  },
  progressPanel: {
    width: '70%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  progressBar: {
    width: '50%',
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#22c55e',
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
});
