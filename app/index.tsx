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
import Slider from '@react-native-community/slider';
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
import { TileAsset, prefetchTileAssets } from '@/components/tile-asset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTileFiles } from '@/hooks/use-tile-files';
import {
  exportTileCanvasAsSvg,
  renderTileCanvasToDataUrl,
  renderTileCanvasToSvg,
} from '@/utils/tile-export';
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
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');
const PREVIEW_DIR = `${FileSystem.cacheDirectory ?? ''}tile-previews/`;
const THUMB_SIZE = 256;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const hexToRgb = (value: string) => {
  const safeValue = typeof value === 'string' ? value : '#ffffff';
  const normalized = safeValue.replace('#', '');
  if (normalized.length !== 6) {
    return { r: 255, g: 255, b: 255 };
  }
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 255, g: 255, b: 255 };
  }
  return { r, g, b };
};
const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
const isTransparentPreview = (uri: string | null | undefined) => {
  if (!uri) {
    return false;
  }
  if (uri.startsWith('data:image/png')) {
    return true;
  }
  return uri.toLowerCase().endsWith('.png');
};
const rgbToHsv = (r: number, g: number, b: number) => {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      hue = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
      hue = (bNorm - rNorm) / delta + 2;
    } else {
      hue = (rNorm - gNorm) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }
  const saturation = max === 0 ? 0 : delta / max;
  const value = max;
  return {
    h: hue,
    s: saturation * 100,
    v: value * 100,
  };
};
const hsvToRgb = (h: number, s: number, v: number) => {
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;
  const c = val * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = val - c;
  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h >= 0 && h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h >= 60 && h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h >= 120 && h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h >= 180 && h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h >= 240 && h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }
  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
};

type HsvColorPickerProps = {
  label: string;
  color: string;
  onChange: (nextColor: string) => void;
};

function HsvColorPicker({ label, color, onChange }: HsvColorPickerProps) {
  const { r, g, b } = useMemo(() => hexToRgb(color), [color]);
  const hsv = useMemo(() => rgbToHsv(r, g, b), [r, g, b]);
  const [draftHsv, setDraftHsv] = useState(hsv);
  const draftRef = useRef(draftHsv);
  useEffect(() => {
    setDraftHsv(hsv);
    draftRef.current = hsv;
  }, [hsv.h, hsv.s, hsv.v]);
  const updateColor = useCallback(
    (nextH: number, nextS: number, nextV: number) => {
      const { r: nextR, g: nextG, b: nextB } = hsvToRgb(nextH, nextS, nextV);
      onChange(rgbToHex(nextR, nextG, nextB));
    },
    [onChange]
  );
  const draftColor = useMemo(() => {
    const { r: nextR, g: nextG, b: nextB } = hsvToRgb(
      draftHsv.h,
      draftHsv.s,
      draftHsv.v
    );
    return rgbToHex(nextR, nextG, nextB);
  }, [draftHsv.h, draftHsv.s, draftHsv.v]);

  return (
    <ThemedView style={styles.sectionGroup}>
      <ThemedText type="defaultSemiBold">{label}</ThemedText>
      <ThemedView style={styles.colorPickerWrap}>
        <ThemedView style={[styles.colorPreview, { backgroundColor: draftColor }]} />
        <ThemedText type="defaultSemiBold">{draftColor.toUpperCase()}</ThemedText>
        <ThemedView style={styles.colorRow}>
          <ThemedText type="defaultSemiBold">H</ThemedText>
          <Slider
            minimumValue={0}
            maximumValue={360}
            step={1}
            value={draftHsv.h}
            onValueChange={(value) => {
              setDraftHsv((prev) => {
                const next = { ...prev, h: value };
                draftRef.current = next;
                return next;
              });
            }}
            onSlidingComplete={(value) => {
              const current = draftRef.current;
              updateColor(value, current.s, current.v);
            }}
            minimumTrackTintColor="#ef4444"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#ef4444"
            style={styles.colorSlider}
          />
          <ThemedText type="defaultSemiBold">{Math.round(draftHsv.h)}</ThemedText>
        </ThemedView>
        <ThemedView style={styles.colorRow}>
          <ThemedText type="defaultSemiBold">S</ThemedText>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={draftHsv.s}
            onValueChange={(value) => {
              setDraftHsv((prev) => {
                const next = { ...prev, s: value };
                draftRef.current = next;
                return next;
              });
            }}
            onSlidingComplete={(value) => {
              const current = draftRef.current;
              updateColor(current.h, value, current.v);
            }}
            minimumTrackTintColor="#22c55e"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#22c55e"
            style={styles.colorSlider}
          />
          <ThemedText type="defaultSemiBold">{Math.round(draftHsv.s)}</ThemedText>
        </ThemedView>
        <ThemedView style={styles.colorRow}>
          <ThemedText type="defaultSemiBold">V</ThemedText>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={draftHsv.v}
            onValueChange={(value) => {
              setDraftHsv((prev) => {
                const next = { ...prev, v: value };
                draftRef.current = next;
                return next;
              });
            }}
            onSlidingComplete={(value) => {
              const current = draftRef.current;
              updateColor(current.h, current.s, value);
            }}
            minimumTrackTintColor="#3b82f6"
            maximumTrackTintColor="#e5e7eb"
            thumbTintColor="#3b82f6"
            style={styles.colorSlider}
          />
          <ThemedText type="defaultSemiBold">{Math.round(draftHsv.v)}</ThemedText>
        </ThemedView>
      </ThemedView>
    </ThemedView>
  );
}

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
  strokeColor: string;
  strokeWidth: number;
  isCloneSource: boolean;
  isCloneSample: boolean;
  isCloneTargetOrigin: boolean;
  isCloneCursor: boolean;
  showOverlays: boolean;
};

