import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import ViewShot from 'react-native-view-shot';

import {
    TILE_CATEGORIES,
    TILE_MANIFEST,
    type TileCategory,
} from '@/assets/images/tiles/manifest';
import { DesktopNavTabs } from '@/components/desktop-nav-tabs';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TileAsset } from '@/components/tile-asset';
import { TAB_BAR_HEIGHT, useTabBarVisible } from '@/contexts/tab-bar-visible';
import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';
import { useTileFiles } from '@/hooks/use-tile-files';
import { type TileSetTile, useTileSets } from '@/hooks/use-tile-sets';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { type Tile } from '@/utils/tile-grid';

const HEADER_HEIGHT = 50;
const FILE_GRID_COLUMNS_MOBILE = 3;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const DEFAULT_CATEGORY = TILE_CATEGORIES[0];

type BakedPreview = { uri: string; signature: string };

/** Persist baked previews across navigations so we avoid flashing the live grid. */
const bakedPreviewCache = new Map<string, BakedPreview>();

type TileSetPreviewProps = {
  setId: string;
  previewTiles: TileSetTile[];
  sources: Array<(typeof TILE_MANIFEST)[keyof typeof TILE_MANIFEST][number]>;
  lineColor: string;
  lineWidth: number;
  bakedPreviewUri: string | null;
};

