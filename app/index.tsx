import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTileFiles } from '@/hooks/use-tile-files';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { normalizeTiles, type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BRUSH_PANEL_ROW_GAP = 1;
const FILE_GRID_COLUMNS_MOBILE = 3;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const DEFAULT_CATEGORY = TILE_CATEGORIES[0];
const BLANK_TILE = require('@/assets/images/tiles/tile_blank.png');
const ERROR_TILE = require('@/assets/images/tiles/tile_error.png');

type ToolbarButtonProps = {
  label: string;
  onPress: () => void;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  active?: boolean;
  color?: string;
};

function ToolbarButton({ label, onPress, icon, active, color }: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      style={styles.toolbarButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={color ?? (active ? '#22c55e' : 'rgba(42, 42, 42, 0.8)')}
      />
      {Platform.OS === 'web' && hovered && (
        <Text style={styles.tooltip} accessibilityElementsHidden>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

type NavButtonProps = {
  label: string;
  onPress: () => void;
};

function NavButton({ label, onPress }: NavButtonProps) {
  return (
    <Pressable onPress={onPress} style={styles.navButton} accessibilityRole="button">
      <ThemedText type="defaultSemiBold" style={styles.navButtonText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

type TileCellProps = {
  cellIndex: number;
  tileSize: number;
  tile: Tile;
  tileSources: typeof TILE_MANIFEST[TileCategory];
  showDebug: boolean;
  isCloneSource: boolean;
  isCloneSample: boolean;
  isCloneTargetOrigin: boolean;
  isCloneCursor: boolean;
};

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    isCloneSource,
    isCloneSample,
    isCloneTargetOrigin,
    isCloneCursor,
  }: TileCellProps) => {
    const tileName = tileSources[tile.imageIndex]?.name ?? '';
    const connections = useMemo(
      () =>
        showDebug && tile.imageIndex >= 0
          ? getTransformedConnectionsForName(
              tileName,
              tile.rotation,
              tile.mirrorX,
              tile.mirrorY
            )
          : null,
      [showDebug, tile.imageIndex, tile.mirrorX, tile.mirrorY, tile.rotation, tileName]
    );
    const source =
      tile.imageIndex < 0
        ? tile.imageIndex === -2
          ? ERROR_TILE
          : BLANK_TILE
        : tileSources[tile.imageIndex]?.source ?? ERROR_TILE;

    return (
      <View
        key={`cell-${cellIndex}`}
        accessibilityRole="button"
        accessibilityLabel={`Tile ${cellIndex + 1}`}
        style={[
          styles.tile,
          { width: tileSize, height: tileSize },
          isCloneSource && styles.cloneSource,
        ]}
      >
        <Image
          source={source}
          style={[
            styles.tileImage,
            {
              transform: [
                { scaleX: tile.mirrorX ? -1 : 1 },
                { scaleY: tile.mirrorY ? -1 : 1 },
                { rotate: `${tile.rotation}deg` },
              ],
            },
          ]}
          resizeMode="cover"
          fadeDuration={0}
        />
        {isCloneTargetOrigin && (
          <View pointerEvents="none" style={styles.cloneTargetOrigin} />
        )}
        {isCloneCursor && <View pointerEvents="none" style={styles.cloneCursor} />}
        {isCloneSample && <View pointerEvents="none" style={styles.cloneSample} />}
        {showDebug && <TileDebugOverlay connections={connections} />}
      </View>
    );
  },
  (prev, next) =>
    prev.tile === next.tile &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.tileSources === next.tileSources &&
    prev.isCloneSource === next.isCloneSource &&
    prev.isCloneSample === next.isCloneSample &&
    prev.isCloneTargetOrigin === next.isCloneTargetOrigin &&
    prev.isCloneCursor === next.isCloneCursor
);

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const gridRef = useRef<View>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const { settings, setSettings } = usePersistedSettings();
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => DEFAULT_CATEGORY
  );
  const [showTileSetOverlay, setShowTileSetOverlay] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [fileMenuTargetId, setFileMenuTargetId] = useState<string | null>(null);
  const [downloadTargetId, setDownloadTargetId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadOverlay, setShowDownloadOverlay] = useState(false);
  const [downloadRenderKey, setDownloadRenderKey] = useState(0);
  const [downloadLoadedCount, setDownloadLoadedCount] = useState(0);
  const [isHydratingFile, setIsHydratingFile] = useState(false);
  const NEW_FILE_TILE_SIZES = [25, 50, 75, 100, 150, 200] as const;
  const [viewMode, setViewMode] = useState<'modify' | 'file'>('file');
  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean }
  >({
    mode: 'random',
  });
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>(
    {}
  );
  const [paletteMirrors, setPaletteMirrors] = useState<Record<number, boolean>>({});
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const isWeb = Platform.OS === 'web';
  const shouldUseAspectRatio = false;
  const aspectRatio = null;
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height - insets.top);
  const contentWidth = aspectRatio
    ? Math.min(safeWidth, safeHeight / aspectRatio)
    : safeWidth;
  const rawContentHeight = aspectRatio ? contentWidth * aspectRatio : safeHeight;
  const contentHeight = Math.max(0, rawContentHeight);

  const availableWidth = contentWidth - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    contentHeight -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      BRUSH_PANEL_HEIGHT,
    0
  );

  const {
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
  } = useTileFiles(DEFAULT_CATEGORY);

  const fileTileSize = activeFile?.preferredTileSize ?? settings.preferredTileSize;

  const {
    gridLayout,
    tiles,
    handlePress,
    floodComplete,
    resetTiles,
    loadTiles,
    clearCloneSource,
    setCloneSource,
    cloneSourceIndex,
    cloneSampleIndex,
    cloneAnchorIndex,
    cloneCursorIndex,
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    preferredTileSize: fileTileSize,
    allowEdgeConnections: settings.allowEdgeConnections,
    suspendRemap: isHydratingFile,
    fixedRows: activeFile?.grid.rows ?? 0,
    fixedColumns: activeFile?.grid.columns ?? 0,
    brush,
    mirrorHorizontal: settings.mirrorHorizontal,
    mirrorVertical: settings.mirrorVertical,
  });
  const gridHeight =
    gridLayout.rows * gridLayout.tileSize +
    GRID_GAP * Math.max(0, gridLayout.rows - 1);
  const brushPanelHeight = Math.max(
    0,
    contentHeight - HEADER_HEIGHT - CONTENT_PADDING * 2 - TITLE_SPACING - gridHeight
  );
  const brushItemSize = Math.max(
    0,
    Math.floor((brushPanelHeight - BRUSH_PANEL_ROW_GAP) / 2)
  );
  const lastPaintedRef = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoadedFileRef = useRef<string | null>(null);
  const isHydratingFileRef = useRef(false);
  const viewShotRef = useRef<ViewShot>(null);
  const downloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSwitchRef = useRef<string | null>(null);
  const downloadExpectedRef = useRef(0);
  const pendingRestoreRef = useRef<{
    fileId: string;
    tiles: Tile[];
    rows: number;
    columns: number;
    preferredTileSize: number;
    category: TileCategory;
  } | null>(null);
  const setHydrating = useCallback((value: boolean) => {
    isHydratingFileRef.current = value;
    setIsHydratingFile(value);
  }, []);
  const rowIndices = useMemo(
    () => Array.from({ length: gridLayout.rows }, (_, index) => index),
    [gridLayout.rows]
  );
  const columnIndices = useMemo(
    () => Array.from({ length: gridLayout.columns }, (_, index) => index),
    [gridLayout.columns]
  );
  const downloadTargetFile = useMemo(
    () => files.find((file) => file.id === downloadTargetId) ?? null,
    [files, downloadTargetId]
  );

  useEffect(() => {
    if (brush.mode !== 'clone') {
      clearCloneSource();
    }
  }, [brush.mode, clearCloneSource]);

  useEffect(() => {
    if (!ready || !activeFile) {
      return;
    }
    if (
      lastLoadedFileRef.current === activeFile.id &&
      activeFile.category === selectedCategory &&
      pendingSwitchRef.current !== activeFile.id
    ) {
      return;
    }
    lastLoadedFileRef.current = activeFile.id;
    if (activeFile.category !== selectedCategory) {
      setSelectedCategory(activeFile.category);
    }
    pendingRestoreRef.current = {
      fileId: activeFile.id,
      tiles: activeFile.tiles,
      rows: activeFile.grid.rows,
      columns: activeFile.grid.columns,
      preferredTileSize: activeFile.preferredTileSize,
      category: activeFile.category,
    };
    setHydrating(true);
    if (pendingSwitchRef.current === activeFile.id) {
      pendingSwitchRef.current = null;
    }
  }, [activeFile, ready, selectedCategory, setHydrating]);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || activeFileId !== pending.fileId) {
      return;
    }
    if (pending.category !== selectedCategory) {
      return;
    }
    const gridMatches =
      pending.rows === gridLayout.rows && pending.columns === gridLayout.columns;
    const allowFallback = pending.rows === 0 || pending.columns === 0;
    if (gridLayout.tileSize > 0 && (gridMatches || allowFallback || pending.tiles.length > 0)) {
      loadTiles(pending.tiles);
      pendingRestoreRef.current = null;
      setHydrating(false);
    }
  }, [
    activeFileId,
    selectedCategory,
    gridLayout.tileSize,
    gridLayout.columns,
    gridLayout.rows,
    loadTiles,
    setHydrating,
  ]);

  useEffect(() => {
    if (!ready || !activeFileId) {
      return;
    }
    const pending = pendingRestoreRef.current;
    if (isHydratingFile || (pending && pending.fileId === activeFileId)) {
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const thumbnailUri = await renderTileCanvasToDataUrl({
          tiles,
          gridLayout,
          tileSources,
          gridGap: GRID_GAP,
          blankSource: BLANK_TILE,
          errorSource: ERROR_TILE,
          maxDimension: 192,
        });
        upsertActiveFile({
          tiles,
          gridLayout,
          category: selectedCategory,
          preferredTileSize: fileTileSize,
          thumbnailUri,
        });
      })();
    }, 150);
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    tiles,
    gridLayout,
    selectedCategory,
    fileTileSize,
    ready,
    activeFileId,
    upsertActiveFile,
    isHydratingFile,
  ]);

  const getRelativePoint = (event: any) => {
    if (isWeb) {
      const nativeEvent = event?.nativeEvent ?? event;
      const target = event?.currentTarget;
      if (target?.getBoundingClientRect) {
        const rect = target.getBoundingClientRect();
        const clientX = nativeEvent?.clientX ?? nativeEvent?.pageX ?? event?.clientX;
        const clientY = nativeEvent?.clientY ?? nativeEvent?.pageY ?? event?.clientY;
        if (typeof clientX === 'number' && typeof clientY === 'number') {
          return { x: clientX - rect.left, y: clientY - rect.top };
        }
      }
      return null;
    }

    const nativeEvent = event?.nativeEvent;
    if (!nativeEvent) {
      return null;
    }
    if (
      typeof nativeEvent.pageX === 'number' &&
      typeof nativeEvent.pageY === 'number'
    ) {
      const offset = gridOffsetRef.current;
      return {
        x: nativeEvent.pageX - offset.x,
        y: nativeEvent.pageY - offset.y,
      };
    }
    if (
      typeof nativeEvent.locationX === 'number' &&
      typeof nativeEvent.locationY === 'number'
    ) {
      return { x: nativeEvent.locationX, y: nativeEvent.locationY };
    }
    return null;
  };

  const getCellIndexForPoint = (x: number, y: number) => {
    if (gridLayout.columns === 0 || gridLayout.rows === 0) {
      return null;
    }
    const tileStride = gridLayout.tileSize + GRID_GAP;
    const col = Math.floor(x / (tileStride || 1));
    const row = Math.floor(y / (tileStride || 1));
    if (col < 0 || row < 0 || col >= gridLayout.columns || row >= gridLayout.rows) {
      return null;
    }
    return row * gridLayout.columns + col;
  };

  const paintCellIndex = (cellIndex: number) => {
    if (lastPaintedRef.current === cellIndex) {
      return;
    }
    lastPaintedRef.current = cellIndex;
    handlePress(cellIndex);
  };

  const handlePaintAt = (x: number, y: number) => {
    const cellIndex = getCellIndexForPoint(x, y);
    if (cellIndex === null) {
      return;
    }
    paintCellIndex(cellIndex);
  };

  const persistActiveFileNow = async () => {
    if (!ready || !activeFileId) {
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const thumbnailUri = await renderTileCanvasToDataUrl({
      tiles,
      gridLayout,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: BLANK_TILE,
      errorSource: ERROR_TILE,
      maxDimension: 192,
    });
    upsertActiveFile({
      tiles,
      gridLayout,
      category: selectedCategory,
      preferredTileSize: fileTileSize,
      thumbnailUri,
    });
  };

  useEffect(() => {
    if (!downloadTargetFile) {
      return;
    }
    if (Platform.OS === 'web') {
      return;
    }
    if (downloadTargetFile.grid.rows <= 0 || downloadTargetFile.grid.columns <= 0) {
      setDownloadTargetId(null);
      return;
    }
    setDownloadLoadedCount(0);
    const sources = TILE_MANIFEST[downloadTargetFile.category] ?? [];
    const total = downloadTargetFile.grid.rows * downloadTargetFile.grid.columns;
    const normalized = normalizeTiles(downloadTargetFile.tiles, total, sources.length);
    const expected = normalized.filter(
      (tile) => tile && tile.imageIndex >= 0 && sources[tile.imageIndex]?.source
    ).length;
    downloadExpectedRef.current = expected;
    setDownloadRenderKey((prev) => prev + 1);
    setShowDownloadOverlay(true);
  }, [downloadTargetFile]);

  useEffect(() => {
    if (!downloadTargetFile || isDownloading || Platform.OS === 'web') {
      return;
    }
    const captureAndShare = async () => {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Download unavailable', 'Sharing is not available on this device.');
        return false;
      }
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const uri = await viewShotRef.current?.capture?.({
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });
        if (uri) {
          const safeName = downloadTargetFile.name.replace(/[^\w-]+/g, '_');
          const target = `${FileSystem.cacheDirectory}${safeName}.png`;
          await FileSystem.copyAsync({ from: uri, to: target });
          await Sharing.shareAsync(target);
          return true;
        }
      }
      Alert.alert('Download failed', 'Unable to capture the canvas image.');
      return false;
    };

    const expected = downloadExpectedRef.current;
    const loaded = downloadLoadedCount;
    const trigger = expected === 0 || loaded >= expected;
    if (!trigger) {
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
      }
      downloadTimeoutRef.current = setTimeout(() => {
        setIsDownloading(true);
        void (async () => {
          try {
            await captureAndShare();
          } finally {
            setIsDownloading(false);
            setDownloadTargetId(null);
            setShowDownloadOverlay(false);
          }
        })();
      }, 1500);
      return () => {
        if (downloadTimeoutRef.current) {
          clearTimeout(downloadTimeoutRef.current);
          downloadTimeoutRef.current = null;
        }
      };
    }
    setIsDownloading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await captureAndShare();
        } finally {
          setIsDownloading(false);
          setDownloadTargetId(null);
          setShowDownloadOverlay(false);
        }
      })();
    }, 200);
    return () => {
      clearTimeout(timer);
      if (downloadTimeoutRef.current) {
        clearTimeout(downloadTimeoutRef.current);
        downloadTimeoutRef.current = null;
      }
    };
  }, [downloadTargetFile, isDownloading, downloadRenderKey, downloadLoadedCount]);

  const openFileInModifyView = async (fileId: string) => {
    await persistActiveFileNow();
    const file = files.find((entry) => entry.id === fileId);
    if (!file) {
      return;
    }
    lastLoadedFileRef.current = null;
    pendingSwitchRef.current = file.id;
    setHydrating(true);
    setActive(file.id);
    setViewMode('modify');
  };

  if (viewMode === 'file') {
    const fileCardWidth = isWeb
      ? 120
      : Math.floor(
          (contentWidth -
            FILE_GRID_SIDE_PADDING * 2 -
            FILE_GRID_GAP * (FILE_GRID_COLUMNS_MOBILE - 1)) /
            FILE_GRID_COLUMNS_MOBILE
        );
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
          <View
            pointerEvents="none"
            style={[styles.statusBarBackground, { height: insets.top }]}
          />
        )}
        <ThemedView style={styles.fileHeader}>
          <ThemedText type="title" style={styles.fileTitle}>
            File
          </ThemedText>
          <ThemedView style={styles.fileHeaderActions}>
            <ToolbarButton
              label="Create new tile canvas file"
              icon="plus"
              color="#fff"
              onPress={() => {
                setShowNewFileModal(true);
              }}
            />
            <ToolbarButton
              label="Open settings"
              icon="cog"
              color="#fff"
              onPress={() => setShowSettingsOverlay(true)}
            />
          </ThemedView>
        </ThemedView>
        <ScrollView
          style={styles.fileScroll}
          contentContainerStyle={styles.fileGrid}
          showsVerticalScrollIndicator
        >
          {files.map((file) => {
            const sources = TILE_MANIFEST[file.category] ?? [];
            const thumbAspect =
              file.grid.columns > 0 && file.grid.rows > 0
                ? file.grid.columns / file.grid.rows
                : 1;
            return (
              <Pressable
                key={file.id}
                style={[styles.fileCard, { width: fileCardWidth }]}
                onPress={() => {
                  void openFileInModifyView(file.id);
                }}
                onLongPress={() => setFileMenuTargetId(file.id)}
                delayLongPress={320}
                accessibilityRole="button"
                accessibilityLabel={`Open ${file.name}`}
              >
                <ThemedView
                  style={[
                    styles.fileThumb,
                    { width: fileCardWidth, aspectRatio: thumbAspect },
                  ]}
                >
                  {file.thumbnailUri ? (
                    <Image
                      source={{ uri: file.thumbnailUri }}
                      style={styles.fileThumbImage}
                      resizeMode="cover"
                      fadeDuration={0}
                    />
                  ) : (
                    <ThemedView style={styles.fileThumbGrid}>
                      {Array.from({ length: file.grid.rows }, (_, rowIndex) => (
                        <ThemedView
                          key={`row-${file.id}-${rowIndex}`}
                          style={styles.fileThumbRow}
                        >
                          {Array.from({ length: file.grid.columns }, (_, colIndex) => {
                            const index = rowIndex * file.grid.columns + colIndex;
                            const tile = file.tiles[index];
                            const source =
                              tile && tile.imageIndex >= 0
                                ? sources[tile.imageIndex]?.source
                                : null;
                            return (
                              <ThemedView
                                key={`cell-${file.id}-${index}`}
                                style={styles.fileThumbCell}
                              >
                                {source && (
                                  <Image
                                    source={source}
                                    style={[
                                      styles.fileThumbImage,
                                      {
                                        transform: [
                                          { scaleX: tile?.mirrorX ? -1 : 1 },
                                          { scaleY: tile?.mirrorY ? -1 : 1 },
                                          { rotate: `${tile?.rotation ?? 0}deg` },
                                        ],
                                      },
                                    ]}
                                    resizeMode="cover"
                                    fadeDuration={0}
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
        {downloadTargetFile && Platform.OS !== 'web' && showDownloadOverlay && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <View style={styles.overlayBackdrop} />
          <ThemedView style={styles.downloadPanel}>
              <ViewShot
                ref={viewShotRef}
                collapsable={false}
                key={`download-shot-${downloadRenderKey}`}
                options={{ format: 'png', quality: 1 }}
                style={[
                  styles.downloadPreview,
                  {
                    width:
                      downloadTargetFile.grid.columns *
                      downloadTargetFile.preferredTileSize,
                    height:
                      downloadTargetFile.grid.rows * downloadTargetFile.preferredTileSize,
                  },
                ]}
              >
                {(() => {
                  const sources = TILE_MANIFEST[downloadTargetFile.category] ?? [];
                  const total =
                    downloadTargetFile.grid.rows * downloadTargetFile.grid.columns;
                  const tiles = normalizeTiles(
                    downloadTargetFile.tiles,
                    total,
                    sources.length
                  );
                  return Array.from(
                    { length: downloadTargetFile.grid.rows },
                    (_, rowIndex) => (
                      <View key={`capture-row-${rowIndex}`} style={styles.captureRow}>
                        {Array.from(
                          { length: downloadTargetFile.grid.columns },
                          (_, colIndex) => {
                            const index =
                              rowIndex * downloadTargetFile.grid.columns + colIndex;
                            const tile = tiles[index];
                            const source =
                              tile && tile.imageIndex >= 0
                                ? sources[tile.imageIndex]?.source
                                : null;
                            return (
                              <View
                                key={`capture-cell-${index}`}
                                style={[
                                  styles.captureCell,
                                  {
                                    width: downloadTargetFile.preferredTileSize,
                                    height: downloadTargetFile.preferredTileSize,
                                  },
                                ]}
                              >
                                {source && (
                                  <Image
                                    source={source}
                                    style={[
                                      styles.captureImage,
                                      {
                                        transform: [
                                          { scaleX: tile?.mirrorX ? -1 : 1 },
                                          { scaleY: tile?.mirrorY ? -1 : 1 },
                                          { rotate: `${tile?.rotation ?? 0}deg` },
                                        ],
                                      },
                                    ]}
                                    resizeMode="cover"
                                    onLoad={() => {
                                      setDownloadLoadedCount((count) => count + 1);
                                    }}
                                  />
                                )}
                              </View>
                            );
                          }
                        )}
                      </View>
                    )
                  );
                })()}
              </ViewShot>
              <ThemedView style={styles.downloadActions}>
                <Pressable
                  style={styles.downloadActionButton}
                  onPress={() => {
                    setShowDownloadOverlay(false);
                    setDownloadTargetId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel download"
                >
                  <ThemedText type="defaultSemiBold" style={styles.downloadCancelText}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.downloadActionButton, styles.downloadPrimaryButton]}
                  onPress={() => {
                    setIsDownloading(true);
                    void (async () => {
                      try {
                        const canShare = await Sharing.isAvailableAsync();
                        if (!canShare) {
                          Alert.alert(
                            'Download unavailable',
                            'Sharing is not available on this device.'
                          );
                          return;
                        }
                        const uri = await viewShotRef.current?.capture?.({
                          format: 'png',
                          quality: 1,
                          result: 'tmpfile',
                        });
                        if (!uri) {
                          Alert.alert('Download failed', 'Unable to capture the canvas image.');
                          return;
                        }
                        const safeName = downloadTargetFile.name.replace(/[^\w-]+/g, '_');
                        const target = `${FileSystem.cacheDirectory}${safeName}.png`;
                        await FileSystem.copyAsync({ from: uri, to: target });
                        await Sharing.shareAsync(target);
                      } finally {
                        setIsDownloading(false);
                        setDownloadTargetId(null);
                        setShowDownloadOverlay(false);
                      }
                    })();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Download now"
                >
                  <ThemedText
                    type="defaultSemiBold"
                    style={[styles.downloadActionText, styles.downloadPrimaryText]}
                  >
                    Download
                  </ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          </ThemedView>
        )}
        {fileMenuTargetId && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setFileMenuTargetId(null)}
              accessibilityRole="button"
              accessibilityLabel="Close file options"
            />
            <ThemedView style={styles.fileMenuPanel}>
              <Pressable
                style={styles.fileMenuButton}
                onPress={() => {
                  const file = files.find((entry) => entry.id === fileMenuTargetId);
                  if (file) {
                    if (Platform.OS === 'web') {
                      const sources = TILE_MANIFEST[file.category] ?? [];
                      void downloadFile(file, sources);
                    } else {
                      setDownloadTargetId(file.id);
                    }
                  }
                  setFileMenuTargetId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Download file"
              >
                <ThemedText type="defaultSemiBold">Download</ThemedText>
              </Pressable>
              <Pressable
                style={styles.fileMenuButton}
                onPress={() => {
                  duplicateFile(fileMenuTargetId);
                  setFileMenuTargetId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Duplicate file"
              >
                <ThemedText type="defaultSemiBold">Duplicate</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.fileMenuButton, styles.fileMenuButtonLast]}
                onPress={() => {
                  deleteFile(fileMenuTargetId);
                  setFileMenuTargetId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Delete file"
              >
                <ThemedText type="defaultSemiBold" style={styles.fileMenuDeleteText}>
                  Delete
                </ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}
        {showNewFileModal && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowNewFileModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Close new file options"
            />
            <ThemedView style={styles.newFilePanel}>
              <ThemedText type="title">New File Tile Size</ThemedText>
              <ThemedView style={styles.newFileGrid}>
                {NEW_FILE_TILE_SIZES.map((size) => (
                  <Pressable
                    key={`new-file-size-${size}`}
                    onPress={() => {
                      createFile(selectedCategory, size);
                      lastLoadedFileRef.current = null;
                      setShowNewFileModal(false);
                      setViewMode('modify');
                    }}
                    style={styles.newFileButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Create file with tile size ${size}`}
                  >
                    <ThemedText type="defaultSemiBold">{size}</ThemedText>
                  </Pressable>
                ))}
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
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">AllowEdgeConections</ThemedText>
                <Switch
                  value={settings.allowEdgeConnections}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, allowEdgeConnections: value }))
                  }
                  accessibilityLabel="Toggle edge connections"
                />
              </ThemedView>
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">Show Debug</ThemedText>
                <Switch
                  value={settings.showDebug}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, showDebug: value }))
                  }
                  accessibilityLabel="Toggle debug overlay"
                />
              </ThemedView>
            </ThemedView>
          </ThemedView>
        )}
      </ThemedView>
    );
  }

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
        <View
          pointerEvents="none"
          style={[styles.statusBarBackground, { height: insets.top }]}
        />
      )}
        <ThemedView
          style={[
            styles.contentFrame,
            { width: contentWidth, height: contentHeight },
          ]}
        >
        <ThemedView style={styles.titleContainer}>
          <ThemedView style={styles.headerRow}>
            <NavButton
              label="< Modify"
              onPress={() => {
                void (async () => {
                  await persistActiveFileNow();
                  setViewMode('file');
                })();
              }}
            />
            <ThemedView style={styles.controls}>
            <ToolbarButton
              label="Tile Set"
              icon="grid"
              onPress={() => setShowTileSetOverlay(true)}
            />
            <ToolbarButton label="Reset" icon="refresh" onPress={resetTiles} />
            <ToolbarButton
              label="Flood Complete"
              icon="format-color-fill"
              onPress={floodComplete}
            />
            <ToolbarButton
              label="Mirror Horizontal"
              icon="flip-horizontal"
              active={settings.mirrorHorizontal}
              onPress={() =>
                setSettings((prev) => ({
                  ...prev,
                  mirrorHorizontal: !prev.mirrorHorizontal,
                }))
              }
            />
            <ToolbarButton
              label="Mirror Vertical"
              icon="flip-vertical"
              active={settings.mirrorVertical}
              onPress={() =>
                setSettings((prev) => ({
                  ...prev,
                  mirrorVertical: !prev.mirrorVertical,
                }))
              }
            />
            </ThemedView>
          </ThemedView>
        </ThemedView>
        <ThemedView
          ref={gridRef}
          style={[
            styles.grid,
            {
              height: gridHeight,
              width:
                gridLayout.columns * gridLayout.tileSize +
                GRID_GAP * Math.max(0, gridLayout.columns - 1),
            },
          ]}
          accessibilityRole="grid"
          onLayout={() => {
            gridRef.current?.measureInWindow((x: number, y: number) => {
              gridOffsetRef.current = { x, y };
            });
          }}
          {...(!isWeb
            ? {
                onStartShouldSetResponderCapture: () => true,
                onMoveShouldSetResponderCapture: () => true,
                onResponderGrant: (event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (longPressTimeoutRef.current) {
                      clearTimeout(longPressTimeoutRef.current);
                    }
                    longPressTriggeredRef.current = false;
                    longPressTimeoutRef.current = setTimeout(() => {
                      longPressTriggeredRef.current = true;
                      if (brush.mode === 'clone') {
                        setCloneSource(cellIndex);
                        lastPaintedRef.current = null;
                      }
                    }, 420);
                    if (brush.mode !== 'clone') {
                      paintCellIndex(cellIndex);
                    } else if (cloneSourceIndex === null) {
                      setCloneSource(cellIndex);
                      lastPaintedRef.current = null;
                    }
                  }
                },
                onResponderMove: (event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    if (longPressTimeoutRef.current) {
                      clearTimeout(longPressTimeoutRef.current);
                      longPressTimeoutRef.current = null;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                },
                onResponderRelease: () => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  if (brush.mode === 'clone' && !longPressTriggeredRef.current) {
                    lastPaintedRef.current = null;
                  }
                  lastPaintedRef.current = null;
                },
                onResponderTerminate: () => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  longPressTriggeredRef.current = false;
                  lastPaintedRef.current = null;
                },
              }
            : {
                onMouseDown: (event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (brush.mode === 'clone' && cloneSourceIndex === null) {
                      setCloneSource(cellIndex);
                      lastPaintedRef.current = null;
                      return;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                },
                onMouseMove: (event: any) => {
                  if (event.buttons === 1) {
                    const point = getRelativePoint(event);
                    if (point) {
                      handlePaintAt(point.x, point.y);
                    }
                  }
                },
                onMouseLeave: () => {
                  lastPaintedRef.current = null;
                },
                onMouseUp: () => {
                  lastPaintedRef.current = null;
                },
              })}
        >
          {(settings.mirrorHorizontal || settings.mirrorVertical) && (
            <ThemedView pointerEvents="none" style={styles.mirrorLines}>
              {settings.mirrorVertical && (
                <ThemedView
                  style={[
                    styles.mirrorLineHorizontal,
                    { top: gridLayout.tileSize * (gridLayout.rows / 2) },
                  ]}
                />
              )}
              {settings.mirrorHorizontal && (
                <ThemedView
                  style={[
                    styles.mirrorLineVertical,
                    { left: gridLayout.tileSize * (gridLayout.columns / 2) },
                  ]}
                />
              )}
            </ThemedView>
          )}
          {rowIndices.map((rowIndex) => (
            <ThemedView key={`row-${rowIndex}`} style={styles.row}>
              {columnIndices.map((columnIndex) => {
                const cellIndex = rowIndex * gridLayout.columns + columnIndex;
                const item = tiles[cellIndex];
                return (
                  <TileCell
                    key={`cell-${cellIndex}`}
                    cellIndex={cellIndex}
                    tileSize={gridLayout.tileSize}
                    tile={item}
                    tileSources={tileSources}
                    showDebug={settings.showDebug}
                    isCloneSource={brush.mode === 'clone' && cloneSourceIndex === cellIndex}
                    isCloneSample={brush.mode === 'clone' && cloneSampleIndex === cellIndex}
                    isCloneTargetOrigin={
                      brush.mode === 'clone' && cloneAnchorIndex === cellIndex
                    }
                    isCloneCursor={
                      brush.mode === 'clone' && cloneCursorIndex === cellIndex
                    }
                  />
                );
              })}
            </ThemedView>
          ))}
        </ThemedView>
        <TileBrushPanel
          tileSources={tileSources}
          selected={brush}
          onSelect={(next) => {
            if (next.mode === 'clone') {
              clearCloneSource();
            }
            if (next.mode === 'fixed') {
              const rotation = paletteRotations[next.index] ?? next.rotation ?? 0;
              const mirrorX = paletteMirrors[next.index] ?? next.mirrorX ?? false;
              setBrush({ mode: 'fixed', index: next.index, rotation, mirrorX });
            } else {
              setBrush(next);
            }
          }}
          onRotate={(index) =>
            setPaletteRotations((prev) => {
              const nextRotation = ((prev[index] ?? 0) + 90) % 360;
              if (brush.mode === 'fixed' && brush.index === index) {
                setBrush({
                  mode: 'fixed',
                  index,
                  rotation: nextRotation,
                  mirrorX: brush.mirrorX,
                });
              }
              return {
                ...prev,
                [index]: nextRotation,
              };
            })
          }
          onMirror={(index) =>
            setPaletteMirrors((prev) => {
              const nextMirror = !(prev[index] ?? false);
              if (brush.mode === 'fixed' && brush.index === index) {
                setBrush({
                  mode: 'fixed',
                  index,
                  rotation: brush.rotation,
                  mirrorX: nextMirror,
                });
              }
              return {
                ...prev,
                [index]: nextMirror,
              };
            })
          }
          getRotation={(index) => paletteRotations[index] ?? 0}
          getMirror={(index) => paletteMirrors[index] ?? false}
          height={brushPanelHeight}
          itemSize={brushItemSize}
          rowGap={BRUSH_PANEL_ROW_GAP}
        />
        {showTileSetOverlay && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowTileSetOverlay(false)}
              accessibilityRole="button"
              accessibilityLabel="Close tile set chooser"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">Choose Tile Set</ThemedText>
              <ThemedView style={styles.overlayList}>
                {TILE_CATEGORIES.map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => {
                      setSelectedCategory(category);
                      if (activeFileId) {
                        upsertActiveFile({
                          tiles,
                          gridLayout,
                          category,
                          preferredTileSize: fileTileSize,
                        });
                      }
                      setShowTileSetOverlay(false);
                    }}
                    style={[
                      styles.overlayItem,
                      category === selectedCategory && styles.overlayItemSelected,
                    ]}
                  >
                    <ThemedText type="defaultSemiBold">{category}</ThemedText>
                  </Pressable>
                ))}
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
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">AllowEdgeConections</ThemedText>
                <Switch
                  value={settings.allowEdgeConnections}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, allowEdgeConnections: value }))
                  }
                  accessibilityLabel="Toggle edge connections"
                />
              </ThemedView>
              <Pressable
                onPress={handleDownload}
                style={styles.resetButton}
                accessibilityRole="button"
                accessibilityLabel="Download tile canvas"
              >
                <ThemedText type="defaultSemiBold">Download PNG</ThemedText>
              </Pressable>
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">Show Debug</ThemedText>
                <Switch
                  value={settings.showDebug}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, showDebug: value }))
                  }
                  accessibilityLabel="Toggle debug overlay"
                />
              </ThemedView>
            </ThemedView>
          </ThemedView>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: HEADER_HEIGHT,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 6,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    flex: 1,
    overflow: 'visible',
  },
  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  input: {
    minWidth: 48,
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 4,
    color: '#111',
  },
  resetButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    position: 'relative',
  },
  toolbarButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: 'transparent',
  },
  navButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  navButtonText: {
    color: '#2a2a2a',
    fontSize: 14,
  },
  tooltip: {
    position: 'absolute',
    bottom: -22,
    right: 0,
    backgroundColor: '#111',
    color: '#fff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    zIndex: 50,
    pointerEvents: 'none',
    whiteSpace: 'nowrap' as never,
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
  screen: {
    flex: 1,
    backgroundColor: '#3F3F3F',
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
  fileHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  fileTitle: {
    color: '#fff',
  },
  fileAddButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
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
  fileMenuPanel: {
    width: 220,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  fileMenuButton: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  fileMenuButtonLast: {
    borderBottomWidth: 0,
  },
  fileMenuDeleteText: {
    color: '#dc2626',
  },
  downloadPanel: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 12,
    gap: 12,
    alignItems: 'center',
  },
  downloadPreview: {
    backgroundColor: '#000',
  },
  downloadActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  downloadActionButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'transparent',
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadPrimaryButton: {
    backgroundColor: 'transparent',
  },
  downloadActionText: {
    color: '#fff',
  },
  downloadCancelText: {
    color: '#9ca3af',
  },
  downloadPrimaryText: {
    color: '#fff',
    fontWeight: '400',
  },
  captureRow: {
    flexDirection: 'row',
  },
  captureCell: {
    width: '100%',
    height: '100%',
  },
  captureImage: {
    width: '100%',
    height: '100%',
  },
  newFilePanel: {
    width: 260,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#fff',
    padding: 16,
    gap: 12,
  },
  newFileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  newFileButton: {
    width: '30%',
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentFrame: {
    alignSelf: 'center',
    position: 'relative',
    backgroundColor: '#3F3F3F',
  },
  grid: {
    alignContent: 'flex-start',
    gap: GRID_GAP,
    backgroundColor: '#3F3F3F',
  },
  row: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  tile: {
    backgroundColor: '#000',
    position: 'relative',
    borderRadius: 0,
  },
  cloneSource: {
    borderColor: '#3b82f6',
    borderWidth: 2,
  },
  cloneSample: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  cloneTargetOrigin: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  cloneCursor: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  tileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  mirrorLines: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  mirrorLineHorizontal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#3b82f6',
  },
  mirrorLineVertical: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#3b82f6',
  },
});