type GridBackgroundProps = {
  rows: number;
  columns: number;
  tileSize: number;
  width: number;
  height: number;
  backgroundColor: string;
  lineColor: string;
  lineWidth: number;
};

function GridBackground({
  rows,
  columns,
  tileSize,
  width,
  height,
  backgroundColor,
  lineColor,
  lineWidth,
}: GridBackgroundProps) {
  if (rows <= 0 || columns <= 0 || tileSize <= 0) {
    return null;
  }
  const verticalLines = Array.from({ length: Math.max(0, columns - 1) }, (_, i) => i + 1);
  const horizontalLines = Array.from({ length: Math.max(0, rows - 1) }, (_, i) => i + 1);
  const strokeWidth = Math.max(0, lineWidth);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.gridBackground,
        { width, height, backgroundColor },
      ]}
    >
      {strokeWidth > 0 &&
        verticalLines.map((col) => (
          <View
            key={`grid-v-${col}`}
            style={[
              styles.gridLineVertical,
              {
                left: col * tileSize - strokeWidth / 2,
                width: strokeWidth,
                height,
                backgroundColor: lineColor,
              },
            ]}
          />
        ))}
      {strokeWidth > 0 &&
        horizontalLines.map((row) => (
          <View
            key={`grid-h-${row}`}
            style={[
              styles.gridLineHorizontal,
              {
                top: row * tileSize - strokeWidth / 2,
                height: strokeWidth,
                width,
                backgroundColor: lineColor,
              },
            ]}
          />
        ))}
    </View>
  );
}

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    strokeColor,
    strokeWidth,
    isCloneSource,
    isCloneSample,
    isCloneTargetOrigin,
    isCloneCursor,
    showOverlays,
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
          : null
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
        {source && (
          <TileAsset
            source={source}
            name={tileName}
            strokeColor={tile.imageIndex >= 0 ? strokeColor : '#ffffff'}
            strokeWidth={tile.imageIndex >= 0 ? strokeWidth : 4}
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
          />
        )}
        {showOverlays && isCloneTargetOrigin && (
          <View pointerEvents="none" style={styles.cloneTargetOrigin} />
        )}
        {showOverlays && isCloneCursor && (
          <View pointerEvents="none" style={styles.cloneCursor} />
        )}
        {showOverlays && isCloneSample && (
          <View pointerEvents="none" style={styles.cloneSample} />
        )}
        {showOverlays && showDebug && <TileDebugOverlay connections={connections} />}
      </View>
    );
  },
  (prev, next) =>
    prev.tile === next.tile &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.strokeColor === next.strokeColor &&
    prev.strokeWidth === next.strokeWidth &&
    prev.showOverlays === next.showOverlays &&
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
  const gridCaptureRef = useRef<ViewShot>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const gridTouchRef = useRef<View>(null);
  const { settings, setSettings } = usePersistedSettings();
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => DEFAULT_CATEGORY
  );
  const [showFileSettingsOverlay, setShowFileSettingsOverlay] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [fileMenuTargetId, setFileMenuTargetId] = useState<string | null>(null);
  const [downloadTargetId, setDownloadTargetId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadOverlay, setShowDownloadOverlay] = useState(false);
  const [downloadRenderKey, setDownloadRenderKey] = useState(0);
  const [downloadLoadedCount, setDownloadLoadedCount] = useState(0);
  const [includeDownloadBackground, setIncludeDownloadBackground] = useState(true);
  const [isHydratingFile, setIsHydratingFile] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isPrefetchingTiles, setIsPrefetchingTiles] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [suspendTiles, setSuspendTiles] = useState(false);
  const [loadRequestId, setLoadRequestId] = useState(0);
  const [loadToken, setLoadToken] = useState(0);
  const [loadedToken, setLoadedToken] = useState(0);
  const [loadPreviewUri, setLoadPreviewUri] = useState<string | null>(null);
  const [isCapturingPreview, setIsCapturingPreview] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearPreviewUri, setClearPreviewUri] = useState<string | null>(null);
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
  // tileSources is set after we resolve the active file/category.
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

  const activeCategory =
    activeFile && TILE_MANIFEST[activeFile.category]
      ? activeFile.category
      : selectedCategory;
  const tileSources = TILE_MANIFEST[activeCategory] ?? [];

  const fileTileSize = activeFile?.preferredTileSize ?? settings.preferredTileSize;
  const activeLineWidth = activeFile?.lineWidth ?? 10;
  const activeLineColor = activeFile?.lineColor ?? '#ffffff';
  const [lineWidthDraft, setLineWidthDraft] = useState(activeLineWidth);

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
  const displayTiles = tiles;
  const showOverlays = !isCapturingPreview;
  const gridWidth =
    gridLayout.columns * gridLayout.tileSize +
    GRID_GAP * Math.max(0, gridLayout.columns - 1);
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
  const loadTokenRef = useRef(0);
  const isHydratingFileRef = useRef(false);
  const viewShotRef = useRef<ViewShot>(null);
  const downloadExpectedRef = useRef(0);
  const pendingFloodCompleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressAutosaveRef = useRef(false);
  const clearSequenceRef = useRef(0);
  const pendingRestoreRef = useRef<{
    fileId: string;
    tiles: Tile[];
    rows: number;
    columns: number;
    preferredTileSize: number;
    category: TileCategory;
    token?: number;
    preview?: boolean;
  } | null>(null);
  const setHydrating = useCallback((value: boolean) => {
    isHydratingFileRef.current = value;
    setIsHydratingFile(value);
  }, []);
  const setGridNode = useCallback((node: any) => {
    gridRef.current = node;
    gridCaptureRef.current = node;
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
  const downloadPreviewUri = useMemo(() => {
    if (!downloadTargetFile) {
      return null;
    }
    return isTransparentPreview(downloadTargetFile.previewUri)
      ? downloadTargetFile.previewUri
      : null;
  }, [downloadTargetFile]);
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    setLineWidthDraft(activeLineWidth);
  }, [activeLineWidth]);

  useEffect(() => {
    if (brush.mode !== 'clone') {
      clearCloneSource();
    }
  }, [brush.mode, clearCloneSource]);

  useEffect(() => {
    if (activeFile?.category && TILE_MANIFEST[activeFile.category]) {
      if (activeFile.category !== selectedCategory) {
        setSelectedCategory(activeFile.category);
      }
    }
  }, [activeFile?.category, selectedCategory]);

  useEffect(() => {
    if (!ready || !activeFileId || viewMode !== 'modify') {
      return;
    }
    const file =
      filesRef.current.find((entry) => entry.id === activeFileId) ?? null;
    if (!file) {
      return;
    }
    const resolvedCategory = TILE_MANIFEST[file.category]
      ? file.category
      : DEFAULT_CATEGORY;
    if (resolvedCategory !== file.category) {
      upsertActiveFile({
        tiles: file.tiles,
        gridLayout: {
          rows: file.grid.rows,
          columns: file.grid.columns,
          tileSize: file.preferredTileSize,
        },
        category: resolvedCategory,
        preferredTileSize: file.preferredTileSize,
        lineWidth: file.lineWidth,
        lineColor: file.lineColor,
      });
    }
    if (resolvedCategory !== selectedCategory) {
      setSelectedCategory(resolvedCategory);
    }
    const nextToken = loadTokenRef.current + 1;
    loadTokenRef.current = nextToken;
    setLoadToken(nextToken);
    setLoadedToken(0);
    const previewUri = file.previewUri ?? file.thumbnailUri ?? null;
    setLoadPreviewUri(previewUri);
    setShowPreview(Boolean(previewUri));
    setShowGrid(false);
    setHydrating(true);
    setSuspendTiles(true);
    if (file.tiles.length === 0) {
      resetTiles();
    }
    pendingRestoreRef.current = {
      fileId: file.id,
      tiles: file.tiles,
      rows: file.grid.rows,
      columns: file.grid.columns,
      preferredTileSize: file.preferredTileSize,
      category: resolvedCategory,
      token: nextToken,
      preview: Boolean(previewUri),
    };
  }, [activeFileId, loadRequestId, ready, viewMode, selectedCategory]);

  useEffect(() => {
    if (viewMode !== 'modify') {
      return;
    }
    if (isHydratingFile || isPrefetchingTiles || loadedToken !== loadToken) {
      setShowGrid(false);
      return;
    }
    setShowGrid(true);
  }, [isHydratingFile, isPrefetchingTiles, loadedToken, loadToken, activeFileId, viewMode]);



  useEffect(() => {
    if (viewMode !== 'modify') {
      setShowPreview(false);
      return;
    }
    if (!loadPreviewUri) {
      setShowPreview(false);
      return;
    }
    if (
      isHydratingFile ||
      isPrefetchingTiles ||
      !showGrid ||
      loadedToken !== loadToken
    ) {
      setShowPreview(true);
      return;
    }
    let raf1: number | null = null;
    let raf2: number | null = null;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setShowPreview(false);
      });
    });
    return () => {
      if (raf1 !== null) {
        cancelAnimationFrame(raf1);
      }
      if (raf2 !== null) {
        cancelAnimationFrame(raf2);
      }
    };
  }, [
    viewMode,
    isHydratingFile,
    isPrefetchingTiles,
    showGrid,
    loadPreviewUri,
    loadedToken,
    loadToken,
  ]);

  useEffect(() => {
    if (viewMode !== 'modify' || !activeFile) {
      return;
    }
    let cancelled = false;
    setIsPrefetchingTiles(true);
    setShowGrid(false);
    setShowPreview(Boolean(loadPreviewUri));
    setSuspendTiles(true);
    const sources = [ERROR_TILE, ...tileSources.map((tile) => tile.source)];
    void (async () => {
      try {
        await prefetchTileAssets(sources);
      } finally {
        if (!cancelled) {
          setIsPrefetchingTiles(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, activeFileId, selectedCategory, tileSources, loadPreviewUri]);

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
    if (
      gridLayout.tileSize > 0 &&
      pending.rows > 0 &&
      pending.columns > 0 &&
      (gridMatches || allowFallback || pending.tiles.length > 0)
    ) {
      loadTiles(pending.tiles);
      pendingRestoreRef.current = null;
      setHydrating(false);
      setSuspendTiles(false);
      const finalize = () => {
        setLoadedToken(pending.token ?? 0);
      };
      if (pending.preview) {
        requestAnimationFrame(() => {
          requestAnimationFrame(finalize);
        });
      } else {
        finalize();
      }
      return;
    }
    if (gridLayout.tileSize > 0 && pending.rows === 0 && pending.columns === 0) {
      resetTiles();
      pendingRestoreRef.current = null;
      setHydrating(false);
      setSuspendTiles(false);
      setLoadedToken(pending.token ?? 0);
    }
  }, [
    activeFileId,
    selectedCategory,
    gridLayout.tileSize,
    gridLayout.columns,
    gridLayout.rows,
    loadTiles,
    setHydrating,
    loadToken,
  ]);

  useEffect(() => {
    if (!ready || !activeFileId) {
      return;
    }
    const pending = pendingRestoreRef.current;
    if (suppressAutosaveRef.current) {
      return;
    }
    if (isHydratingFile || (pending && pending.fileId === activeFileId)) {
      return;
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        const thumbnailUri =
          Platform.OS === 'web'
            ? await renderTileCanvasToDataUrl({
                tiles,
                gridLayout,
                tileSources,
                gridGap: GRID_GAP,
                blankSource: null,
                errorSource: ERROR_TILE,
                lineColor: activeLineColor,
                lineWidth: activeLineWidth,
                maxDimension: 192,
              })
            : undefined;
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
    activeLineColor,
    activeLineWidth,
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
      typeof nativeEvent.locationX === 'number' &&
      typeof nativeEvent.locationY === 'number'
    ) {
      return { x: nativeEvent.locationX, y: nativeEvent.locationY };
    }
    if (event?.touches?.[0]) {
      const touch = event.touches[0];
      if (
        typeof touch.locationX === 'number' &&
        typeof touch.locationY === 'number'
      ) {
        return { x: touch.locationX, y: touch.locationY };
      }
      if (
        typeof touch.pageX === 'number' &&
        typeof touch.pageY === 'number'
      ) {
        const offset = gridOffsetRef.current;
        return { x: touch.pageX - offset.x, y: touch.pageY - offset.y };
      }
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

  const clearCanvas = () => {
    clearSequenceRef.current += 1;
    const clearId = clearSequenceRef.current;
    suppressAutosaveRef.current = true;
    setIsClearing(true);
    setShowGrid(false);
    setShowPreview(Boolean(clearPreviewUri ?? loadPreviewUri));
    resetTiles();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void (async () => {
          setIsCapturingPreview(true);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          let previewUri: string | null = null;
          if (Platform.OS !== 'web') {
            try {
              await FileSystem.makeDirectoryAsync(PREVIEW_DIR, { intermediates: true });
              const uri = await gridCaptureRef.current?.capture?.({
                format: 'png',
                quality: 1,
                result: 'tmpfile',
              });
              if (uri) {
                const target = `${PREVIEW_DIR}clear-preview.png`;
                try {
                  await FileSystem.deleteAsync(target, { idempotent: true });
                } catch {
                  // ignore
                }
                await FileSystem.copyAsync({ from: uri, to: target });
                previewUri = target;
              }
            } catch {
              // ignore
            }
          }
          if (previewUri) {
            setClearPreviewUri(previewUri);
          }
          setIsCapturingPreview(false);
          suppressAutosaveRef.current = false;
          setIsClearing(false);
          setShowGrid(true);
          setShowPreview(false);
        })();
      });
    });
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
    if (Platform.OS !== 'web') {
      setIsCapturingPreview(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      try {
        await FileSystem.makeDirectoryAsync(PREVIEW_DIR, { intermediates: true });
      } catch {
        // ignore
      }
      let previewUri: string | undefined;
      let thumbnailUri: string | undefined;
      try {
        const fullWidth = Math.max(
          1,
          Math.round(
            gridLayout.columns * gridLayout.tileSize +
              GRID_GAP * Math.max(0, gridLayout.columns - 1)
          )
        );
        const fullHeight = Math.max(
          1,
          Math.round(
            gridLayout.rows * gridLayout.tileSize +
              GRID_GAP * Math.max(0, gridLayout.rows - 1)
          )
        );
        const uri = await gridCaptureRef.current?.capture?.({
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          width: fullWidth,
          height: fullHeight,
        });
        if (uri) {
          const target = `${PREVIEW_DIR}${activeFileId}-full.png`;
          try {
            await FileSystem.deleteAsync(target, { idempotent: true });
          } catch {
            // ignore
          }
          await FileSystem.copyAsync({ from: uri, to: target });
          previewUri = target;
        }
        const thumbUri = await gridCaptureRef.current?.capture?.({
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          width: THUMB_SIZE,
          height: THUMB_SIZE,
        });
        if (thumbUri) {
          const thumbTarget = `${PREVIEW_DIR}${activeFileId}-thumb.png`;
          try {
            await FileSystem.deleteAsync(thumbTarget, { idempotent: true });
          } catch {
            // ignore
          }
          await FileSystem.copyAsync({ from: thumbUri, to: thumbTarget });
          thumbnailUri = thumbTarget;
        }
      } catch {
        // ignore
      } finally {
        setIsCapturingPreview(false);
      }
      upsertActiveFile({
        tiles,
        gridLayout,
        category: selectedCategory,
        preferredTileSize: fileTileSize,
        thumbnailUri,
        previewUri,
      });
      return;
    }
    const previewUri = await renderTileCanvasToDataUrl({
      tiles,
      gridLayout,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: null,
      errorSource: ERROR_TILE,
      lineColor: activeLineColor,
      lineWidth: activeLineWidth,
      maxDimension: 0,
      format: 'image/png',
      quality: 1,
    });
    const thumbnailUri = await renderTileCanvasToDataUrl({
      tiles,
      gridLayout,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: null,
      errorSource: ERROR_TILE,
      lineColor: activeLineColor,
      lineWidth: activeLineWidth,
      maxDimension: 192,
    });
    upsertActiveFile({
      tiles,
      gridLayout,
      category: selectedCategory,
      preferredTileSize: fileTileSize,
      thumbnailUri,
      previewUri,
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
    let expected = 0;
    if (downloadPreviewUri) {
      expected = 1;
    } else {
      const sources = TILE_MANIFEST[downloadTargetFile.category] ?? [];
      const total = downloadTargetFile.grid.rows * downloadTargetFile.grid.columns;
      const normalized = normalizeTiles(downloadTargetFile.tiles, total, sources.length);
      expected = normalized.filter(
        (tile) => tile && tile.imageIndex >= 0 && sources[tile.imageIndex]?.source
      ).length;
    }
    downloadExpectedRef.current = expected;
    setDownloadRenderKey((prev) => prev + 1);
    setIncludeDownloadBackground(true);
    setShowDownloadOverlay(true);
  }, [downloadTargetFile, downloadPreviewUri]);

  const downloadReady =
    downloadExpectedRef.current === 0 ||
    downloadLoadedCount >= downloadExpectedRef.current;

  const openFileInModifyView = async (fileId: string) => {
    await persistActiveFileNow();
    const file = files.find((entry) => entry.id === fileId);
    if (!file) {
      return;
    }
    const previewUri = file.previewUri ?? file.thumbnailUri ?? null;
    setLoadRequestId((prev) => prev + 1);
    setLoadPreviewUri(previewUri);
    setShowPreview(Boolean(previewUri));
    setSuspendTiles(true);
    setShowGrid(false);
    setHydrating(true);
    setActive(file.id);
    setViewMode('modify');
  };

  const handleDownloadPng = async () => {
    if (!downloadTargetFile) {
      return;
    }
    if (!downloadReady) {
      return;
    }
    setIsDownloading(true);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Download unavailable', 'Sharing is not available on this device.');
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
  };

  const handleDownloadSvg = async () => {
    if (!downloadTargetFile) {
      return;
    }
    setIsDownloading(true);
    try {
      const sources = TILE_MANIFEST[downloadTargetFile.category] ?? [];
      const svg = await renderTileCanvasToSvg({
        tiles: downloadTargetFile.tiles,
        gridLayout: {
          rows: downloadTargetFile.grid.rows,
          columns: downloadTargetFile.grid.columns,
          tileSize: downloadTargetFile.preferredTileSize,
        },
        tileSources: sources,
        gridGap: GRID_GAP,
        errorSource: ERROR_TILE,
        lineColor: downloadTargetFile.lineColor,
        lineWidth: downloadTargetFile.lineWidth,
        backgroundColor: includeDownloadBackground
          ? settings.backgroundColor
          : undefined,
      });
      if (!svg) {
        Alert.alert('Download failed', 'Unable to render the SVG.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Download unavailable', 'Sharing is not available on this device.');
        return;
      }
      const safeName = downloadTargetFile.name.replace(/[^\w-]+/g, '_');
      const target = `${FileSystem.cacheDirectory}${safeName}.svg`;
      await FileSystem.writeAsStringAsync(target, svg, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(target);
    } finally {
      setIsDownloading(false);
      setDownloadTargetId(null);
      setShowDownloadOverlay(false);
    }
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
          {[...files]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((file) => {
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
                onLongPress={() => {
                  setIncludeDownloadBackground(true);
                  setFileMenuTargetId(file.id);
                }}
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
                    <TileAsset
                      source={{ uri: file.thumbnailUri }}
                      name="thumbnail.png"
                      style={styles.fileThumbImage}
                      resizeMode="cover"
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
                                  <TileAsset
                                    source={source}
                                    name={sources[tile.imageIndex]?.name}
                                    strokeColor={file.lineColor}
                                    strokeWidth={file.lineWidth}
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
                    backgroundColor: includeDownloadBackground
                      ? settings.backgroundColor
                      : 'transparent',
                  },
                ]}
              >
                {downloadPreviewUri ? (
                  <Image
                    source={{ uri: downloadPreviewUri }}
                    style={styles.downloadPreviewImage}
                    resizeMode="stretch"
                    onLoad={() => {
                      setDownloadLoadedCount((count) => count + 1);
                    }}
                  />
                ) : (
                  (() => {
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
                                    <TileAsset
                                      source={source}
                                      name={sources[tile.imageIndex]?.name}
                                      strokeColor={downloadTargetFile.lineColor}
                                      strokeWidth={downloadTargetFile.lineWidth}
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
                  })()
                )}
              </ViewShot>
              <ThemedView style={styles.downloadOptions}>
                <ThemedText type="defaultSemiBold">Include background color</ThemedText>
                <Switch
                  value={includeDownloadBackground}
                  onValueChange={(value) => setIncludeDownloadBackground(value)}
                  accessibilityLabel="Include background color in download"
                />
              </ThemedView>
              <ThemedView style={styles.downloadActions}>
                <Pressable
                  style={[
                    styles.downloadActionButton,
                    isDownloading && styles.downloadActionDisabled,
                  ]}
                  onPress={() => {
                    setShowDownloadOverlay(false);
                    setDownloadTargetId(null);
                  }}
                  disabled={isDownloading}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel download"
                >
                  <ThemedText type="defaultSemiBold" style={styles.downloadCancelText}>
                    Cancel
                  </ThemedText>
                </Pressable>
                {Platform.OS === 'web' && (
                  <Pressable
                    style={[
                      styles.downloadActionButton,
                      isDownloading && styles.downloadActionDisabled,
                    ]}
                    onPress={() => {
                      if (isDownloading) {
                        return;
                      }
                      void handleDownloadSvg();
                    }}
                    disabled={isDownloading}
                    accessibilityRole="button"
                    accessibilityLabel="Download SVG"
                  >
                    <ThemedText
                      type="defaultSemiBold"
                      style={styles.downloadActionText}
                    >
                      SVG
                    </ThemedText>
                  </Pressable>
                )}
                <Pressable
                  style={[
                    styles.downloadActionButton,
                    styles.downloadPrimaryButton,
                    (!downloadReady || isDownloading) && styles.downloadActionDisabled,
                  ]}
                  onPress={() => {
                    if (!downloadReady || isDownloading) {
                      return;
                    }
                    void handleDownloadPng();
                  }}
                  disabled={!downloadReady || isDownloading}
                  accessibilityRole="button"
                  accessibilityLabel="Download PNG"
                >
                  <ThemedText
                    type="defaultSemiBold"
                    style={[styles.downloadActionText, styles.downloadPrimaryText]}
                  >
                    PNG
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
              {Platform.OS === 'web' && (
                <ThemedView style={styles.fileMenuToggle}>
                  <ThemedText type="defaultSemiBold">Include background</ThemedText>
                  <Switch
                    value={includeDownloadBackground}
                    onValueChange={(value) => setIncludeDownloadBackground(value)}
                    accessibilityLabel="Include background color in download"
                  />
                </ThemedView>
              )}
              <Pressable
                style={styles.fileMenuButton}
                onPress={() => {
                  const file = files.find((entry) => entry.id === fileMenuTargetId);
                  if (file) {
                    if (Platform.OS === 'web') {
                      const sources = TILE_MANIFEST[file.category] ?? [];
                      void downloadFile(file, sources, {
                        backgroundColor: includeDownloadBackground
                          ? settings.backgroundColor
                          : undefined,
                      });
                    } else {
                      setDownloadTargetId(file.id);
                    }
                  }
                  setFileMenuTargetId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'web' ? 'Download PNG' : 'Download file'}
              >
                <ThemedText type="defaultSemiBold">
                  {Platform.OS === 'web' ? 'Download PNG' : 'Download'}
                </ThemedText>
              </Pressable>
              {Platform.OS === 'web' && (
                <Pressable
                  style={styles.fileMenuButton}
                  onPress={() => {
                    const file = files.find((entry) => entry.id === fileMenuTargetId);
                    if (file) {
                      const sources = TILE_MANIFEST[file.category] ?? [];
                      void exportTileCanvasAsSvg({
                        tiles: file.tiles,
                        gridLayout: {
                          rows: file.grid.rows,
                          columns: file.grid.columns,
                          tileSize: file.preferredTileSize,
                        },
                        tileSources: sources,
                        gridGap: GRID_GAP,
                        errorSource: ERROR_TILE,
                        lineColor: file.lineColor,
                        lineWidth: file.lineWidth,
                        backgroundColor: includeDownloadBackground
                          ? settings.backgroundColor
                          : undefined,
                        fileName: `${file.name}.svg`,
                      });
                    }
                    setFileMenuTargetId(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Download SVG"
                >
                  <ThemedText type="defaultSemiBold">Download SVG</ThemedText>
                </Pressable>
              )}
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
                      setLoadRequestId((prev) => prev + 1);
                      setLoadPreviewUri(null);
                      setShowGrid(false);
                      setShowPreview(false);
                      setSuspendTiles(true);
                      setLoadedToken(0);
                      setHydrating(true);
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
              <HsvColorPicker
                label="Background Color"
                color={settings.backgroundColor}
                onChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    backgroundColor: value,
                  }))
                }
              />
              <HsvColorPicker
                label="Background Line Color"
                color={settings.backgroundLineColor}
                onChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    backgroundLineColor: value,
                  }))
                }
              />
              <ThemedView style={styles.sectionGroup}>
                <ThemedView style={styles.sectionHeader}>
                  <ThemedText type="defaultSemiBold">Line Width</ThemedText>
                  <ThemedText type="defaultSemiBold">
                    {settings.backgroundLineWidth.toFixed(1)}
                  </ThemedText>
                </ThemedView>
                <Slider
                  minimumValue={0}
                  maximumValue={4}
                  step={0.5}
                  value={settings.backgroundLineWidth}
                  onValueChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      backgroundLineWidth: value,
                    }))
                  }
                  minimumTrackTintColor="#22c55e"
                  maximumTrackTintColor="#e5e7eb"
                  thumbTintColor="#22c55e"
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
              label="File Settings"
              icon="tune-vertical-variant"
              onPress={() => setShowFileSettingsOverlay(true)}
            />
            <ToolbarButton
              label="Reset"
              icon="refresh"
              onPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                clearCanvas();
              }}
            />
            <ToolbarButton
              label="Flood Complete"
              icon="format-color-fill"
              onPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                }
                pendingFloodCompleteRef.current = setTimeout(() => {
                  pendingFloodCompleteRef.current = null;
                  floodComplete();
                }, 0);
              }}
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
        <View
          style={[
            styles.gridWrapper,
            {
              height: gridHeight,
              width: gridWidth,
            },
          ]}
        >
          <GridBackground
            rows={gridLayout.rows}
            columns={gridLayout.columns}
            tileSize={gridLayout.tileSize}
            width={gridWidth}
            height={gridHeight}
            backgroundColor={settings.backgroundColor}
            lineColor={settings.backgroundLineColor}
            lineWidth={settings.backgroundLineWidth}
          />
          {showPreview && !showGrid && (loadPreviewUri || clearPreviewUri) && (
            <Image
              source={{ uri: clearPreviewUri ?? loadPreviewUri ?? undefined }}
              style={styles.gridPreview}
              resizeMode="cover"
            />
          )}
          {(settings.mirrorHorizontal || settings.mirrorVertical) &&
            gridWidth > 0 &&
            gridHeight > 0 && (
              <View pointerEvents="none" style={styles.mirrorLines}>
                {settings.mirrorHorizontal && (
                  <View
                    style={[
                      styles.mirrorLineVertical,
                      {
                        left: gridWidth / 2 - 1,
                        height: gridHeight,
                        width: 2,
                      },
                    ]}
                  />
                )}
                {settings.mirrorVertical && (
                  <View
                    style={[
                      styles.mirrorLineHorizontal,
                      {
                        top: gridHeight / 2 - 1,
                        width: gridWidth,
                        height: 2,
                      },
                    ]}
                  />
                )}
              </View>
            )}
          {Platform.OS === 'web' ? (
            <ThemedView
              ref={setGridNode}
              style={[styles.grid, { opacity: showGrid ? 1 : 0 }]}
              accessibilityRole="grid"
              pointerEvents={showGrid && !isClearing ? 'auto' : 'none'}
              onLayout={(event: any) => {
                const layout = event?.nativeEvent?.layout;
                if (layout) {
                  gridOffsetRef.current = { x: layout.x ?? 0, y: layout.y ?? 0 };
                } else {
                  gridOffsetRef.current = { x: 0, y: 0 };
                }
              }}
              onMouseDown={(event: any) => {
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
              }}
              onMouseMove={(event: any) => {
                if (event.buttons === 1) {
                  const point = getRelativePoint(event);
                  if (point) {
                    handlePaintAt(point.x, point.y);
                  }
                }
              }}
              onMouseLeave={() => {
                lastPaintedRef.current = null;
              }}
              onMouseUp={() => {
                lastPaintedRef.current = null;
              }}
            >
              {rowIndices.map((rowIndex) => (
                <ThemedView key={`row-${rowIndex}`} style={styles.row}>
                  {columnIndices.map((columnIndex) => {
                    const cellIndex = rowIndex * gridLayout.columns + columnIndex;
                    const item = displayTiles[cellIndex];
                    return (
                      <TileCell
                        key={`cell-${cellIndex}`}
                        cellIndex={cellIndex}
                        tileSize={gridLayout.tileSize}
                        tile={item}
                        tileSources={tileSources}
                        showDebug={settings.showDebug}
                        strokeColor={activeLineColor}
                        strokeWidth={activeLineWidth}
                        showOverlays={showOverlays}
                        isCloneSource={
                          brush.mode === 'clone' && cloneSourceIndex === cellIndex
                        }
                        isCloneSample={
                          brush.mode === 'clone' && cloneSampleIndex === cellIndex
                        }
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
          ) : (
            <>
            <ViewShot
              ref={setGridNode}
              style={[
                styles.grid,
                {
                  opacity: showGrid || isCapturingPreview ? 1 : 0,
                  width: gridWidth,
                  height: gridHeight,
                },
              ]}
              pointerEvents="none"
            >
              {rowIndices.map((rowIndex) => (
                <ThemedView key={`row-${rowIndex}`} style={styles.row}>
                  {columnIndices.map((columnIndex) => {
                    const cellIndex = rowIndex * gridLayout.columns + columnIndex;
                    const item = displayTiles[cellIndex];
                    return (
                      <TileCell
                        key={`cell-${cellIndex}`}
                        cellIndex={cellIndex}
                        tileSize={gridLayout.tileSize}
                        tile={item}
                        tileSources={tileSources}
                        showDebug={settings.showDebug}
                        strokeColor={activeLineColor}
                        strokeWidth={activeLineWidth}
                        showOverlays={showOverlays}
                        isCloneSource={
                          brush.mode === 'clone' && cloneSourceIndex === cellIndex
                        }
                        isCloneSample={
                          brush.mode === 'clone' && cloneSampleIndex === cellIndex
                        }
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
              </ViewShot>
              <View
                ref={gridTouchRef}
                style={StyleSheet.absoluteFillObject}
                pointerEvents={showGrid && !isClearing ? 'auto' : 'none'}
                onLayout={(event: any) => {
                  const layout = event?.nativeEvent?.layout;
                  if (layout) {
                    gridOffsetRef.current = { x: layout.x ?? 0, y: layout.y ?? 0 };
                  } else {
                    gridOffsetRef.current = { x: 0, y: 0 };
                  }
                }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onStartShouldSetResponderCapture={() => true}
                onMoveShouldSetResponderCapture={() => true}
                onResponderTerminationRequest={() => false}
                onResponderGrant={(event: any) => {
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
                }}
                onResponderMove={(event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    if (longPressTimeoutRef.current) {
                      clearTimeout(longPressTimeoutRef.current);
                      longPressTimeoutRef.current = null;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                }}
                onResponderRelease={() => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  if (brush.mode === 'clone' && !longPressTriggeredRef.current) {
                    lastPaintedRef.current = null;
                  }
                  lastPaintedRef.current = null;
                }}
                onResponderTerminate={() => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  longPressTriggeredRef.current = false;
                  lastPaintedRef.current = null;
                }}
              />
            </>
          )}
        </View>
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
        {showFileSettingsOverlay && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowFileSettingsOverlay(false)}
              accessibilityRole="button"
              accessibilityLabel="Close file settings"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">File Settings</ThemedText>
              <ThemedView style={styles.sectionGroup}>
                <ThemedText type="defaultSemiBold">Tile Set</ThemedText>
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
                          lineWidth: activeLineWidth,
                          lineColor: activeLineColor,
                        });
                      }
                      setShowFileSettingsOverlay(false);
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
              <ThemedView style={styles.sectionGroup}>
                <ThemedView style={styles.sectionHeader}>
                  <ThemedText type="defaultSemiBold">Line Width</ThemedText>
                  <ThemedText type="defaultSemiBold">
                    {lineWidthDraft.toFixed(1)}
                  </ThemedText>
                </ThemedView>
                <Slider
                  minimumValue={1}
                  maximumValue={20}
                  step={0.1}
                  value={lineWidthDraft}
                  onValueChange={(value) => setLineWidthDraft(value)}
                  onSlidingComplete={(value) => {
                    if (!activeFileId) {
                      return;
                    }
                    upsertActiveFile({
                      tiles,
                      gridLayout,
                      category: selectedCategory,
                      preferredTileSize: fileTileSize,
                      lineWidth: value,
                      lineColor: activeLineColor,
                    });
                  }}
                  minimumTrackTintColor="#22c55e"
                  maximumTrackTintColor="#e5e7eb"
                  thumbTintColor="#22c55e"
                />
              </ThemedView>
              <HsvColorPicker
                label="Line Color"
                color={activeLineColor}
                onChange={(value) => {
                  if (!activeFileId) {
                    return;
                  }
                  upsertActiveFile({
                    tiles,
                    gridLayout,
                    category: selectedCategory,
                    preferredTileSize: fileTileSize,
                    lineWidth: activeLineWidth,
                    lineColor: value,
                  });
                }}
              />
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
              <HsvColorPicker
                label="Background Color"
                color={settings.backgroundColor}
                onChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    backgroundColor: value,
                  }))
                }
              />
              <HsvColorPicker
                label="Background Line Color"
                color={settings.backgroundLineColor}
                onChange={(value) =>
                  setSettings((prev) => ({
                    ...prev,
                    backgroundLineColor: value,
                  }))
                }
              />
              <ThemedView style={styles.sectionGroup}>
                <ThemedView style={styles.sectionHeader}>
                  <ThemedText type="defaultSemiBold">Line Width</ThemedText>
                  <ThemedText type="defaultSemiBold">
                    {settings.backgroundLineWidth.toFixed(1)}
                  </ThemedText>
                </ThemedView>
                <Slider
                  minimumValue={0}
                  maximumValue={4}
                  step={0.5}
                  value={settings.backgroundLineWidth}
                  onValueChange={(value) =>
                    setSettings((prev) => ({
                      ...prev,
                      backgroundLineWidth: value,
                    }))
                  }
                  minimumTrackTintColor="#22c55e"
                  maximumTrackTintColor="#e5e7eb"
                  thumbTintColor="#22c55e"
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
    width: '100%',
    backgroundColor: '#e5e5e5',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 6,
    backgroundColor: '#e5e5e5',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexWrap: 'nowrap',
    justifyContent: 'flex-end',
    flex: 1,
    overflow: 'visible',
    backgroundColor: 'transparent',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
    backgroundColor: 'transparent',
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
  colorPickerWrap: {
    width: '100%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 10,
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  colorPreview: {
    width: '100%',
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSlider: {
    flex: 1,
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
  fileMenuToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
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
  downloadPreviewImage: {
    width: '100%',
    height: '100%',
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
  downloadOptions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
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
  downloadActionDisabled: {
    opacity: 0.5,
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
    backgroundColor: 'transparent',
  },
  gridWrapper: {
    position: 'relative',
    backgroundColor: 'transparent',
  },
  gridBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
  },
  gridPreview: {
    ...StyleSheet.absoluteFillObject,
  },
  row: {
    flexDirection: 'row',
    gap: GRID_GAP,
    backgroundColor: 'transparent',
  },
  tile: {
    backgroundColor: 'transparent',
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
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  mirrorLineHorizontal: {
    position: 'absolute',
    backgroundColor: '#3b82f6',
  },
  mirrorLineVertical: {
    position: 'absolute',
    backgroundColor: '#3b82f6',
  },
});