export default function TileSetCreatorScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tabBarVisible } = useTabBarVisible();
  const isMobileWeb = useIsMobileWeb();
  const { replaceTileSourceNamesWithError } = useTileFiles(
    DEFAULT_CATEGORY as TileCategory
  );
  const {
    tileSets,
    bakedSourcesBySetId,
    currentBakedNamesBySetId,
    createTileSet,
    deleteTileSet,
    updateTileSet,
  } = useTileSets({ onTileSourceNamesRemoved: replaceTileSourceNamesWithError });
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectBarAnim = useRef(new Animated.Value(0)).current;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newResolution, setNewResolution] = useState(2);
  const [newName, setNewName] = useState('4x4 (New)');
  const [downloadSetId, setDownloadSetId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [bakedPreviews, setBakedPreviews] = useState<Record<string, BakedPreview>>(
    {}
  );
  const bakedPreviewRef = useRef<Record<string, BakedPreview>>({});
  const currentBakedNameSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    Object.entries(currentBakedNamesBySetId).forEach(([setId, names]) => {
      if (Array.isArray(names) && names.length > 0) {
        map.set(setId, new Set(names));
      }
    });
    return map;
  }, [currentBakedNamesBySetId]);

  const contentWidth = Math.max(0, width);
  const maxThumbSize = Platform.OS === 'web' ? 150 : Number.POSITIVE_INFINITY;
  const fileCardWidth = Math.min(
    Math.floor(
      (contentWidth -
        FILE_GRID_SIDE_PADDING * 2 -
        FILE_GRID_GAP * (FILE_GRID_COLUMNS_MOBILE - 1)) /
        FILE_GRID_COLUMNS_MOBILE
    ),
    maxThumbSize
  );

  useEffect(() => {
    Animated.timing(selectBarAnim, {
      toValue: isSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isSelectMode, selectBarAnim]);

  useEffect(() => {
    bakedPreviewRef.current = bakedPreviews;
  }, [bakedPreviews]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    let cancelled = false;
    const buildSignature = (set: (typeof tileSets)[number]) => {
      const previewTiles = set.tiles.slice(0, 4);
      const tileTokens = previewTiles
        .map((tile) => `${tile.id}:${tile.updatedAt}:${tile.thumbnailUri ?? ''}`)
        .join('|');
      return `${set.updatedAt}:${tileTokens}`;
    };
    const next: Record<string, BakedPreview> = {};
    const signatures: Record<string, string> = {};
    for (const set of tileSets) {
      const signature = buildSignature(set);
      signatures[set.id] = signature;
      const fromRef = bakedPreviewRef.current[set.id];
      const fromModuleCache = bakedPreviewCache.get(set.id);
      if (fromRef?.signature === signature) {
        next[set.id] = fromRef;
        continue;
      }
      if (fromModuleCache?.signature === signature) {
        next[set.id] = fromModuleCache;
        continue;
      }
    }
    if (Object.keys(next).length > 0) {
      setBakedPreviews((prev) => ({ ...prev, ...next }));
    }
    const buildPreviews = async () => {
      for (const set of tileSets) {
        const previewTiles = set.tiles.slice(0, 4);
        const signature = signatures[set.id];
        if (next[set.id]) {
          continue;
        }
        if (previewTiles.length === 0) {
          continue;
        }
        const categories =
          set.categories && set.categories.length > 0 ? set.categories : [set.category];
        const sources = categories.flatMap((category) => TILE_MANIFEST[category] ?? []);

        const tileThumbs: Array<string | null> = [];
        for (const tile of previewTiles) {
          if (tile.thumbnailUri) {
            tileThumbs.push(tile.thumbnailUri);
            continue;
          }
          const uri = await renderTileCanvasToDataUrl({
            tiles: tile.tiles,
            gridLayout: {
              rows: tile.grid.rows,
              columns: tile.grid.columns,
              tileSize: tile.preferredTileSize,
            },
            tileSources: sources,
            gridGap: 0,
            blankSource: null,
            errorSource: null,
            lineColor: set.lineColor,
            lineWidth: set.lineWidth,
            backgroundColor: null,
            maxDimension: 256,
          });
          tileThumbs.push(uri);
        }

        const compositeSources: typeof sources = [];
        const compositeTiles: Tile[] = [];
        tileThumbs.forEach((uri) => {
          if (uri) {
            compositeSources.push({ name: 'preview', source: { uri } });
            compositeTiles.push({
              imageIndex: compositeSources.length - 1,
              mirrorX: false,
              mirrorY: false,
              rotation: 0,
            });
          } else {
            compositeTiles.push({
              imageIndex: -1,
              mirrorX: false,
              mirrorY: false,
              rotation: 0,
            });
          }
        });

        const compositeUri = await renderTileCanvasToDataUrl({
          tiles: compositeTiles,
          gridLayout: {
            rows: 2,
            columns: 2,
            tileSize: 192,
          },
          tileSources: compositeSources,
          gridGap: 3,
          blankSource: null,
          errorSource: null,
          backgroundColor: '#000',
          backgroundLineColor: '#9ca3af',
          backgroundLineWidth: 5,
          maxDimension: 768,
        });

        if (compositeUri) {
          const baked: BakedPreview = { uri: compositeUri, signature };
          next[set.id] = baked;
          bakedPreviewCache.set(set.id, baked);
        }
      }

      if (cancelled) {
        return;
      }

      setBakedPreviews((prev) => {
        const merged: Record<string, BakedPreview> = { ...prev };
        tileSets.forEach((set) => {
          const update = next[set.id];
          if (update) {
            merged[set.id] = update;
            return;
          }
          const signature = signatures[set.id];
          if (signature && merged[set.id]?.signature !== signature) {
            delete merged[set.id];
            bakedPreviewCache.delete(set.id);
          }
        });
        Object.keys(merged).forEach((id) => {
          if (!tileSets.find((set) => set.id === id)) {
            delete merged[id];
            bakedPreviewCache.delete(id);
          }
        });
        Object.keys(prev).forEach((id) => {
          if (!(id in merged)) {
            bakedPreviewCache.delete(id);
          }
        });
        return merged;
      });
    };

    void buildPreviews();
    return () => {
      cancelled = true;
    };
  }, [tileSets]);

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
    const defaultResolution = 2;
    setNewName(`${defaultResolution}x${defaultResolution} (New)`);
    setNewResolution(defaultResolution);
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

  const downloadTileSetZip = async (setId: string) => {
    if (Platform.OS !== 'web') {
      return;
    }
    const set = tileSets.find((entry) => entry.id === setId);
    if (!set) {
      return;
    }
    const sources = bakedSourcesBySetId[setId] ?? [];
    const currentNames = currentBakedNameSets.get(setId);
    const activeSources =
      currentNames && currentNames.size > 0
        ? sources.filter((source) => currentNames.has(source.name))
        : sources;
    if (activeSources.length === 0) {
      setDownloadError('No baked tiles available yet.');
      return;
    }
    setIsDownloadingZip(true);
    setDownloadError(null);
    try {
      const readSvg = async (uri: string) => {
        if (uri.startsWith('data:image/svg+xml')) {
          const parts = uri.split(',');
          const header = parts[0] ?? '';
          const body = parts.slice(1).join(',');
          if (header.includes(';base64')) {
            return typeof atob === 'function' ? atob(body) : '';
          }
          try {
            return decodeURIComponent(body);
          } catch {
            return body;
          }
        }
        const response = await fetch(uri);
        return await response.text();
      };
      const connectivityFromName = (name: string): string => {
        const match = name.match(/_([01]{8})\.svg$/);
        return match?.[1] ?? '00000000';
      };
      const baseSetName = set.name
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w\-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'tile-set';
      const connectivityCounts = new Map<string, number>();
      for (let i = 0; i < activeSources.length; i += 1) {
        const conn = connectivityFromName(activeSources[i].name ?? '');
        connectivityCounts.set(conn, (connectivityCounts.get(conn) ?? 0) + 1);
      }
      const connectivityOrdinal = new Map<string, number>();
      const zip = new JSZip();
      for (let i = 0; i < activeSources.length; i += 1) {
        const source = activeSources[i];
        const uri = (source.source as { uri?: string })?.uri;
        if (!uri) {
          continue;
        }
        const svg = await readSvg(uri);
        const connectivity = connectivityFromName(source.name ?? '');
        const count = connectivityCounts.get(connectivity) ?? 1;
        const fileName =
          count > 1
            ? `${baseSetName}_${String((connectivityOrdinal.get(connectivity) ?? 0) + 1).padStart(2, '0')}_${connectivity}.svg`
            : `${baseSetName}_${connectivity}.svg`;
        if (count > 1) {
          connectivityOrdinal.set(connectivity, (connectivityOrdinal.get(connectivity) ?? 0) + 1);
        }
        zip.file(fileName, svg);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const safeName = set.name.trim().replace(/[^\w\-]+/g, '_') || 'tile-set';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDownloadSetId(null);
    } catch {
      setDownloadError('Failed to build zip.');
    } finally {
      setIsDownloadingZip(false);
    }
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
        {Platform.OS === 'web' && !isMobileWeb ? (
          <DesktopNavTabs />
        ) : (
          <Pressable
            onPress={() => router.push('/')}
            accessibilityRole="button"
            accessibilityLabel="Go to files"
          >
            <ThemedText type="title" style={styles.fileTitle}>
              Tile Sets
            </ThemedText>
          </Pressable>
        )}
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
        contentContainerStyle={[
          styles.fileGrid,
          tabBarVisible && {
            paddingBottom:
              FILE_GRID_GAP + TAB_BAR_HEIGHT + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator
      >
        {[...tileSets]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((set) => {
            const previewTiles = set.tiles.slice(0, 4);
            const categories =
              set.categories && set.categories.length > 0
                ? set.categories
                : [set.category];
            const sources = categories.flatMap(
              (category) => TILE_MANIFEST[category] ?? []
            );
            const bakedPreview = bakedPreviews[set.id]?.uri ?? null;
            const thumbAspect =
              previewTiles[0] && previewTiles[0].grid.columns > 0 && previewTiles[0].grid.rows > 0
                ? previewTiles[0].grid.columns / previewTiles[0].grid.rows
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
                onLongPress={() => {
                  if (Platform.OS !== 'web' || isSelectMode) {
                    return;
                  }
                  setDownloadError(null);
                  setDownloadSetId(set.id);
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
                  <TileSetPreview
                    setId={set.id}
                    previewTiles={previewTiles}
                    sources={sources}
                    lineColor={set.lineColor}
                    lineWidth={set.lineWidth}
                    bakedPreviewUri={bakedPreview}
                  />
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
            <ThemedText type="defaultSemiBold">Resolution</ThemedText>
            <ThemedView style={styles.inlineOptions}>
              {[2, 3, 4].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => {
                    setNewResolution(value);
                    setNewName((prev) => {
                      const trimmed = prev.trim();
                      const isAutoName =
                        trimmed.length === 0 ||
                        trimmed === 'New Tile Set' ||
                        /^\d+x\d+\s*\(New\)$/i.test(trimmed);
                      if (!isAutoName) {
                        return prev;
                      }
                      return `${value}x${value} (New)`;
                    });
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
                  setShowCreateModal(false);
                  const id = createTileSet({
                    name:
                      newName.trim() ||
                      `${newResolution}x${newResolution} (New)`,
                    category: DEFAULT_CATEGORY,
                    resolution: newResolution,
                  });
                  router.push({
                    pathname: '/tileSetCreator/editor',
                    params: { setId: id },
                  });
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
      {downloadSetId && (
        <ThemedView style={styles.overlay} accessibilityRole="dialog">
          <Pressable
            style={styles.overlayBackdrop}
            onPress={() => setDownloadSetId(null)}
            accessibilityRole="button"
            accessibilityLabel="Close download dialog"
          />
          <ThemedView style={styles.overlayPanel}>
            <ThemedText type="title">Download Tile Set</ThemedText>
            <ThemedText type="defaultSemiBold">
              Download all tiles in this set as a zip of SVGs.
            </ThemedText>
            {downloadError && (
              <ThemedText type="defaultSemiBold" style={styles.errorText}>
                {downloadError}
              </ThemedText>
            )}
            <ThemedView style={styles.modalActions}>
              <Pressable
                onPress={() => setDownloadSetId(null)}
                style={[styles.actionButton, styles.actionButtonGhost]}
                accessibilityRole="button"
                accessibilityLabel="Cancel download"
              >
                <ThemedText type="defaultSemiBold">Cancel</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => downloadTileSetZip(downloadSetId)}
                style={[
                  styles.actionButton,
                  styles.actionButtonPrimary,
                  isDownloadingZip && styles.actionButtonDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Download tile set"
              >
                <ThemedText type="defaultSemiBold" style={styles.actionButtonText}>
                  {isDownloadingZip ? 'Preparing…' : 'Download'}
                </ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        </ThemedView>
      )}
    </ThemedView>
  );
}

const TileSetPreview = ({
  setId,
  previewTiles,
  sources,
  lineColor,
  lineWidth,
  bakedPreviewUri,
}: TileSetPreviewProps) => {
  const [nativePreviewUri, setNativePreviewUri] = useState<string | null>(null);
  const viewShotRef = useRef<ViewShot>(null);
  const signature = useMemo(() => {
    const tileTokens = previewTiles
      .map((tile) => `${tile.id}:${tile.updatedAt}:${tile.thumbnailUri ?? ''}`)
      .join('|');
    return `${setId}:${lineColor}:${lineWidth}:${tileTokens}`;
  }, [lineColor, lineWidth, previewTiles, setId]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    if (previewTiles.length === 0) {
      setNativePreviewUri(null);
      return;
    }
    let cancelled = false;
    setNativePreviewUri(null);
    const capture = async () => {
      if (!viewShotRef.current) {
        return;
      }
      try {
        const uri = await viewShotRef.current.capture?.({
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });
        if (!cancelled && uri) {
          setNativePreviewUri(uri);
        }
      } catch {
        // Ignore capture failures and fall back to live preview.
      }
    };
    const handle = setTimeout(() => {
      void capture();
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [signature]);

  if (bakedPreviewUri) {
    return (
      <TileAsset
        source={{ uri: bakedPreviewUri }}
        name="tile-set-preview.png"
        style={[
          styles.fileThumbImage,
          Platform.OS === 'web' && { backgroundColor: '#111' },
        ]}
        resizeMode="cover"
      />
    );
  }

  if (Platform.OS !== 'web' && nativePreviewUri) {
    return (
      <TileAsset
        source={{ uri: nativePreviewUri }}
        name="tile-set-preview.png"
        style={styles.fileThumbImage}
        resizeMode="cover"
      />
    );
  }

  if (Platform.OS === 'web' && previewTiles.length > 0) {
    return (
      <View
        style={[styles.fileThumbImage, styles.fileThumbPlaceholder]}
        accessibilityLabel="Loading preview"
      />
    );
  }

  const previewGrid = (
    <ThemedView
      style={Platform.OS === 'web' ? styles.fileThumbGrid : styles.fileThumbGridCapture}
    >
      {[0, 1].map((rowIndex) => (
        <ThemedView
          key={`row-${setId}-${rowIndex}`}
          style={Platform.OS === 'web' ? styles.fileThumbRow : styles.fileThumbRowCapture}
        >
          {[0, 1].map((colIndex) => {
            const previewIndex = rowIndex * 2 + colIndex;
            const tile = previewTiles[previewIndex];
            if (!tile) {
              return (
                <ThemedView
                  key={`cell-${setId}-${previewIndex}`}
                  style={Platform.OS === 'web' ? styles.fileThumbCell : styles.fileThumbCellCapture}
                />
              );
            }
            if (tile.thumbnailUri) {
              return (
                <ThemedView
                  key={`cell-${setId}-${previewIndex}`}
                  style={Platform.OS === 'web' ? styles.fileThumbCell : styles.fileThumbCellCapture}
                >
                  <TileAsset
                    source={{ uri: tile.thumbnailUri }}
                    name="thumbnail.png"
                    style={styles.fileThumbImage}
                    resizeMode="cover"
                  />
                </ThemedView>
              );
            }
            return (
              <ThemedView
                key={`cell-${setId}-${previewIndex}`}
                style={Platform.OS === 'web' ? styles.fileThumbCell : styles.fileThumbCellCapture}
              >
                <ThemedView
                  style={
                    Platform.OS === 'web' ? styles.fileThumbGrid : styles.fileThumbGridCapture
                  }
                >
                  {Array.from({ length: tile.grid.rows }, (_, tileRow) => (
                    <ThemedView
                      key={`row-${setId}-${previewIndex}-${tileRow}`}
                      style={
                        Platform.OS === 'web' ? styles.fileThumbRow : styles.fileThumbRowCapture
                      }
                    >
                      {Array.from({ length: tile.grid.columns }, (_, tileCol) => {
                        const index = tileRow * tile.grid.columns + tileCol;
                        const tileItem = tile.tiles[index];
                        const source =
                          tileItem && tileItem.imageIndex >= 0
                            ? sources[tileItem.imageIndex]?.source
                            : null;
                        return (
                          <ThemedView
                            key={`cell-${setId}-${previewIndex}-${index}`}
                            style={
                              Platform.OS === 'web'
                                ? styles.fileThumbCell
                                : styles.fileThumbCellCapture
                            }
                          >
                            {source && tileItem && (
                              <TileAsset
                                source={source}
                                name={sources[tileItem.imageIndex]?.name}
                                strokeColor={lineColor}
                                strokeWidth={lineWidth}
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
              </ThemedView>
            );
          })}
        </ThemedView>
      ))}
    </ThemedView>
  );

  if (Platform.OS !== 'web') {
    return (
      <ViewShot
        ref={viewShotRef}
        options={{ format: 'png', quality: 1, result: 'tmpfile' }}
        style={[styles.fileThumbImage, styles.fileThumbCapture]}
      >
        {previewGrid}
      </ViewShot>
    );
  }

  return previewGrid;
};

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
    backgroundColor: '#202125',
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
    gap: 2,
  },
  fileThumbRow: {
    flexDirection: 'row',
    flex: 1,
    gap: 2,
  },
  fileThumbCell: {
    flex: 1,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#9ca3af',
    margin: 1,
  },
  fileThumbGridCapture: {
    flex: 1,
    gap: 1,
  },
  fileThumbRowCapture: {
    flexDirection: 'row',
    flex: 1,
    gap: 1,
  },
  fileThumbCellCapture: {
    flex: 1,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#9ca3af',
    margin: 0,
  },
  fileThumbImage: {
    width: '100%',
    height: '100%',
  },
  fileThumbPlaceholder: {
    backgroundColor: '#111',
  },
  fileThumbCapture: {
    backgroundColor: '#000',
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
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#fff',
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
  },
});
