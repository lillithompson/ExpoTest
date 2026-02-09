import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';

import {
    TILE_CATEGORIES,
    TILE_MANIFEST,
    type TileCategory,
    type TileSource,
} from '@/assets/images/tiles/manifest';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { clearTileAssetCache, prefetchTileAssets, TileAsset } from '@/components/tile-asset';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { clearBrushFavorites, TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { TileGridCanvas } from '@/components/tile-grid-canvas';
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTileAtlas } from '@/hooks/use-tile-atlas';
import { useTileFiles, type TileFile } from '@/hooks/use-tile-files';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { useTilePatterns } from '@/hooks/use-tile-patterns';
import { useTileSets } from '@/hooks/use-tile-sets';
import { clearAllLocalData } from '@/utils/clear-local-data';
import {
    canApplyEmptyNewFileRestore,
    canApplyNonEmptyRestore,
} from '@/utils/load-state';
import {
    buildPreviewPath,
    getFilePreviewUri,
    hasCachedThumbnail,
    hasPreview as hasPreviewState,
    isOwnPreviewUri,
    showPreview as showPreviewState,
} from '@/utils/preview-state';
import { getTransformedConnectionsForName, parseTileConnections, transformConnections } from '@/utils/tile-compat';
import {
    exportTileCanvasAsSvg,
    renderTileCanvasToDataUrl,
    renderTileCanvasToSvg,
} from '@/utils/tile-export';
import { hydrateTilesWithSourceNames, normalizeTiles, type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const PATTERN_THUMB_HEIGHT = 70;
const PATTERN_THUMB_PADDING = 4;
const BRUSH_PANEL_ROW_GAP = 1;
/** Reserve space for horizontal scrollbar so the bottom row is not cut off on web. */
const WEB_SCROLLBAR_HEIGHT = 17;
const FILE_GRID_MIN_CARD_WIDTH = 100;
/** On desktop web, use larger min card width so thumbnails display bigger (fewer columns). */
const FILE_GRID_MIN_CARD_WIDTH_DESKTOP_WEB = 240;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const DEFAULT_CATEGORY = (TILE_CATEGORIES as string[]).includes('angular')
  ? ('angular' as TileCategory)
  : TILE_CATEGORIES[0];
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');
const PREVIEW_DIR = `${FileSystem.cacheDirectory ?? ''}tile-previews/`;
/** Max file thumbnail display size (web cap) and generated thumbnail resolution. */
const FILE_THUMB_SIZE = 200;
/** Min content width to treat as desktop (web); above this, thumbnails use 2× display size. */
const FILE_VIEW_DESKTOP_BREAKPOINT = 768;
const DEBUG_FILE_CHECK = true;
const buildUserTileSourceFromName = (name: string): TileSource | null => {
  if (!name.includes(':')) {
    return null;
  }
  const [setId, fileName] = name.split(':');
  if (!setId || !fileName) {
    return null;
  }
  const baseDir =
    FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  if (!baseDir) {
    return null;
  }
  const path = `${baseDir}tile-sets/${setId}/${fileName}`;
  return {
    name,
    source: { uri: path },
  };
};
const normalizeUserTileSource = (source: TileSource | null, name: string) => {
  if (!name.includes(':')) {
    return source;
  }
  const direct = buildUserTileSourceFromName(name);
  if (Platform.OS === 'web') {
    return source ?? direct;
  }
  if (!source) {
    return direct;
  }
  if (source.source === ERROR_TILE) {
    return direct ?? source;
  }
  const uri = (source.source as { uri?: string } | null)?.uri ?? '';
  if (uri.includes('/tile-sets/')) {
    return source;
  }
  return direct ?? source;
};
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

const toConnectionKey = (connections: boolean[] | null) =>
  connections ? connections.map((value) => (value ? '1' : '0')).join('') : null;
const normalizeCategories = (value: TileCategory[] | null | undefined) => {
  if (!value || value.length === 0) {
    return [DEFAULT_CATEGORY];
  }
  const valid = value.filter((entry) =>
    (TILE_CATEGORIES as string[]).includes(entry)
  );
  return valid.length > 0 ? valid : [DEFAULT_CATEGORY];
};
const getSourcesForCategories = (categories: TileCategory[]) =>
  categories.flatMap((category) => TILE_MANIFEST[category] ?? []);
const categoriesMatch = (a: TileCategory[], b: TileCategory[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

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
  onLongPress?: () => void;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  active?: boolean;
  color?: string;
};

function ToolbarButton({
  label,
  onPress,
  onLongPress,
  icon,
  active,
  color,
}: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
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
  strokeScaleByName?: Map<string, number>;
  atlas?: ReturnType<typeof useTileAtlas> | null;
  resolveSourceForName?: (name: string) => TileSource | null;
  resolveUgcSourceFromName?: (name: string) => TileSource | null;
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
    strokeScaleByName,
    atlas,
    resolveSourceForName,
    resolveUgcSourceFromName,
    isCloneSource,
    isCloneSample,
    isCloneTargetOrigin,
    isCloneCursor,
    showOverlays,
  }: TileCellProps) => {
    const resolvedByName =
      tile.name && resolveSourceForName ? resolveSourceForName(tile.name) : null;
    const resolvedByUgcFallback =
      tile.name && tile.name.includes(':') && resolveUgcSourceFromName
        ? resolveUgcSourceFromName(tile.name)
        : null;
    const resolvedByIndex =
      tile.imageIndex >= 0 ? tileSources[tile.imageIndex] ?? null : null;
    const resolved =
      tile.name != null && tile.name !== ''
        ? resolvedByName ?? resolvedByUgcFallback ?? null
        : resolvedByIndex;
    const tileName = tile.name ?? resolvedByIndex?.name ?? '';
    const usedPath =
      tile.name != null && tile.name !== ''
        ? resolvedByName
          ? 'byName'
          : resolvedByUgcFallback
            ? 'byUgc'
            : 'byNameOrUgcNull'
        : 'byIndex';
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
        : resolved?.source ?? ERROR_TILE;

    return (
      <View
        key={`cell-${cellIndex}`}
        accessibilityRole="button"
        accessibilityLabel={`Tile ${cellIndex + 1}`}
        style={[
          styles.tile,
          { width: tileSize, height: tileSize },
          showOverlays && isCloneSource && styles.cloneSource,
        ]}
      >
        {source && (
          <TileAtlasSprite
            atlas={atlas}
            key={`cell-${cellIndex}-${tileName}:${tile.imageIndex}:${tile.rotation}:${tile.mirrorX ? 1 : 0}:${
              tile.mirrorY ? 1 : 0
            }`}
            source={source}
            name={tileName}
            strokeColor={tile.imageIndex >= 0 ? strokeColor : '#ffffff'}
            strokeWidth={
              tile.imageIndex >= 0
                ? strokeWidth * (strokeScaleByName?.get(tileName) ?? 1)
                : 4
            }
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
    prev.tile.imageIndex === next.tile.imageIndex &&
    prev.tile.rotation === next.tile.rotation &&
    prev.tile.mirrorX === next.tile.mirrorX &&
    prev.tile.mirrorY === next.tile.mirrorY &&
    prev.tile.name === next.tile.name &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.strokeColor === next.strokeColor &&
    prev.strokeWidth === next.strokeWidth &&
    prev.strokeScaleByName === next.strokeScaleByName &&
    prev.atlas === next.atlas &&
    prev.showOverlays === next.showOverlays &&
    prev.tileSources === next.tileSources &&
    prev.resolveSourceForName === next.resolveSourceForName &&
    prev.resolveUgcSourceFromName === next.resolveUgcSourceFromName &&
    prev.isCloneSource === next.isCloneSource &&
    prev.isCloneSample === next.isCloneSample &&
    prev.isCloneTargetOrigin === next.isCloneTargetOrigin &&
    prev.isCloneCursor === next.isCloneCursor
);

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gridRef = useRef<View>(null);
  const gridCaptureRef = useRef<ViewShot>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const gridTouchRef = useRef<View>(null);
  const { settings, setSettings } = usePersistedSettings();
  const [selectedCategories, setSelectedCategories] = useState<TileCategory[]>(
    () => [DEFAULT_CATEGORY]
  );
  const [selectedTileSetIds, setSelectedTileSetIds] = useState<string[]>([]);
  const [fileSourceNames, setFileSourceNames] = useState<string[]>([]);
  const [lastFileCheck, setLastFileCheck] = useState<string>('');
  const [tileSetSelectionError, setTileSetSelectionError] = useState<string | null>(
    null
  );
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showTileSetChooser, setShowTileSetChooser] = useState(false);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [fileMenuTargetId, setFileMenuTargetId] = useState<string | null>(null);
  const [downloadTargetId, setDownloadTargetId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadOverlay, setShowDownloadOverlay] = useState(false);
  const [downloadRenderKey, setDownloadRenderKey] = useState(0);
  const [downloadLoadedCount, setDownloadLoadedCount] = useState(0);
  const [includeDownloadBackground, setIncludeDownloadBackground] = useState(true);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const selectBarAnim = useRef(new Animated.Value(0)).current;
  const [isHydratingFile, setIsHydratingFile] = useState(false);
  const [gridStabilized, setGridStabilized] = useState(false);
  const [nativeCanvasPaintReady, setNativeCanvasPaintReady] = useState(false);
  const [isPrefetchingTiles, setIsPrefetchingTiles] = useState(false);
  const [isPrefetchingTileSources, setIsPrefetchingTileSources] = useState(false);
  const [tileSourcesPrefetched, setTileSourcesPrefetched] = useState(false);
  const [suspendTiles, setSuspendTiles] = useState(false);
  const [loadRequestId, setLoadRequestId] = useState(0);
  const [loadToken, setLoadToken] = useState(0);
  const [loadedToken, setLoadedToken] = useState(0);
  const [sourcesStable, setSourcesStable] = useState(false);
  const [tilesStable, setTilesStable] = useState(false);
  const [loadPreviewUri, setLoadPreviewUri] = useState<string | null>(null);
  const [isCapturingPreview, setIsCapturingPreview] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearPreviewUri, setClearPreviewUri] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const NEW_FILE_TILE_SIZES = [25, 50, 75, 100, 150, 200] as const;
  const [viewMode, setViewMode] = useState<'modify' | 'file'>('file');
  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'pattern' }
    | {
        mode: 'fixed';
        index: number;
        sourceName?: string;
        rotation: number;
        mirrorX: boolean;
        mirrorY: boolean;
      }
  >({
    mode: 'random',
  });
  const fixedBrushSourceNameRef = useRef<string | null>(null);
  useEffect(() => {
    if (brush.mode !== 'fixed') {
      fixedBrushSourceNameRef.current = null;
    } else if (brush.sourceName != null) {
      fixedBrushSourceNameRef.current = brush.sourceName;
    }
  }, [brush.mode, brush.sourceName]);
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>(
    {}
  );
  const [paletteMirrors, setPaletteMirrors] = useState<Record<number, boolean>>({});
  const [paletteMirrorsY, setPaletteMirrorsY] = useState<Record<number, boolean>>(
    {}
  );
  const { patternsByCategory, createPattern, deletePatterns, clearAllPatterns } = useTilePatterns();
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [isPatternCreationMode, setIsPatternCreationMode] = useState(false);
  const [patternSelection, setPatternSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [patternAnchorIndex, setPatternAnchorIndex] = useState<number | null>(null);
  const [showPatternSaveModal, setShowPatternSaveModal] = useState(false);
  const [showPatternChooser, setShowPatternChooser] = useState(false);
  const [isPatternSelectMode, setIsPatternSelectMode] = useState(false);
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(new Set());
  const patternSelectAnim = useRef(new Animated.Value(0)).current;
  const [patternRotations, setPatternRotations] = useState<Record<string, number>>(
    {}
  );
  const [patternMirrors, setPatternMirrors] = useState<Record<string, boolean>>({});
  const patternLastTapRef = useRef<{ id: string; time: number } | null>(null);
  // tileSources is set after we resolve the active file/category.
  const isWeb = Platform.OS === 'web';
  const isExpoGo = Constants.appOwnership === 'expo';
  const useSkiaGrid = Platform.OS !== 'web' && !isExpoGo;
  const shouldUseAspectRatio = false;
  const aspectRatio = null;
  const [webViewport, setWebViewport] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined' || !window.visualViewport) {
      return;
    }
    const vv = window.visualViewport;
    const update = () =>
      setWebViewport({ w: vv.width, h: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isWeb]);
  const safeWidth =
    isWeb && webViewport != null
      ? Math.max(0, webViewport.w)
      : Math.max(0, width);
  const safeHeight =
    isWeb && webViewport != null
      ? Math.max(0, webViewport.h - insets.top)
      : Math.max(0, height - insets.top);
  const contentWidth = aspectRatio
    ? Math.min(safeWidth, safeHeight / aspectRatio)
    : safeWidth;
  const rawContentHeight = aspectRatio ? contentWidth * aspectRatio : safeHeight;
  const contentHeight = Math.max(0, rawContentHeight);
  const showPatternModal =
    showPatternChooser && brush.mode === 'pattern' && !isPatternCreationMode;

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
    clearAllFiles,
    upsertActiveFile,
    ready,
  } = useTileFiles(DEFAULT_CATEGORY);
  const {
    tileSets: userTileSets,
    bakedSourcesBySetId,
    currentBakedNamesBySetId,
    isLoaded: tileSetsLoaded,
    reloadTileSets,
  } = useTileSets();

  const activeCategories = useMemo(
    () => normalizeCategories(selectedCategories),
    [selectedCategories]
  );
  const primaryCategory = activeCategories[0] ?? DEFAULT_CATEGORY;
  const areTileSetsReady = useCallback(
    (ids: string[]) =>
      ids.every((id) => (bakedSourcesBySetId[id]?.length ?? 0) > 0),
    [bakedSourcesBySetId]
  );
  const currentBakedNameSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    Object.entries(currentBakedNamesBySetId).forEach(([setId, names]) => {
      if (Array.isArray(names) && names.length > 0) {
        map.set(setId, new Set(names));
      }
    });
    return map;
  }, [currentBakedNamesBySetId]);
  const getSourcesForSelection = useCallback(
    (categories: TileCategory[], tileSetIds: string[]) => {
      const userSources = tileSetIds.flatMap((id) => {
        const sources = bakedSourcesBySetId[id] ?? [];
        const nameSet = currentBakedNameSets.get(id);
        if (!nameSet || nameSet.size === 0) {
          return sources;
        }
        return sources.filter((source) => nameSet.has(source.name));
      });
      return [...userSources, ...getSourcesForCategories(categories)];
    },
    [bakedSourcesBySetId, currentBakedNameSets]
  );
  const paletteSources = useMemo(
    () => getSourcesForSelection(activeCategories, selectedTileSetIds),
    [activeCategories, selectedTileSetIds, getSourcesForSelection]
  );
  const allSourceLookup = useMemo(() => {
    const map = new Map<string, TileSource>();
    TILE_CATEGORIES.forEach((category) => {
      (TILE_MANIFEST[category] ?? []).forEach((source) => {
        map.set(source.name, source);
      });
    });
    Object.values(bakedSourcesBySetId).forEach((sources) => {
      sources.forEach((source) => {
        map.set(source.name, source);
      });
    });
    return map;
  }, [bakedSourcesBySetId]);
  const bakedLegacyLookup = useMemo(() => {
    const map = new Map<string, Map<string, TileSource>>();
    Object.entries(bakedSourcesBySetId).forEach(([setId, sources]) => {
      const inner = new Map<string, TileSource>();
      sources.forEach((source) => {
        const legacyName = source.name.startsWith(`${setId}:`)
          ? source.name.slice(setId.length + 1)
          : source.name;
        inner.set(legacyName, source);
      });
      map.set(setId, inner);
    });
    return map;
  }, [bakedSourcesBySetId]);
  const resolveSourceName = useCallback(
    (name: string, tileSetIds: string[]) => {
      if (!name.includes(':') && tileSetIds.length > 0) {
        let match: TileSource | null = null;
        for (const setId of tileSetIds) {
          const inner = bakedLegacyLookup.get(setId);
          const candidate = inner?.get(name);
          if (candidate) {
            if (!match) {
              match = candidate;
            }
          }
        }
        if (match) {
          return match;
        }
      } else if (!name.includes(':')) {
        const candidates: TileSource[] = [];
        bakedLegacyLookup.forEach((inner) => {
          const candidate = inner.get(name);
          if (candidate) {
            candidates.push(candidate);
          }
        });
        if (candidates.length === 1) {
          return candidates[0];
        }
      }
      const direct = allSourceLookup.get(name);
      if (direct) {
        return normalizeUserTileSource(direct, name);
      }
      return normalizeUserTileSource(null, name);
    },
    [allSourceLookup, bakedLegacyLookup]
  );
  const normalizeSourceNames = useCallback(
    (names: string[], tileSetIds: string[]) => {
      let changed = false;
      const next = names.map((name) => {
        if (name.includes(':')) {
          return name;
        }
        const resolved = resolveSourceName(name, tileSetIds);
        if (resolved && resolved.name !== name) {
          changed = true;
          return resolved.name;
        }
        return name;
      });
      return { names: next, changed };
    },
    [resolveSourceName]
  );
  const inferTileSetIdsFromSourceNames = useCallback(
    (names: string[]) => {
      const ids = new Set<string>();
      names.forEach((name) => {
        if (name.includes(':')) {
          const [setId] = name.split(':');
          if (setId && bakedSourcesBySetId[setId]) {
            ids.add(setId);
          }
          return;
        }
        bakedLegacyLookup.forEach((inner, setId) => {
          if (inner.has(name)) {
            ids.add(setId);
          }
        });
      });
      return Array.from(ids);
    },
    [bakedLegacyLookup, bakedSourcesBySetId]
  );
  const getSourcesForFile = useCallback(
    (file: TileFile) => {
      if (Array.isArray(file.sourceNames) && file.sourceNames.length > 0) {
        return file.sourceNames.map((name) => {
          const resolved = resolveSourceName(name, file.tileSetIds ?? []);
          return (
            resolved ?? {
              name,
              source: ERROR_TILE,
            }
          );
        });
      }
      if (file.tiles.length > 0) {
        const legacyCategories = normalizeCategories(
          file.categories && file.categories.length > 0
            ? file.categories
            : file.category
              ? [file.category]
              : []
        );
        const legacyTileSetIds = Array.isArray(file.tileSetIds) ? file.tileSetIds : [];
        return getSourcesForSelection(legacyCategories, legacyTileSetIds);
      }
      return getSourcesForSelection(selectedCategories, selectedTileSetIds);
    },
    [resolveSourceName, getSourcesForSelection, selectedCategories, selectedTileSetIds]
  );
  const rawActiveFileSourceNames = useMemo(() => {
    if (activeFile && Array.isArray(activeFile.sourceNames) && activeFile.sourceNames.length > 0) {
      return activeFile.sourceNames;
    }
    if (fileSourceNames.length > 0) {
      return fileSourceNames;
    }
    return [];
  }, [activeFile, fileSourceNames]);
  const activeFileSourceNames = useMemo(() => {
    if (rawActiveFileSourceNames.length === 0) {
      return fileSourceNames;
    }
    if (fileSourceNames.length === 0) {
      return rawActiveFileSourceNames;
    }
    const hasNew = fileSourceNames.some((name) => !rawActiveFileSourceNames.includes(name));
    return hasNew ? fileSourceNames : rawActiveFileSourceNames;
  }, [rawActiveFileSourceNames, fileSourceNames]);
  const tileSources = useMemo(() => {
    const stored = activeFileSourceNames;
    const tileSetIds = Array.isArray(activeFile?.tileSetIds) ? activeFile.tileSetIds : [];
    const paletteLookup = new Map<string, TileSource>();
    paletteSources.forEach((source) => {
      if (!paletteLookup.has(source.name)) {
        paletteLookup.set(source.name, source);
      }
    });
    if (stored.length === 0) {
      if (activeFile && Array.isArray(activeFile.tiles) && activeFile.tiles.length > 0) {
        return getSourcesForFile(activeFile);
      }
      return paletteSources;
    }
    return stored.map((name) => {
      const resolved = paletteLookup.get(name) ?? resolveSourceName(name, tileSetIds);
      const normalized = normalizeUserTileSource(resolved ?? null, name);
      return (
        normalized ?? {
          name,
          source: ERROR_TILE,
        }
      );
    });
  }, [
    activeFile,
    activeFileSourceNames,
    paletteSources,
    resolveSourceName,
    getSourcesForFile,
  ]);
  const fileSourceNamesForMapping =
    activeFileSourceNames.length > 0 ? activeFileSourceNames : fileSourceNames;
  const fileIndexByName = useMemo(() => {
    const indexByName = new Map<string, number>();
    fileSourceNamesForMapping.forEach((name, index) => {
      if (!indexByName.has(name)) {
        indexByName.set(name, index);
      }
    });
    return indexByName;
  }, [fileSourceNamesForMapping]);
  const tileIndexByName = useMemo(() => {
    const indexByName = new Map<string, number>();
    tileSources.forEach((source, index) => {
      if (!indexByName.has(source.name)) {
        indexByName.set(source.name, index);
      }
    });
    return indexByName;
  }, [tileSources]);
  const tileSourcesSignature = useMemo(
    () =>
      tileSources
        .map((source) => {
          const raw = source.source as { uri?: string } | number | undefined;
          const uri =
            typeof raw === 'object' && raw && 'uri' in raw ? raw.uri ?? '' : String(raw ?? '');
          return `${source.name}:${uri}`;
        })
        .join('|'),
    [tileSources]
  );
  const tileSourcesPrefetchKey = useMemo(
    () => `${activeFileId ?? 'none'}|${loadToken}|${activeFileSourceNames.join('|')}`,
    [activeFileId, loadToken, activeFileSourceNames]
  );
  const renderTileSources = useMemo(() => tileSources, [tileSourcesSignature]);
  const paletteIndexByName = useMemo(() => {
    const map = new Map<string, number>();
    paletteSources.forEach((source, index) => {
      if (!map.has(source.name)) {
        map.set(source.name, index);
      }
    });
    return map;
  }, [paletteSources]);
  const paletteIndexToFileIndex = useMemo(
    () => paletteSources.map((source) => tileIndexByName.get(source.name) ?? -1),
    [tileIndexByName, paletteSources]
  );
  const strokeScaleByName = useMemo(() => {
    const map = new Map<string, number>();
    userTileSets.forEach((set) => {
      const sources = bakedSourcesBySetId[set.id] ?? [];
      const scale = Math.max(1, set.resolution);
      sources.forEach((source) => {
        map.set(source.name, scale);
      });
    });
    return map;
  }, [userTileSets, bakedSourcesBySetId]);
  const selectedPaletteBrush = useMemo(() => {
    if (brush.mode !== 'fixed') {
      return brush;
    }
    const name =
      brush.sourceName ??
      tileSources[brush.index]?.name ??
      fileSourceNamesForMapping[brush.index];
    const paletteIndex = name ? paletteIndexByName.get(name) ?? -1 : -1;
    if (paletteIndex < 0) {
      return { ...brush, index: -1 };
    }
    return { ...brush, index: paletteIndex };
  }, [brush, tileSources, fileSourceNamesForMapping, paletteIndexByName]);
  const randomSourceIndices = useMemo(
    () => paletteIndexToFileIndex.filter((index) => index >= 0),
    [paletteIndexToFileIndex]
  );
  const ensureFileSourceNames = useCallback(
    (sources: TileSource[]) => {
      const base =
        fileSourceNames.length > 0
          ? fileSourceNames
          : activeFileSourceNames.length > 0
            ? activeFileSourceNames
            : [];
      const next = [...base];
      let changed = false;
      sources.forEach((source) => {
        if (!next.includes(source.name)) {
          next.push(source.name);
          changed = true;
        }
      });
      if (changed) {
        setFileSourceNames(next);
      }
      return changed ? next : base;
    },
    [fileSourceNames, activeFileSourceNames]
  );
  const tileSourcesKey = useMemo(
    () => tileSources.map((source) => source.name).join('|'),
    [tileSources]
  );
  const prevTileSourcesKeyRef = useRef(tileSourcesKey);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    clearTileAssetCache();
  }, [bakedSourcesBySetId]);
  const activePatterns = useMemo(
    () => patternsByCategory.get(primaryCategory) ?? [],
    [patternsByCategory, primaryCategory]
  );
  const selectedPattern = useMemo(() => {
    if (!selectedPatternId) {
      return activePatterns[0] ?? null;
    }
    return activePatterns.find((pattern) => pattern.id === selectedPatternId) ?? null;
  }, [activePatterns, selectedPatternId]);

  useEffect(() => {
    if (activePatterns.length === 0) {
      if (selectedPatternId !== null) {
        setSelectedPatternId(null);
      }
      if (brush.mode === 'pattern') {
        setIsPatternCreationMode(true);
      }
      return;
    }
    if (!selectedPattern) {
      setSelectedPatternId(activePatterns[0].id);
    }
  }, [activePatterns, selectedPattern, selectedPatternId, brush.mode]);

  useEffect(() => {
    if (brush.mode !== 'pattern') {
      setIsPatternCreationMode(false);
      setPatternSelection(null);
      setShowPatternSaveModal(false);
      setShowPatternChooser(false);
      setPatternAnchorIndex(null);
    } else if (activePatterns.length === 0) {
      setIsPatternCreationMode(true);
    }
  }, [brush.mode, activePatterns.length]);
  useEffect(() => {
    setPatternAnchorIndex(null);
  }, [selectedPattern?.id]);

  const fileTileSize = activeFile?.preferredTileSize ?? settings.preferredTileSize;
  const activeLineWidth = activeFile?.lineWidth ?? 10;
  const activeLineColor = activeFile?.lineColor ?? '#ffffff';
  const [lineWidthDraft, setLineWidthDraft] = useState(activeLineWidth);

  const {
    gridLayout,
    tiles,
    handlePress,
    floodFill,
    floodComplete,
    reconcileTiles,
    controlledRandomize,
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
    suspendRemap: true,
    randomSourceIndices,
    fixedRows: activeFile?.grid.rows ?? 0,
    fixedColumns: activeFile?.grid.columns ?? 0,
    brush,
    mirrorHorizontal: settings.mirrorHorizontal,
    mirrorVertical: settings.mirrorVertical,
    pattern: selectedPattern
      ? {
          tiles: selectedPattern.tiles,
          width: selectedPattern.width,
          height: selectedPattern.height,
          rotation: patternRotations[selectedPattern.id] ?? 0,
          mirrorX: patternMirrors[selectedPattern.id] ?? false,
        }
      : null,
    patternAnchorKey: selectedPattern?.id ?? null,
    getFixedBrushSourceName: () => fixedBrushSourceNameRef.current,
  });
  const tilesSignature = useMemo(
    () =>
      tiles
        .map(
          (tile) =>
            `${tile.imageIndex}:${tile.rotation}:${tile.mirrorX ? 1 : 0}:${
              tile.mirrorY ? 1 : 0
            }`
        )
        .join('|'),
    [tiles]
  );
  useEffect(() => {
    if (prevTileSourcesKeyRef.current === tileSourcesKey) {
      return;
    }
    prevTileSourcesKeyRef.current = tileSourcesKey;
    // When source list changes (e.g. after ensureFileSourceNames adds UGC), keep fixed
    // brush if the selected source is still in the new list so the user can place it.
    const preservedName =
      brush.mode === 'fixed'
        ? fixedBrushSourceNameRef.current ?? brush.sourceName ?? null
        : null;
    const newIndex =
      preservedName != null
        ? tileSources.findIndex((s) => s.name === preservedName)
        : -1;
    if (newIndex >= 0) {
      setBrush({
        mode: 'fixed',
        index: newIndex,
        sourceName: preservedName,
        rotation: brush.mode === 'fixed' ? brush.rotation : 0,
        mirrorX: brush.mode === 'fixed' ? brush.mirrorX : false,
        mirrorY: brush.mode === 'fixed' ? brush.mirrorY : false,
      });
      // ref already holds preservedName; keep it
    } else {
      setBrush({ mode: 'random' });
      clearCloneSource();
      setIsPatternCreationMode(false);
      setPatternSelection(null);
      setShowPatternSaveModal(false);
      setShowPatternChooser(false);
    }
  }, [tileSourcesKey, clearCloneSource, brush, tileSources]);
  const displayTiles = tiles;
  const gridWidth =
    gridLayout.columns * gridLayout.tileSize +
    GRID_GAP * Math.max(0, gridLayout.columns - 1);
  const gridHeight =
    gridLayout.rows * gridLayout.tileSize +
    GRID_GAP * Math.max(0, gridLayout.rows - 1);
  const brushPanelHeight = Math.max(
    0,
    contentHeight -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      gridHeight
  );
  const brushRows =
    Platform.OS === 'ios' &&
    (brushPanelHeight - BRUSH_PANEL_ROW_GAP * 2) / 3 >= 75
      ? 3
      : 2;
  const brushContentHeight =
    Platform.OS === 'web'
      ? Math.max(0, brushPanelHeight - WEB_SCROLLBAR_HEIGHT)
      : brushPanelHeight;
  const brushItemSize = Math.max(
    0,
    Math.floor(
      (brushContentHeight - BRUSH_PANEL_ROW_GAP * Math.max(0, brushRows - 1)) /
        brushRows
    )
  );
  const gridAtlas = useTileAtlas({
    tileSources: renderTileSources,
    tileSize: gridLayout.tileSize,
    strokeColor: activeLineColor,
    strokeWidth: activeLineWidth,
    strokeScaleByName,
  });
  const brushAtlas = useTileAtlas({
    tileSources: paletteSources,
    tileSize: brushItemSize,
    strokeColor: activeLineColor,
    strokeWidth: activeLineWidth,
    strokeScaleByName,
  });
  const lastPaintedRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const isTouchDragActiveRef = useRef(false);
  const ignoreNextMouseRef = useRef(false);
  const ignoreMouseAfterTouchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadTokenRef = useRef(0);
  const isHydratingFileRef = useRef(false);
  const interactionStartRef = useRef<{ id: number; time: number } | null>(null);
  const interactionPendingRef = useRef(false);
  const interactionCounterRef = useRef(0);
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
    categories: TileCategory[];
    token?: number;
    preview?: boolean;
    sourceNames?: string[];
  } | null>(null);
  const setHydrating = useCallback((value: boolean) => {
    isHydratingFileRef.current = value;
    setIsHydratingFile(value);
  }, []);
  const setInteracting = useCallback((value: boolean) => {
    if (isInteractingRef.current === value) {
      return;
    }
    isInteractingRef.current = value;
    setIsInteracting(value);
  }, []);
  const markInteractionStart = useCallback(() => {
    if (interactionPendingRef.current) {
      return;
    }
    interactionCounterRef.current += 1;
    interactionStartRef.current = {
      id: interactionCounterRef.current,
      time: Date.now(),
    };
    interactionPendingRef.current = true;
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
  const activeFileTileSetIds = useMemo(
    () => (Array.isArray(activeFile?.tileSetIds) ? activeFile.tileSetIds : []),
    [activeFile]
  );
  const tileSourcesByName = useMemo(() => {
    const map = new Map<string, TileSource>();
    tileSources.forEach((source) => {
      if (!map.has(source.name)) {
        map.set(source.name, source);
      }
    });
    return map;
  }, [tileSources]);
  const resolveSourceForName = useCallback(
    (name: string) => {
      const direct = tileSourcesByName.get(name);
      if (direct) {
        return normalizeUserTileSource(direct, name);
      }
      return normalizeUserTileSource(
        resolveSourceName(name, activeFileTileSetIds),
        name
      );
    },
    [resolveSourceName, activeFileTileSetIds, tileSourcesByName]
  );
  const handleCheckUgcFile = useCallback(async () => {
    const candidate =
      (activeFileSourceNames.find((name) => name.includes(':')) ??
        fileSourceNames.find((name) => name.includes(':')) ??
        '') as string;
    if (!candidate) {
      Alert.alert('UGC File Check', 'No UGC tile name found in source names.');
      return;
    }
    const direct = buildUserTileSourceFromName(candidate);
    const uri = (direct?.source as { uri?: string } | null)?.uri ?? '';
    if (!uri) {
      Alert.alert('UGC File Check', 'Could not build a file path for this tile.');
      return;
    }
    let exists = false;
    try {
      exists = await FileSystem.getInfoAsync(uri).then((info) => info.exists);
    } catch {
      exists = false;
    }
    const payload = `${candidate} -> ${uri} (${exists ? 'exists' : 'missing'})`;
    setLastFileCheck(payload);
    Alert.alert('UGC File Check', payload);
  }, [activeFileSourceNames, fileSourceNames]);
  const resolveTileAssetForFile = useCallback(
    (
      tile: Tile | undefined,
      sources: TileSource[],
      tileSetIds: string[]
    ): { source: unknown | null; name: string } => {
      if (!tile) {
        return { source: null, name: '' };
      }
      if (tile.imageIndex === -2) {
        return { source: ERROR_TILE, name: 'tile_error.svg' };
      }
      if (tile.imageIndex < 0) {
        return { source: null, name: '' };
      }
      if (tile.name) {
        const resolved = resolveSourceName(tile.name, tileSetIds);
        if (resolved) {
          return { source: resolved.source, name: resolved.name };
        }
      }
      const fallback = sources[tile.imageIndex];
      if (fallback) {
        return { source: fallback.source, name: fallback.name };
      }
      return { source: ERROR_TILE, name: tile.name ?? 'tile_error.svg' };
    },
    [resolveSourceName]
  );
  const saveTileSetIds = useMemo(
    () => (activeFileTileSetIds.length > 0 ? activeFileTileSetIds : selectedTileSetIds),
    [activeFileTileSetIds, selectedTileSetIds]
  );
  const hasActiveFileTiles =
    !!activeFile && Array.isArray(activeFile.tiles) && activeFile.tiles.length > 0;
  const areActiveFileSourcesResolved = useMemo(() => {
    if (!hasActiveFileTiles) {
      return true;
    }
    if (activeFileSourceNames.length === 0) {
      return false;
    }
    return activeFileSourceNames.every((name) =>
      Boolean(resolveSourceName(name, activeFileTileSetIds))
    );
  }, [activeFileSourceNames, resolveSourceName, activeFileTileSetIds, hasActiveFileTiles]);
  const isTileSetSourcesReadyForActiveFile = useMemo(() => {
    const file = activeFile ?? null;
    if (!file) {
      return true;
    }
    const fileTileSetIds = Array.isArray(file.tileSetIds) ? file.tileSetIds : [];
    if (fileTileSetIds.length === 0) {
      return true;
    }
    const knownIds = tileSetsLoaded
      ? fileTileSetIds.filter((id) => userTileSets.some((set) => set.id === id))
      : fileTileSetIds;
    if (knownIds.length === 0) {
      return true;
    }
    return areTileSetsReady(knownIds);
  }, [activeFile, activeFileId, tileSetsLoaded, userTileSets, areTileSetsReady]);
  const hasMissingTileSources = useMemo(() => {
    const file = activeFile ?? null;
    if (!file || viewMode !== 'modify') {
      return false;
    }
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (!tile || tile.imageIndex < 0) {
        continue;
      }
      const sourceEntry = tileSources[tile.imageIndex];
      if (!sourceEntry) {
        return true;
      }
      if (sourceEntry.source === ERROR_TILE) {
        return true;
      }
    }
    return false;
  }, [activeFile, viewMode, tiles, tileSources]);
  const isActiveFileRenderReady = useMemo(() => {
    if (viewMode !== 'modify') {
      return false;
    }
    if (isHydratingFile || loadedToken !== loadToken) {
      return false;
    }
    if (!tileSourcesPrefetched) {
      return false;
    }
    if (!isTileSetSourcesReadyForActiveFile || !areActiveFileSourcesResolved) {
      return false;
    }
    if (hasMissingTileSources) {
      return false;
    }
    return true;
  }, [
    viewMode,
    isHydratingFile,
    loadedToken,
    loadToken,
    tileSourcesPrefetched,
    isTileSetSourcesReadyForActiveFile,
    areActiveFileSourcesResolved,
    hasMissingTileSources,
  ]);
  const loadPhase = useMemo(() => {
    if (viewMode !== 'modify' || !activeFileId) {
      return 'idle';
    }
    const isLoading = isHydratingFile || loadedToken !== loadToken;
    if (!isLoading && hasMissingTileSources) {
      return 'error';
    }
    if (!isLoading && isActiveFileRenderReady) {
      return 'ready';
    }
    return 'loading';
  }, [
    viewMode,
    activeFileId,
    isHydratingFile,
    loadedToken,
    loadToken,
    hasMissingTileSources,
    isActiveFileRenderReady,
  ]);
  const [readyLatchToken, setReadyLatchToken] = useState(0);
  useEffect(() => {
    setReadyLatchToken(0);
  }, [viewMode, activeFileId, loadToken]);
  useEffect(() => {
    if (isActiveFileRenderReady) {
      setReadyLatchToken(loadToken);
    }
  }, [isActiveFileRenderReady, loadToken]);
  useEffect(() => {
    if (loadToken === 0) {
      return;
    }
    if (readyLatchToken !== loadToken) {
      return;
    }
    if (
      isActiveFileRenderReady ||
      (!hasMissingTileSources &&
        isTileSetSourcesReadyForActiveFile &&
        areActiveFileSourcesResolved)
    ) {
      return;
    }
    setReadyLatchToken(0);
  }, [
    loadToken,
    readyLatchToken,
    isActiveFileRenderReady,
    hasMissingTileSources,
    isTileSetSourcesReadyForActiveFile,
    areActiveFileSourcesResolved,
  ]);
  const isReadyLatched = readyLatchToken === loadToken && loadToken !== 0;
  const showGrid = isReadyLatched;
  const hasPreview = hasPreviewState(loadPreviewUri, clearPreviewUri);
  const gridVisible = showGrid && gridStabilized;
  const showPreview = showPreviewState(hasPreview, gridVisible, isClearing);
  const showOverlays = !isCapturingPreview && !suspendTiles && gridVisible;
  const downloadPreviewUri = useMemo(() => {
    if (!downloadTargetFile) {
      return null;
    }
    return isTransparentPreview(downloadTargetFile.previewUri)
      ? downloadTargetFile.previewUri
      : null;
  }, [downloadTargetFile]);
  const filesRef = useRef(files);
  const activeFileRef = useRef<TileFile | null>(activeFile ?? null);
  const fileSourcesReadyRef = useRef(false);
  const fileSourcesInitIdRef = useRef<string | null>(null);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    activeFileRef.current = activeFile ?? null;
  }, [activeFile]);
  useEffect(() => {
    fileSourcesReadyRef.current = false;
    fileSourcesInitIdRef.current = null;
  }, [activeFileId]);

  const remapTilesForCategories = useCallback(
    (nextCategories: TileCategory[], nextTileSetIds: string[], currentTiles: Tile[]) => {
      const prevSources = tileSources;
      const nextSources = getSourcesForSelection(nextCategories, nextTileSetIds);
      const sameSources =
        prevSources.length === nextSources.length &&
        prevSources.every((source, index) => source === nextSources[index]);
      if (sameSources) {
        return currentTiles;
      }
      const totalCells = gridLayout.rows * gridLayout.columns;
      const normalized = normalizeTiles(
        currentTiles,
        totalCells,
        prevSources.length
      );
      if (normalized.length === 0) {
        return normalized;
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
            const key = toConnectionKey(
              transformConnections(base, rotation, mirrorX, mirrorY)
            );
            if (!key) {
              return;
            }
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

      return normalized.map((tile) => {
        if (!tile || tile.imageIndex < 0) {
          return tile;
        }
        const previousSource = prevSources[tile.imageIndex];
        if (!previousSource) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const nextIndex = nextSources.indexOf(previousSource);
        if (nextIndex >= 0) {
          return {
            imageIndex: nextIndex,
            rotation: tile.rotation,
            mirrorX: tile.mirrorX,
            mirrorY: tile.mirrorY,
          };
        }
        const previousConnections = parseTileConnections(previousSource.name);
        if (!previousConnections) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
        const renderedKey = toConnectionKey(
          transformConnections(
            previousConnections,
            tile.rotation,
            tile.mirrorX,
            tile.mirrorY
          )
        );
        if (!renderedKey) {
          return { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
        }
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
    },
    [gridLayout.columns, gridLayout.rows, tileSources, getSourcesForSelection]
  );

  useEffect(() => {
    setLineWidthDraft(activeLineWidth);
  }, [activeLineWidth]);

  useEffect(() => {
    if (brush.mode !== 'clone') {
      clearCloneSource();
    }
  }, [brush.mode, clearCloneSource]);

  useEffect(() => {
    Animated.timing(selectBarAnim, {
      toValue: isSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isSelectMode, selectBarAnim]);

  useEffect(() => {
    if (!showTileSetChooser && tileSetSelectionError) {
      setTileSetSelectionError(null);
    }
  }, [showTileSetChooser, tileSetSelectionError]);

  useEffect(() => {
    Animated.timing(patternSelectAnim, {
      toValue: isPatternSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isPatternSelectMode, patternSelectAnim]);

  useEffect(() => {
    const storedCategories = Array.isArray(settings.tileSetCategories)
      ? (settings.tileSetCategories as TileCategory[])
      : [];
    const normalized =
      storedCategories.length > 0
        ? normalizeCategories(storedCategories)
        : [DEFAULT_CATEGORY];
    const same =
      normalized.length === selectedCategories.length &&
      normalized.every((value, index) => value === selectedCategories[index]);
    if (!same) {
      setSelectedCategories(normalized);
    }
  }, [settings.tileSetCategories, selectedCategories]);

  useEffect(() => {
    const nextIds = Array.isArray(settings.tileSetIds) ? settings.tileSetIds : [];
    const same =
      nextIds.length === selectedTileSetIds.length &&
      nextIds.every((value, index) => value === selectedTileSetIds[index]);
    if (!same) {
      setSelectedTileSetIds(nextIds);
    }
  }, [settings.tileSetIds, selectedTileSetIds]);
  useEffect(() => {
    if (!tileSetsLoaded || selectedTileSetIds.length === 0) {
      return;
    }
    const validIds = selectedTileSetIds.filter((id) =>
      userTileSets.some((set) => set.id === id)
    );
    if (
      validIds.length === selectedTileSetIds.length &&
      validIds.every((id, index) => id === selectedTileSetIds[index])
    ) {
      return;
    }
    setSelectedTileSetIds(validIds);
    setSettings((prev) => ({
      ...prev,
      tileSetIds: validIds,
    }));
  }, [tileSetsLoaded, selectedTileSetIds, userTileSets, setSettings]);

  useEffect(() => {
    const file = activeFileRef.current ?? activeFile ?? null;
    if (!activeFileId || !file) {
      setFileSourceNames([]);
      fileSourcesReadyRef.current = false;
      fileSourcesInitIdRef.current = null;
      return;
    }
    const alreadyReady =
      fileSourcesInitIdRef.current === activeFileId && fileSourcesReadyRef.current;
    const stored =
      Array.isArray(file.sourceNames) && file.sourceNames.length > 0
        ? file.sourceNames
        : [];
    if (stored.length > 0) {
      const fileTileSetIds = Array.isArray(file.tileSetIds) ? file.tileSetIds : [];
      const inferredTileSetIds =
        fileTileSetIds.length > 0
          ? fileTileSetIds
          : inferTileSetIdsFromSourceNames(stored);
      const pendingTileSetIds =
        inferredTileSetIds.length > 0 ? inferredTileSetIds : selectedTileSetIds;
      const normalized = normalizeSourceNames(stored, pendingTileSetIds);
      if (!alreadyReady || fileSourceNames.length !== normalized.names.length) {
        setFileSourceNames(normalized.names);
      }
      if (normalized.changed || (fileTileSetIds.length === 0 && inferredTileSetIds.length > 0)) {
        upsertActiveFile({
          tiles: file.tiles,
          gridLayout: file.grid,
          tileSetIds: pendingTileSetIds,
          sourceNames: normalized.names,
          preferredTileSize: file.preferredTileSize,
          lineWidth: file.lineWidth,
          lineColor: file.lineColor,
          thumbnailUri: file.thumbnailUri,
          previewUri: file.previewUri,
        });
      }
      fileSourcesReadyRef.current = true;
      fileSourcesInitIdRef.current = activeFileId;
      return;
    }
    const fileTileSetIds = Array.isArray(file.tileSetIds) ? file.tileSetIds : [];
    const knownTileSetIds =
      fileTileSetIds.length === 0
        ? []
        : tileSetsLoaded
          ? fileTileSetIds.filter((id) =>
              userTileSets.some((set) => set.id === id)
            )
          : fileTileSetIds;
    const pendingTileSetIds =
      knownTileSetIds.length > 0 ? knownTileSetIds : selectedTileSetIds;
    if (
      file.tiles.length > 0 &&
      pendingTileSetIds.length > 0 &&
      !areTileSetsReady(pendingTileSetIds)
    ) {
      // Defer initialization until user tile sets are baked to avoid losing mappings.
      return;
    }
    if (alreadyReady) {
      return;
    }
    const initialSources = getSourcesForFile(file).map((source) => source.name);
    if (initialSources.length === 0) {
      setFileSourceNames([]);
      fileSourcesReadyRef.current = true;
      fileSourcesInitIdRef.current = activeFileId;
      return;
    }
    setFileSourceNames(initialSources);
    upsertActiveFile({
      tiles: file.tiles,
      gridLayout: file.grid,
      tileSetIds: fileTileSetIds.length > 0 ? fileTileSetIds : pendingTileSetIds,
      sourceNames: initialSources,
      preferredTileSize: file.preferredTileSize,
      lineWidth: file.lineWidth,
      lineColor: file.lineColor,
      thumbnailUri: file.thumbnailUri,
      previewUri: file.previewUri,
    });
    fileSourcesReadyRef.current = true;
    fileSourcesInitIdRef.current = activeFileId;
  }, [
    activeFileId,
    activeFile,
    selectedTileSetIds,
    areTileSetsReady,
    getSourcesForFile,
    normalizeSourceNames,
    inferTileSetIdsFromSourceNames,
    upsertActiveFile,
    fileSourceNames.length,
    tileSetsLoaded,
    userTileSets,
  ]);

  const lastSourceNormalizationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFileId) {
      lastSourceNormalizationRef.current = null;
      return;
    }
    const file = activeFileRef.current ?? activeFile ?? null;
    if (!file) {
      return;
    }
    const stored =
      Array.isArray(file.sourceNames) && file.sourceNames.length > 0 ? file.sourceNames : [];
    if (stored.length === 0) {
      return;
    }
    const fileTileSetIds = Array.isArray(file.tileSetIds) ? file.tileSetIds : [];
    const inferredTileSetIds =
      fileTileSetIds.length > 0 ? fileTileSetIds : inferTileSetIdsFromSourceNames(stored);
    if (inferredTileSetIds.length === 0) {
      return;
    }
    const normalized = normalizeSourceNames(stored, inferredTileSetIds);
    const signature = `${inferredTileSetIds.join('|')}::${normalized.names.join('|')}`;
    if (lastSourceNormalizationRef.current === signature) {
      return;
    }
    const idsMatch =
      fileTileSetIds.length === inferredTileSetIds.length &&
      fileTileSetIds.every((id, index) => id === inferredTileSetIds[index]);
    if (!normalized.changed && idsMatch) {
      lastSourceNormalizationRef.current = signature;
      return;
    }
    lastSourceNormalizationRef.current = signature;
    if (
      fileSourceNames.length !== normalized.names.length ||
      fileSourceNames.some((name, index) => name !== normalized.names[index])
    ) {
      setFileSourceNames(normalized.names);
    }
    upsertActiveFile({
      tiles: file.tiles,
      gridLayout: file.grid,
      category: file.categories?.[0] ?? file.category ?? DEFAULT_CATEGORY,
      categories: file.categories ?? [file.category ?? DEFAULT_CATEGORY],
      tileSetIds: inferredTileSetIds,
      sourceNames: normalized.names,
      preferredTileSize: file.preferredTileSize,
      lineWidth: file.lineWidth,
      lineColor: file.lineColor,
      thumbnailUri: file.thumbnailUri,
      previewUri: file.previewUri,
    });
  }, [
    activeFileId,
    activeFile,
    fileSourceNames,
    inferTileSetIdsFromSourceNames,
    normalizeSourceNames,
    upsertActiveFile,
  ]);

  useEffect(() => {
    if (!activeFileId) {
      return;
    }
    if (isHydratingFile || pendingRestoreRef.current) {
      return;
    }
    if (!fileSourcesReadyRef.current) {
      return;
    }
    if (
      activeFile &&
      Array.isArray(activeFile.sourceNames) &&
      activeFile.sourceNames.length > 0 &&
      !isTileSetSourcesReadyForActiveFile
    ) {
      return;
    }
    if (!areActiveFileSourcesResolved) {
      return;
    }
    const nextNames = ensureFileSourceNames(paletteSources);
    if (nextNames.length === fileSourceNames.length) {
      return;
    }
    const fileSnapshot =
      activeFileRef.current ??
      filesRef.current.find((entry) => entry.id === activeFileId) ??
      null;
    const tilesSnapshot = fileSnapshot?.tiles ?? tiles;
    const gridSnapshot = fileSnapshot?.grid ?? gridLayout;
    upsertActiveFile({
      tiles: tilesSnapshot,
      gridLayout: gridSnapshot,
      tileSetIds:
        Array.isArray(fileSnapshot?.tileSetIds) && fileSnapshot.tileSetIds.length > 0
          ? fileSnapshot.tileSetIds
          : saveTileSetIds,
      sourceNames: nextNames,
      preferredTileSize: fileSnapshot?.preferredTileSize ?? fileTileSize,
      lineWidth: fileSnapshot?.lineWidth ?? activeLineWidth,
      lineColor: fileSnapshot?.lineColor ?? activeLineColor,
    });
  }, [
    paletteSources,
    activeFileId,
    isHydratingFile,
    fileSourceNames.length,
    ensureFileSourceNames,
    tiles,
    gridLayout,
    primaryCategory,
    activeCategories,
    selectedTileSetIds,
    fileTileSize,
    activeLineWidth,
    activeLineColor,
    saveTileSetIds,
    upsertActiveFile,
  ]);

  useEffect(() => {
    if (!ready || !activeFileId || viewMode !== 'modify') {
      return;
    }
    const file =
      activeFileRef.current ??
      filesRef.current.find((entry) => entry.id === activeFileId) ??
      null;
    if (!file) {
      setHydrating(false);
      setSuspendTiles(false);
      return;
    }
    const resolvedCategories = normalizeCategories(
      file.categories && file.categories.length > 0
        ? file.categories
        : file.category
          ? [file.category]
          : []
    );
    if (
      !file.categories ||
      file.categories.length !== resolvedCategories.length ||
      file.categories.some((value, index) => value !== resolvedCategories[index])
    ) {
      upsertActiveFile({
        tiles: file.tiles,
        gridLayout: {
          rows: file.grid.rows,
          columns: file.grid.columns,
          tileSize: file.preferredTileSize,
        },
        category: resolvedCategories[0] ?? DEFAULT_CATEGORY,
        categories: resolvedCategories,
        preferredTileSize: file.preferredTileSize,
        lineWidth: file.lineWidth,
        lineColor: file.lineColor,
      });
    }
    const nextToken = loadTokenRef.current + 1;
    loadTokenRef.current = nextToken;
    setLoadToken(nextToken);
    setLoadedToken(0);
    const previewUri = getFilePreviewUri(file);
    setLoadPreviewUri(previewUri);
    setHydrating(true);
    setSuspendTiles(true);
    clearCloneSource();
    if (brush.mode === 'clone' || brush.mode === 'pattern') {
      setBrush({ mode: 'random' });
    }
    if (file.tiles.length === 0) {
      resetTiles();
    }
    const fileSourceNames = Array.isArray(file.sourceNames) ? file.sourceNames : [];
    pendingRestoreRef.current = {
      fileId: file.id,
      tiles: file.tiles,
      rows: file.grid.rows,
      columns: file.grid.columns,
      preferredTileSize: file.preferredTileSize,
      categories: resolvedCategories,
      token: nextToken,
      preview: Boolean(previewUri),
      sourceNames: fileSourceNames.length > 0 ? fileSourceNames : undefined,
    };
  }, [activeFileId, loadRequestId, ready, viewMode, clearCloneSource]);

  useEffect(() => {
    setGridStabilized(false);
    if (Platform.OS !== 'web') {
      setNativeCanvasPaintReady(false);
    }
  }, [activeFileId, loadToken, viewMode]);
  useEffect(() => {
    if (viewMode !== 'modify') {
      setSourcesStable(false);
      return;
    }
    setSourcesStable(false);
    const timeout = setTimeout(() => {
      setSourcesStable(true);
    }, 200);
    return () => {
      clearTimeout(timeout);
    };
  }, [tileSourcesSignature, viewMode, activeFileId]);
  useEffect(() => {
    if (viewMode !== 'modify') {
      setTileSourcesPrefetched(false);
      setIsPrefetchingTileSources(false);
      return;
    }
    setTileSourcesPrefetched(false);
    setIsPrefetchingTileSources(false);
  }, [tileSourcesPrefetchKey, viewMode]);
  useEffect(() => {
    if (viewMode !== 'modify') {
      setTilesStable(false);
      return;
    }
    setTilesStable(false);
    const timeout = setTimeout(() => {
      setTilesStable(true);
    }, 200);
    return () => {
      clearTimeout(timeout);
    };
  }, [tilesSignature, viewMode, activeFileId]);
  useEffect(() => {
    if (viewMode !== 'modify' || !showGrid) {
      setGridStabilized(false);
      return;
    }
    const isNativeWithPreview =
      Platform.OS !== 'web' && Boolean(loadPreviewUri || clearPreviewUri);
    if (isNativeWithPreview && !nativeCanvasPaintReady) {
      const delayMs = isExpoGo ? 1800 : 2500;
      const timeout = setTimeout(() => {
        setNativeCanvasPaintReady(true);
      }, delayMs);
      return () => clearTimeout(timeout);
    }
    let raf1: number | null = null;
    let raf2: number | null = null;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setGridStabilized(true);
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
    showGrid,
    loadPreviewUri,
    clearPreviewUri,
    nativeCanvasPaintReady,
  ]);

  useEffect(() => {
    if (viewMode !== 'modify' || !activeFile || isInteractingRef.current) {
      return;
    }
    let cancelled = false;
    setIsPrefetchingTiles(true);
    const sources = [ERROR_TILE, ...paletteSources.map((tile) => tile.source)];
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
  }, [viewMode, activeFileId, paletteSources, isInteracting]);

  useEffect(() => {
    if (viewMode !== 'modify' || !activeFile || isInteractingRef.current) {
      return;
    }
    let cancelled = false;
    const names =
      activeFileSourceNames.length > 0 ? activeFileSourceNames : fileSourceNames;
    const sources = [
      ERROR_TILE,
      ...names
        .map((name) => resolveSourceName(name, activeFileTileSetIds))
        .filter(Boolean)
        .map((source) => source!.source),
    ];
    const prefetchKey = tileSourcesPrefetchKey;
    setIsPrefetchingTileSources(true);
    const timeout = setTimeout(() => {
      if (cancelled || isInteractingRef.current) {
        return;
      }
      void (async () => {
        try {
          await prefetchTileAssets(sources);
        } finally {
          if (!cancelled && prefetchKey === tileSourcesPrefetchKey) {
            setTileSourcesPrefetched(true);
            setIsPrefetchingTileSources(false);
          }
        }
      })();
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [
    viewMode,
    activeFileId,
    loadToken,
    activeFileSourceNames,
    fileSourceNames,
    resolveSourceName,
    activeFileTileSetIds,
    isInteracting,
    tileSourcesPrefetchKey,
  ]);

  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || activeFileId !== pending.fileId) {
      return;
    }
    const pendingShape = {
      rows: pending.rows,
      columns: pending.columns,
      tiles: pending.tiles,
    };
    const gridLayoutShape = {
      rows: gridLayout.rows,
      columns: gridLayout.columns,
      tileSize: gridLayout.tileSize,
    };
    const tileSizeReady = gridLayout.tileSize > 0;
    const fallbackGridShape =
      !tileSizeReady && typeof (pending as { preferredTileSize?: number }).preferredTileSize === 'number'
        ? {
            rows: pending.rows,
            columns: pending.columns,
            tileSize: (pending as { preferredTileSize: number }).preferredTileSize,
          }
        : tileSizeReady
          ? null
          : { rows: pending.rows, columns: pending.columns, tileSize: 45 };
    const shapeForApply = tileSizeReady ? gridLayoutShape : fallbackGridShape;
    if (shapeForApply && canApplyNonEmptyRestore(pendingShape, shapeForApply)) {
      const nameSource =
        pending.sourceNames && pending.sourceNames.length > 0
          ? pending.sourceNames
          : activeFileSourceNames;
      const hydrated =
        nameSource.length > 0
          ? hydrateTilesWithSourceNames(pending.tiles, nameSource)
          : pending.tiles;
      loadTiles(hydrated);
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
    if (shapeForApply && canApplyEmptyNewFileRestore(pendingShape, shapeForApply)) {
      resetTiles();
      pendingRestoreRef.current = null;
      setHydrating(false);
      setSuspendTiles(false);
      setLoadedToken(pending.token ?? 0);
    }
  }, [
    activeFileId,
    gridLayout.tileSize,
    gridLayout.columns,
    gridLayout.rows,
    loadTiles,
    setHydrating,
    loadToken,
    activeFileSourceNames,
  ]);

  useEffect(() => {
    if (!ready || !activeFileId || viewMode !== 'modify') {
      return;
    }
    if (!isReadyLatched) {
      return;
    }
    const pending = pendingRestoreRef.current;
    if (suppressAutosaveRef.current) {
      return;
    }
    if (isInteractingRef.current) {
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
                strokeScaleByName,
                maxDimension: FILE_THUMB_SIZE,
              })
            : undefined;
        const resolvedSourceNames =
          activeFileSourceNames.length > 0
            ? activeFileSourceNames
            : fileSourceNames.length > 0
              ? fileSourceNames
              : [];
        if (fileSourceNames.length === 0 && resolvedSourceNames.length > 0) {
          setFileSourceNames(resolvedSourceNames);
        }
        const payload: Parameters<typeof upsertActiveFile>[0] = {
          tiles,
          gridLayout,
          category: primaryCategory,
          categories: activeCategories,
          preferredTileSize: fileTileSize,
          thumbnailUri,
          tileSetIds: saveTileSetIds,
        };
        if (resolvedSourceNames.length > 0) {
          payload.sourceNames = resolvedSourceNames;
        }
        upsertActiveFile(payload);
      })();
    }, 150);
    if (previewSaveTimeoutRef.current) {
      clearTimeout(previewSaveTimeoutRef.current);
    }
    if (Platform.OS === 'web') {
      previewSaveTimeoutRef.current = setTimeout(() => {
        void (async () => {
          if (
            suppressAutosaveRef.current ||
            isHydratingFile ||
            viewMode !== 'modify' ||
            isInteractingRef.current
          ) {
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
            strokeScaleByName,
            maxDimension: 0,
            format: 'image/png',
            quality: 1,
          });
          if (!previewUri) {
            return;
          }
          const resolvedSourceNames =
            activeFileSourceNames.length > 0
              ? activeFileSourceNames
              : fileSourceNames.length > 0
                ? fileSourceNames
                : [];
          if (fileSourceNames.length === 0 && resolvedSourceNames.length > 0) {
            setFileSourceNames(resolvedSourceNames);
          }
          const payload: Parameters<typeof upsertActiveFile>[0] = {
            tiles,
            gridLayout,
            category: primaryCategory,
            categories: activeCategories,
            preferredTileSize: fileTileSize,
            previewUri,
            tileSetIds: saveTileSetIds,
          };
          if (resolvedSourceNames.length > 0) {
            payload.sourceNames = resolvedSourceNames;
          }
          upsertActiveFile(payload);
        })();
      }, 800);
    } else {
      previewSaveTimeoutRef.current = setTimeout(() => {
        void (async () => {
          if (
            suppressAutosaveRef.current ||
            isHydratingFile ||
            viewMode !== 'modify' ||
            isInteractingRef.current ||
            !gridVisible ||
            isCapturingPreview
          ) {
            return;
          }
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
              const ts = Date.now();
              const target = buildPreviewPath(PREVIEW_DIR, activeFileId, 'full', ts);
              try {
                if (activeFile?.previewUri && isOwnPreviewUri(activeFile.previewUri, PREVIEW_DIR)) {
                  await FileSystem.deleteAsync(activeFile.previewUri, { idempotent: true });
                }
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
              width: FILE_THUMB_SIZE,
              height: FILE_THUMB_SIZE,
            });
            if (thumbUri) {
              const ts = Date.now();
              const thumbTarget = buildPreviewPath(PREVIEW_DIR, activeFileId, 'thumb', ts);
              try {
                if (activeFile?.thumbnailUri && isOwnPreviewUri(activeFile.thumbnailUri, PREVIEW_DIR)) {
                  await FileSystem.deleteAsync(activeFile.thumbnailUri, { idempotent: true });
                }
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
          if (!previewUri && !thumbnailUri) {
            return;
          }
          const resolvedSourceNames =
            activeFileSourceNames.length > 0
              ? activeFileSourceNames
              : fileSourceNames.length > 0
                ? fileSourceNames
                : [];
          if (fileSourceNames.length === 0 && resolvedSourceNames.length > 0) {
            setFileSourceNames(resolvedSourceNames);
          }
          const payload: Parameters<typeof upsertActiveFile>[0] = {
            tiles,
            gridLayout,
            category: primaryCategory,
            categories: activeCategories,
            preferredTileSize: fileTileSize,
            previewUri,
            thumbnailUri,
            tileSetIds: saveTileSetIds,
          };
          if (resolvedSourceNames.length > 0) {
            payload.sourceNames = resolvedSourceNames;
          }
          upsertActiveFile(payload);
        })();
      }, 1200);
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (previewSaveTimeoutRef.current) {
        clearTimeout(previewSaveTimeoutRef.current);
        previewSaveTimeoutRef.current = null;
      }
    };
  }, [
    tiles,
    gridLayout,
    primaryCategory,
    activeCategories,
    fileTileSize,
    fileSourceNames,
    activeFileSourceNames,
    tileSources,
    activeLineColor,
    activeLineWidth,
    ready,
    activeFileId,
    activeFile?.previewUri,
    activeFile?.thumbnailUri,
    upsertActiveFile,
    isHydratingFile,
    gridVisible,
    isCapturingPreview,
    viewMode,
    isInteracting,
    saveTileSetIds,
    strokeScaleByName,
  ]);

  useEffect(() => {
    if (!interactionPendingRef.current || !interactionStartRef.current) {
      return;
    }
    const { id, time } = interactionStartRef.current;
    const now = Date.now();
    interactionPendingRef.current = false;
  }, [tiles]);

  // On web, attach a non-passive touchmove listener so we can preventDefault() during
  // touch drag (e.g. iOS Safari), otherwise the page scrolls instead of drawing.
  useEffect(() => {
    if (!isWeb) {
      return;
    }
    const node = gridRef.current as any;
    if (!node) {
      return;
    }
    const el: HTMLElement | null =
      typeof node?.addEventListener === 'function'
        ? node
        : node?.getNativeRef?.() ?? node?._wrapperRef?.current ?? node?._node ?? null;
    if (!el || typeof el.addEventListener !== 'function') {
      return;
    }
    const onTouchMove = (e: TouchEvent) => {
      if (isTouchDragActiveRef.current) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [isWeb]);

  const getRelativePoint = (event: any) => {
    if (isWeb) {
      const nativeEvent = event?.nativeEvent ?? event;
      const target = event?.currentTarget;
      if (!target?.getBoundingClientRect) {
        return null;
      }
      const rect = target.getBoundingClientRect();
      // Prefer touch coordinates when present (mobile Safari and other touch browsers)
      const touch = nativeEvent?.touches?.[0];
      const clientX =
        (touch?.clientX ?? touch?.pageX) ??
        nativeEvent?.clientX ??
        nativeEvent?.pageX ??
        event?.clientX;
      const clientY =
        (touch?.clientY ?? touch?.pageY) ??
        nativeEvent?.clientY ??
        nativeEvent?.pageY ??
        event?.clientY;
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        return { x: clientX - rect.left, y: clientY - rect.top };
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

  const getSelectionBounds = (startIndex: number, endIndex: number) => {
    const startRow = Math.floor(startIndex / gridLayout.columns);
    const startCol = startIndex % gridLayout.columns;
    const endRow = Math.floor(endIndex / gridLayout.columns);
    const endCol = endIndex % gridLayout.columns;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return { minRow, maxRow, minCol, maxCol };
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
        })();
      });
    });
  };

  const handlePaintAt = (x: number, y: number) => {
    const cellIndex = getCellIndexForPoint(x, y);
    if (cellIndex === null) {
      return;
    }
    if (
      brush.mode === 'pattern' &&
      !isPatternCreationMode &&
      patternAnchorIndex === null
    ) {
      setPatternAnchorIndex(cellIndex);
    }
    paintCellIndex(cellIndex);
  };

  const patternSelectionRect = useMemo(() => {
    if (!patternSelection || gridLayout.columns === 0) {
      return null;
    }
    const { minRow, maxRow, minCol, maxCol } = getSelectionBounds(
      patternSelection.start,
      patternSelection.end
    );
    const tileStride = gridLayout.tileSize + GRID_GAP;
    const width =
      (maxCol - minCol + 1) * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    const height =
      (maxRow - minRow + 1) * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    return {
      left: minCol * tileStride,
      top: minRow * tileStride,
      width,
      height,
    };
  }, [patternSelection, gridLayout.columns, gridLayout.tileSize, gridLayout.rows]);
  const patternAlignmentRect = useMemo(() => {
    if (
      brush.mode !== 'pattern' ||
      isPatternCreationMode ||
      !selectedPattern ||
      patternAnchorIndex === null ||
      gridLayout.columns === 0
    ) {
      return null;
    }
    const rotationCW =
      ((patternRotations[selectedPattern.id] ?? 0) + 360) % 360;
    const widthCells =
      rotationCW % 180 === 0 ? selectedPattern.width : selectedPattern.height;
    const heightCells =
      rotationCW % 180 === 0 ? selectedPattern.height : selectedPattern.width;
    if (widthCells <= 0 || heightCells <= 0) {
      return null;
    }
    const anchorRow = Math.floor(patternAnchorIndex / gridLayout.columns);
    const anchorCol = patternAnchorIndex % gridLayout.columns;
    const tileStride = gridLayout.tileSize + GRID_GAP;
    const width = widthCells * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    const height = heightCells * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    return {
      left: anchorCol * tileStride,
      top: anchorRow * tileStride,
      width,
      height,
    };
  }, [
    brush.mode,
    isPatternCreationMode,
    selectedPattern,
    patternAnchorIndex,
    patternRotations,
    gridLayout.columns,
    gridLayout.tileSize,
  ]);

  const handleSavePattern = () => {
    if (!patternSelection || gridLayout.columns === 0) {
      setShowPatternSaveModal(false);
      return;
    }
    const { minRow, maxRow, minCol, maxCol } = getSelectionBounds(
      patternSelection.start,
      patternSelection.end
    );
    const width = maxCol - minCol + 1;
    const height = maxRow - minRow + 1;
    if (width <= 0 || height <= 0) {
      setShowPatternSaveModal(false);
      return;
    }
    const nextTiles: Tile[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * gridLayout.columns + col;
        const tile = tiles[index] ?? {
          imageIndex: -1,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
        };
        nextTiles.push({ ...tile });
      }
    }
    const patternId = createPattern({
      category: primaryCategory,
      width,
      height,
      tiles: nextTiles,
    });
    setSelectedPatternId(patternId);
    setIsPatternCreationMode(false);
    setPatternSelection(null);
    setShowPatternSaveModal(false);
    setBrush({ mode: 'pattern' });
    setShowPatternChooser(false);
  };

  const handleCancelPattern = () => {
    setShowPatternSaveModal(false);
    setPatternSelection(null);
    setIsPatternCreationMode(false);
    setShowPatternChooser(false);
    setBrush({ mode: 'pattern' });
  };

  const pendingPatternPreview = useMemo(() => {
    if (!patternSelection || gridLayout.columns === 0) {
      return null;
    }
    const { minRow, maxRow, minCol, maxCol } = getSelectionBounds(
      patternSelection.start,
      patternSelection.end
    );
    const width = maxCol - minCol + 1;
    const height = maxRow - minRow + 1;
    if (width <= 0 || height <= 0) {
      return null;
    }
    const tileSize = Math.max(
      8,
      Math.floor(120 / Math.max(1, height))
    );
    const tilesPreview: Array<{
      tile: Tile;
      index: number;
    }> = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * gridLayout.columns + col;
        tilesPreview.push({
          tile:
            tiles[index] ?? {
              imageIndex: -1,
              rotation: 0,
              mirrorX: false,
              mirrorY: false,
            },
          index,
        });
      }
    }
    return {
      width,
      height,
      tileSize,
      tiles: tilesPreview,
    };
  }, [patternSelection, gridLayout.columns, tiles]);

  const persistActiveFileNow = async () => {
    if (!ready || !activeFileId || viewMode !== 'modify') {
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
          const ts = Date.now();
          const target = buildPreviewPath(PREVIEW_DIR, activeFileId, 'full', ts);
          try {
            if (activeFile?.previewUri && isOwnPreviewUri(activeFile.previewUri, PREVIEW_DIR)) {
              await FileSystem.deleteAsync(activeFile.previewUri, { idempotent: true });
            }
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
          width: FILE_THUMB_SIZE,
          height: FILE_THUMB_SIZE,
        });
        if (thumbUri) {
          const ts = Date.now();
          const thumbTarget = buildPreviewPath(PREVIEW_DIR, activeFileId, 'thumb', ts);
          try {
            if (activeFile?.thumbnailUri && isOwnPreviewUri(activeFile.thumbnailUri, PREVIEW_DIR)) {
              await FileSystem.deleteAsync(activeFile.thumbnailUri, { idempotent: true });
            }
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
        category: primaryCategory,
        categories: activeCategories,
        preferredTileSize: fileTileSize,
        thumbnailUri,
        previewUri,
        tileSetIds: saveTileSetIds,
        sourceNames:
          fileSourceNames.length > 0
            ? fileSourceNames
            : tileSources.map((source) => source.name),
      });
      if (fileSourceNames.length === 0 && tileSources.length > 0) {
        setFileSourceNames(tileSources.map((source) => source.name));
      }
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
      strokeScaleByName,
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
      strokeScaleByName,
      maxDimension: FILE_THUMB_SIZE,
    });
    upsertActiveFile({
      tiles,
      gridLayout,
      category: primaryCategory,
      categories: activeCategories,
      preferredTileSize: fileTileSize,
      thumbnailUri,
      previewUri,
      tileSetIds: saveTileSetIds,
      sourceNames:
        fileSourceNames.length > 0
          ? fileSourceNames
          : tileSources.map((source) => source.name),
    });
    if (fileSourceNames.length === 0 && tileSources.length > 0) {
      setFileSourceNames(tileSources.map((source) => source.name));
    }
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
      const sources = getSourcesForFile(downloadTargetFile);
      const fileTileSetIds = Array.isArray(downloadTargetFile.tileSetIds)
        ? downloadTargetFile.tileSetIds
        : [];
      const total = downloadTargetFile.grid.rows * downloadTargetFile.grid.columns;
      const normalized = normalizeTiles(downloadTargetFile.tiles, total, sources.length);
      expected = normalized.filter(
        (tile) =>
          resolveTileAssetForFile(tile, sources, fileTileSetIds).source !== null
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
    setLoadRequestId((prev) => prev + 1);
    setLoadPreviewUri(getFilePreviewUri(file));
    setSuspendTiles(true);
    setHydrating(true);
    setActive(file.id);
    setViewMode('modify');
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedFileIds(new Set());
    setIsSelectMode(false);
  };

  const deleteSelectedFiles = () => {
    if (selectedFileIds.size === 0) {
      clearSelection();
      return;
    }
    selectedFileIds.forEach((fileId) => {
      deleteFile(fileId);
    });
    clearSelection();
  };

  const toggleSelectPattern = (patternId: string) => {
    setSelectedPatternIds((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) {
        next.delete(patternId);
      } else {
        next.add(patternId);
      }
      return next;
    });
  };

  const clearPatternSelection = () => {
    setSelectedPatternIds(new Set());
    setIsPatternSelectMode(false);
  };

  const deleteSelectedPatterns = () => {
    if (selectedPatternIds.size === 0) {
      clearPatternSelection();
      return;
    }
    deletePatterns(Array.from(selectedPatternIds));
    clearPatternSelection();
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
      const sources = getSourcesForFile(downloadTargetFile);
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
        strokeScaleByName,
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

  const fileGridAvailableWidth = Math.max(
    0,
    contentWidth - FILE_GRID_SIDE_PADDING * 2
  );
  const fileGridMinCardWidth =
    isWeb && contentWidth >= FILE_VIEW_DESKTOP_BREAKPOINT
      ? FILE_GRID_MIN_CARD_WIDTH_DESKTOP_WEB
      : FILE_GRID_MIN_CARD_WIDTH;
  const fileGridColumnCount = Math.max(
    1,
    Math.floor(
      (fileGridAvailableWidth + FILE_GRID_GAP) /
        (fileGridMinCardWidth + FILE_GRID_GAP)
    )
  );
  const fileCardWidth = Math.floor(
    (fileGridAvailableWidth -
      FILE_GRID_GAP * (fileGridColumnCount - 1)) /
      fileGridColumnCount
  );
  const fileThumbDisplayCap =
    isWeb && contentWidth >= FILE_VIEW_DESKTOP_BREAKPOINT
      ? FILE_THUMB_SIZE * 2
      : FILE_THUMB_SIZE;
  const fileView = (
    <ThemedView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
          display: viewMode === 'file' ? 'flex' : 'none',
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
          <Pressable
            onPress={() => {
              router.push('/tileSetCreator');
            }}
            accessibilityRole="button"
            accessibilityLabel="Open tile sets"
          >
            <ThemedText type="title" style={styles.fileTitle}>
              File
            </ThemedText>
          </Pressable>
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
              label="Select files"
              icon="checkbox-marked-outline"
              color="#fff"
              onPress={() => {
                setIsSelectMode(true);
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
            onPress={deleteSelectedFiles}
            style={styles.fileSelectDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete selected files"
          >
            <ThemedText type="defaultSemiBold" style={styles.fileSelectDeleteText}>
              Delete
            </ThemedText>
          </Pressable>
          <ThemedText type="defaultSemiBold" style={styles.fileSelectCount}>
            {selectedFileIds.size > 0 ? `${selectedFileIds.size} selected` : ''}
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
          {[...files]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((file) => {
            const sources = getSourcesForFile(file);
            const thumbAspect =
              file.grid.columns > 0 && file.grid.rows > 0
                ? file.grid.columns / file.grid.rows
                : 1;
            let thumbWidth = fileCardWidth;
            let thumbHeight = fileCardWidth / thumbAspect;
            if (isWeb && (thumbWidth > fileThumbDisplayCap || thumbHeight > fileThumbDisplayCap)) {
              const scale = fileThumbDisplayCap / Math.max(thumbWidth, thumbHeight);
              thumbWidth = Math.round(thumbWidth * scale);
              thumbHeight = Math.round(thumbHeight * scale);
            }
            const fileThumbSizeStyle = isWeb
              ? { width: thumbWidth, height: thumbHeight }
              : { width: fileCardWidth, aspectRatio: thumbAspect };
            return (
              <Pressable
                key={file.id}
                style={[styles.fileCard, { width: fileCardWidth }]}
                onPress={() => {
                  if (isSelectMode) {
                    toggleSelectFile(file.id);
                  } else {
                    void openFileInModifyView(file.id);
                  }
                }}
                onLongPress={() => {
                  if (isSelectMode) {
                    return;
                  }
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
                    selectedFileIds.has(file.id) && styles.fileThumbSelected,
                    fileThumbSizeStyle,
                  ]}
                >
                  {hasCachedThumbnail(file) ? (
                    <TileAsset
                      source={{
                        uri: file.thumbnailUri ?? file.previewUri ?? undefined,
                      }}
                      name="thumbnail.png"
                      style={styles.fileThumbImage}
                      resizeMode="cover"
                    />
                  ) : Platform.OS !== 'web' ? (
                    <ThemedView style={styles.fileThumbGrid}>
                      {Array.from({ length: file.grid.rows }, (_, rowIndex) => (
                        <ThemedView
                          key={`row-${file.id}-${rowIndex}`}
                          style={styles.fileThumbRow}
                        >
                          {Array.from({ length: file.grid.columns }, (_, colIndex) => {
                            const index = rowIndex * file.grid.columns + colIndex;
                            const tile = file.tiles[index];
                            const resolved = resolveTileAssetForFile(
                              tile,
                              sources,
                              file.tileSetIds ?? []
                            );
                            return (
                              <ThemedView
                                key={`cell-${file.id}-${index}`}
                                style={styles.fileThumbCell}
                              >
                                {resolved.source && (
                                  <TileAsset
                                    source={resolved.source}
                                    name={resolved.name}
                                    strokeColor={file.lineColor}
                                    strokeWidth={
                                      file.lineWidth *
                                      (strokeScaleByName?.get(resolved.name) ?? 1)
                                    }
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
                  ) : (
                    <ThemedView style={styles.fileThumbPlaceholder} />
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
                    const sources = getSourcesForFile(downloadTargetFile);
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
                              const resolved = resolveTileAssetForFile(
                                tile,
                                sources,
                                downloadTargetFile.tileSetIds ?? []
                              );
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
                                  {resolved.source && (
                                    <TileAsset
                                      source={resolved.source}
                                      name={resolved.name}
                                      strokeColor={downloadTargetFile.lineColor}
                                      strokeWidth={
                                        downloadTargetFile.lineWidth *
                                        (strokeScaleByName?.get(resolved.name) ?? 1)
                                      }
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
                      const sources = getSourcesForFile(file);
                      void downloadFile(file, sources, {
                        backgroundColor: includeDownloadBackground
                          ? settings.backgroundColor
                          : undefined,
                        strokeScaleByName,
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
                      const sources = getSourcesForFile(file);
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
                        strokeScaleByName,
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
                      const initialSources = getSourcesForSelection(
                        activeCategories,
                        selectedTileSetIds
                      ).map((source) => source.name);
                      createFile(DEFAULT_CATEGORY, size, {
                        lineWidth: activeLineWidth,
                        lineColor: activeLineColor,
                        tileSetIds: selectedTileSetIds,
                        sourceNames: initialSources,
                      });
                      setFileSourceNames(initialSources);
                      setLoadRequestId((prev) => prev + 1);
                      setLoadPreviewUri(null);
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
          <ThemedView
            style={[styles.settingsScreen, { paddingTop: insets.top }]}
            accessibilityRole="dialog"
          >
            <ThemedView style={styles.settingsHeader}>
              <ThemedText type="title">Settings</ThemedText>
              <Pressable
                onPress={() => setShowSettingsOverlay(false)}
                style={styles.settingsClose}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <ThemedText type="defaultSemiBold">X</ThemedText>
              </Pressable>
            </ThemedView>
            <ScrollView
              style={styles.settingsScroll}
              contentContainerStyle={styles.settingsContent}
              showsVerticalScrollIndicator
            >
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">Allow Border Connections</ThemedText>
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
              <TouchableOpacity
                style={[styles.settingsAction, styles.settingsActionDanger]}
                onPress={() => {
                  const message =
                    'Delete all local data? This will permanently delete all saved files, tile sets, patterns, and favorites. This cannot be undone.';
                  const doDelete = async () => {
                    await clearAllLocalData();
                    await clearAllFiles();
                    await reloadTileSets();
                    clearBrushFavorites();
                    await clearAllPatterns();
                    setShowSettingsOverlay(false);
                    setViewMode('file');
                  };
                  if (Platform.OS === 'web') {
                    if (window.confirm(message)) {
                      void doDelete();
                    }
                  } else {
                    Alert.alert('Delete all local data?', message.trim(), [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete all', style: 'destructive', onPress: () => void doDelete() },
                    ]);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Delete all local data"
                activeOpacity={0.7}
              >
                <ThemedText type="defaultSemiBold" style={styles.settingsActionDangerText}>
                  Delete all local data
                </ThemedText>
              </TouchableOpacity>
              {DEBUG_FILE_CHECK && (
                <Pressable
                  style={styles.settingsAction}
                  onPress={handleCheckUgcFile}
                  accessibilityRole="button"
                  accessibilityLabel="Check UGC file path"
                >
                  <ThemedText type="defaultSemiBold">Check UGC File</ThemedText>
                </Pressable>
              )}
              {DEBUG_FILE_CHECK && lastFileCheck ? (
                <ThemedText type="defaultSemiBold">{lastFileCheck}</ThemedText>
              ) : null}
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
            </ScrollView>
          </ThemedView>
        )}
    </ThemedView>
  );

  const modifyView = (
    <ThemedView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
          display: viewMode === 'file' ? 'none' : 'flex',
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
                persistActiveFileNow();
                setViewMode('file');
              }}
            />
            <ThemedView style={styles.controls}>
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
              label="Flood"
              icon="format-color-fill"
              onPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                }
                pendingFloodCompleteRef.current = setTimeout(() => {
                  pendingFloodCompleteRef.current = null;
                  floodFill();
                }, 0);
              }}
              onLongPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                floodComplete();
              }}
            />
            <ToolbarButton
              label="Reconcile"
              icon="puzzle"
              onPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                reconcileTiles();
              }}
              onLongPress={() => {
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                controlledRandomize();
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
            Platform.OS === 'web' && styles.gridCanvasWebCenter,
          ]}
        >
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
          {showPreview && (loadPreviewUri || clearPreviewUri) && (
            <>
              {isTransparentPreview(clearPreviewUri ?? loadPreviewUri) && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.gridPreviewBackdrop,
                    { backgroundColor: settings.backgroundColor },
                  ]}
                />
              )}
              {Platform.OS === 'web' ? (
                <Image
                  source={{ uri: clearPreviewUri ?? loadPreviewUri ?? undefined }}
                  style={styles.gridPreview}
                  resizeMode="cover"
                  pointerEvents="none"
                />
              ) : (
                <ExpoImage
                  source={{ uri: clearPreviewUri ?? loadPreviewUri ?? '' }}
                  style={styles.gridPreview}
                  contentFit="cover"
                  pointerEvents="none"
                />
              )}
            </>
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
          {isPatternCreationMode && patternSelectionRect && (
            <View
              pointerEvents="none"
              style={[styles.patternSelection, patternSelectionRect]}
            />
          )}
          {patternAlignmentRect && (
            <View
              pointerEvents="none"
              style={[styles.patternAlignment, patternAlignmentRect]}
            />
          )}
          {Platform.OS === 'web' ? (
            <ThemedView
              ref={setGridNode}
              style={[styles.grid, { opacity: gridVisible ? 1 : 0 }]}
              accessibilityRole="grid"
              pointerEvents={gridVisible && !isClearing ? 'auto' : 'none'}
              onLayout={(event: any) => {
                const layout = event?.nativeEvent?.layout;
                if (layout) {
                  gridOffsetRef.current = { x: layout.x ?? 0, y: layout.y ?? 0 };
                } else {
                  gridOffsetRef.current = { x: 0, y: 0 };
                }
              }}
                onMouseDown={(event: any) => {
                  if (isWeb && ignoreNextMouseRef.current) {
                    return;
                  }
                  setInteracting(true);
                  markInteractionStart();
                  const point = getRelativePoint(event);
                if (point) {
                  const cellIndex = getCellIndexForPoint(point.x, point.y);
                  if (cellIndex === null) {
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
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
                    if (isPatternCreationMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        setPatternSelection((prev) =>
                          prev ? { ...prev, end: cellIndex } : prev
                        );
                      }
                      return;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                }
              }}
              onMouseLeave={() => {
                setInteracting(false);
                lastPaintedRef.current = null;
              }}
              onMouseUp={() => {
                setInteracting(false);
                if (isPatternCreationMode) {
                  if (patternSelection) {
                    setShowPatternSaveModal(true);
                  }
                  return;
                }
                lastPaintedRef.current = null;
              }}
              onTouchStart={(event: any) => {
                isTouchDragActiveRef.current = true;
                if (isWeb) {
                  ignoreNextMouseRef.current = true;
                  if (ignoreMouseAfterTouchTimeoutRef.current) {
                    clearTimeout(ignoreMouseAfterTouchTimeoutRef.current);
                  }
                  ignoreMouseAfterTouchTimeoutRef.current = setTimeout(() => {
                    ignoreNextMouseRef.current = false;
                    ignoreMouseAfterTouchTimeoutRef.current = null;
                  }, 400);
                }
                setInteracting(true);
                markInteractionStart();
                const point = getRelativePoint(event);
                if (point) {
                  const cellIndex = getCellIndexForPoint(point.x, point.y);
                  if (cellIndex === null) {
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
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
              onTouchMove={(event: any) => {
                if (!isTouchDragActiveRef.current) {
                  return;
                }
                const point = getRelativePoint(event);
                if (point) {
                  if (isPatternCreationMode) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex !== null) {
                      setPatternSelection((prev) =>
                        prev ? { ...prev, end: cellIndex } : prev
                      );
                    }
                    return;
                  }
                  handlePaintAt(point.x, point.y);
                }
              }}
              onTouchEnd={() => {
                isTouchDragActiveRef.current = false;
                setInteracting(false);
                if (isPatternCreationMode) {
                  if (patternSelection) {
                    setShowPatternSaveModal(true);
                  }
                  return;
                }
                lastPaintedRef.current = null;
              }}
              onTouchCancel={() => {
                isTouchDragActiveRef.current = false;
                setInteracting(false);
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
                        tileSources={renderTileSources}
                        showDebug={settings.showDebug}
                        strokeColor={activeLineColor}
                        strokeWidth={activeLineWidth}
                        strokeScaleByName={strokeScaleByName}
                        atlas={gridAtlas}
                        resolveSourceForName={resolveSourceForName}
                        resolveUgcSourceFromName={buildUserTileSourceFromName}
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
                  opacity: gridVisible || isCapturingPreview ? 1 : 0,
                  width: gridWidth,
                  height: gridHeight,
                },
              ]}
              pointerEvents="none"
            >
              {useSkiaGrid ? (
                <TileGridCanvas
                  width={gridWidth}
                  height={gridHeight}
                  tileSize={gridLayout.tileSize}
                  rows={gridLayout.rows}
                  columns={gridLayout.columns}
                  tiles={displayTiles}
                  tileSources={renderTileSources}
                  errorSource={ERROR_TILE}
                  strokeColor={activeLineColor}
                  strokeWidth={activeLineWidth}
                  strokeScaleByName={strokeScaleByName}
                  showDebug={settings.showDebug}
                  showOverlays={showOverlays}
                  cloneSourceIndex={brush.mode === 'clone' ? cloneSourceIndex : null}
                  cloneSampleIndex={brush.mode === 'clone' ? cloneSampleIndex : null}
                  cloneAnchorIndex={brush.mode === 'clone' ? cloneAnchorIndex : null}
                  cloneCursorIndex={brush.mode === 'clone' ? cloneCursorIndex : null}
                  onPaintReady={
                    Platform.OS !== 'web'
                      ? () => setNativeCanvasPaintReady(true)
                      : undefined
                  }
                />
              ) : (
                rowIndices.map((rowIndex) => (
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
                          tileSources={renderTileSources}
                          showDebug={settings.showDebug}
                          strokeColor={activeLineColor}
                          strokeWidth={activeLineWidth}
                          strokeScaleByName={strokeScaleByName}
                          atlas={gridAtlas}
                          resolveSourceForName={resolveSourceForName}
                          resolveUgcSourceFromName={buildUserTileSourceFromName}
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
                ))
              )}
            </ViewShot>
              <View
                ref={gridTouchRef}
                style={StyleSheet.absoluteFillObject}
                pointerEvents={gridVisible && !isClearing ? 'auto' : 'none'}
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
                  setInteracting(true);
                  markInteractionStart();
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (isPatternCreationMode) {
                      setPatternSelection({ start: cellIndex, end: cellIndex });
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
                    if (isPatternCreationMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        setPatternSelection((prev) =>
                          prev ? { ...prev, end: cellIndex } : prev
                        );
                      }
                      return;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                }}
                onResponderRelease={() => {
                  setInteracting(false);
                  if (isPatternCreationMode) {
                    if (patternSelection) {
                      setShowPatternSaveModal(true);
                    }
                    return;
                  }
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
                  setInteracting(false);
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  if (isPatternCreationMode) {
                    return;
                  }
                  longPressTriggeredRef.current = false;
                  lastPaintedRef.current = null;
                }}
              />
            </>
          )}
          </View>
        </View>
        {isPatternCreationMode && !showPatternSaveModal && (
          <View
            pointerEvents="box-none"
            style={[
              styles.patternCreationOverlay,
              { top: 0, bottom: brushPanelHeight },
            ]}
          >
            <View style={styles.patternCreationTop} pointerEvents="auto">
              <ThemedText type="defaultSemiBold" style={styles.patternCreationText}>
                drag select to creat a pattern
              </ThemedText>
            </View>
          </View>
        )}
        {isPatternCreationMode && !showPatternSaveModal && (
          <View
            pointerEvents="auto"
            style={[
              styles.patternCreationBottom,
              { height: brushPanelHeight },
            ]}
          />
        )}
        <TileBrushPanel
          tileSources={paletteSources}
          selected={selectedPaletteBrush}
          strokeColor={activeLineColor}
          strokeWidth={activeLineWidth}
          strokeScaleByName={strokeScaleByName}
          atlas={brushAtlas}
          selectedPattern={
            selectedPattern
              ? {
                  tiles: selectedPattern.tiles,
                  width: selectedPattern.width,
                  height: selectedPattern.height,
                  rotation: patternRotations[selectedPattern.id] ?? 0,
                  mirrorX: patternMirrors[selectedPattern.id] ?? false,
                }
              : null
          }
          onSelect={(next) => {
            if (next.mode === 'clone') {
              clearCloneSource();
            }
            if (next.mode === 'pattern') {
              setIsPatternCreationMode(false);
              const shouldShowChooser =
                activePatterns.length === 0 || !selectedPattern;
              if (shouldShowChooser) {
                setShowPatternChooser(true);
              }
              setBrush(next);
              return;
            }
            if (next.mode === 'fixed') {
              const rotation = paletteRotations[next.index] ?? next.rotation ?? 0;
              const mirrorX = paletteMirrors[next.index] ?? next.mirrorX ?? false;
              const mirrorY = paletteMirrorsY[next.index] ?? next.mirrorY ?? false;
              const source = paletteSources[next.index];
              if (!source) {
                return;
              }
              let fileIndex = tileIndexByName.get(source.name) ?? -1;
              if (fileIndex < 0) {
                const updated = ensureFileSourceNames([source]);
                const updatedIndex = updated.indexOf(source.name);
                fileIndex = updatedIndex;
              }
              if (fileIndex >= 0) {
                fixedBrushSourceNameRef.current = source.name;
                setBrush({
                  mode: 'fixed',
                  index: fileIndex,
                  sourceName: source.name,
                  rotation,
                  mirrorX,
                  mirrorY,
                });
              }
            } else {
              if (next.mode !== 'fixed') {
                fixedBrushSourceNameRef.current = null;
              }
              setBrush(next);
            }
          }}
          onRotate={(index) =>
            setPaletteRotations((prev) => {
              const nextRotation = ((prev[index] ?? 0) + 90) % 360;
              const source = paletteSources[index];
              const fileIndex = source ? tileIndexByName.get(source.name) ?? -1 : -1;
              if (brush.mode === 'fixed' && fileIndex >= 0 && brush.index === fileIndex) {
                if (source?.name != null) {
                  fixedBrushSourceNameRef.current = source.name;
                }
                setBrush({
                  mode: 'fixed',
                  index: fileIndex,
                  sourceName: source?.name,
                  rotation: nextRotation,
                  mirrorX: brush.mirrorX,
                  mirrorY: brush.mirrorY,
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
              const source = paletteSources[index];
              const fileIndex = source ? tileIndexByName.get(source.name) ?? -1 : -1;
              if (brush.mode === 'fixed' && fileIndex >= 0 && brush.index === fileIndex) {
                if (source?.name != null) {
                  fixedBrushSourceNameRef.current = source.name;
                }
                setBrush({
                  mode: 'fixed',
                  index: fileIndex,
                  sourceName: source?.name,
                  rotation: brush.rotation,
                  mirrorX: nextMirror,
                  mirrorY: brush.mirrorY,
                });
              }
              return {
                ...prev,
                [index]: nextMirror,
              };
            })
          }
          onMirrorVertical={(index) =>
            setPaletteMirrorsY((prev) => {
              const nextMirror = !(prev[index] ?? false);
              const source = paletteSources[index];
              const fileIndex = source ? tileIndexByName.get(source.name) ?? -1 : -1;
              if (brush.mode === 'fixed' && fileIndex >= 0 && brush.index === fileIndex) {
                if (source?.name != null) {
                  fixedBrushSourceNameRef.current = source.name;
                }
                setBrush({
                  mode: 'fixed',
                  index: fileIndex,
                  sourceName: source?.name,
                  rotation: brush.rotation,
                  mirrorX: brush.mirrorX,
                  mirrorY: nextMirror,
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
          getMirrorVertical={(index) => paletteMirrorsY[index] ?? false}
          onPatternLongPress={() => {
            if (brush.mode !== 'pattern') {
              setBrush({ mode: 'pattern' });
            }
            setIsPatternCreationMode(false);
            setShowPatternChooser(true);
          }}
          onPatternDoubleTap={() => {
            if (brush.mode !== 'pattern') {
              setBrush({ mode: 'pattern' });
            }
            setIsPatternCreationMode(false);
            setShowPatternChooser(true);
          }}
          onRandomLongPress={() => {
            setShowTileSetChooser(true);
          }}
          onRandomDoubleTap={() => {
            setShowTileSetChooser(true);
          }}
          height={brushPanelHeight}
          itemSize={brushItemSize}
          rowGap={BRUSH_PANEL_ROW_GAP}
          rows={brushRows}
        />
        {showPatternModal && (
          <View style={styles.patternModal} accessibilityRole="dialog">
            <Pressable
              style={styles.patternModalBackdrop}
              onPress={() => {
                setIsPatternCreationMode(false);
                setShowPatternChooser(false);
                setBrush({ mode: 'pattern' });
                clearPatternSelection();
              }}
              accessibilityRole="button"
              accessibilityLabel="Close pattern picker"
            />
            <ThemedView style={styles.patternModalPanel}>
              <ThemedView style={styles.patternModalHeader}>
                <ThemedText type="title" style={styles.patternModalTitle}>
                  Patterns
                </ThemedText>
                <View style={styles.patternModalActions}>
                  <Pressable
                    onPress={() => {
                      setBrush({ mode: 'pattern' });
                      setIsPatternCreationMode(true);
                      setPatternSelection(null);
                      setShowPatternChooser(false);
                    }}
                    style={styles.patternHeaderIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Create new pattern"
                  >
                    <MaterialCommunityIcons name="plus" size={24} color="#fff" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setIsPatternSelectMode(true);
                    }}
                    style={styles.patternHeaderIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Select patterns"
                  >
                    <MaterialCommunityIcons
                      name="checkbox-marked-outline"
                      size={22}
                      color="#fff"
                    />
                  </Pressable>
                </View>
              </ThemedView>
              <Animated.View
                style={[
                  styles.patternSelectBar,
                  {
                    height: patternSelectAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, 44],
                    }),
                    opacity: patternSelectAnim,
                  },
                ]}
                pointerEvents={isPatternSelectMode ? 'auto' : 'none'}
              >
                <Pressable
                  onPress={deleteSelectedPatterns}
                  style={styles.patternSelectDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Delete selected patterns"
                >
                  <ThemedText type="defaultSemiBold" style={styles.patternSelectDeleteText}>
                    Delete
                  </ThemedText>
                </Pressable>
                <ThemedText type="defaultSemiBold" style={styles.patternSelectCount}>
                  {selectedPatternIds.size > 0
                    ? `${selectedPatternIds.size} selected`
                    : ''}
                </ThemedText>
                <Pressable
                  onPress={clearPatternSelection}
                  style={styles.patternSelectButton}
                  accessibilityRole="button"
                  accessibilityLabel="Exit selection mode"
                >
                  <ThemedText type="defaultSemiBold" style={styles.patternSelectExitText}>
                    X
                  </ThemedText>
                </Pressable>
              </Animated.View>
              <ScrollView
                style={styles.patternModalScroll}
                contentContainerStyle={styles.patternModalContent}
                showsVerticalScrollIndicator
              >
                {activePatterns.map((pattern) => {
                  const rotationCW =
                    ((patternRotations[pattern.id] ?? 0) + 360) % 360;
                  const rotationCCW = (360 - rotationCW) % 360;
                  const mirrorX = patternMirrors[pattern.id] ?? false;
                  const rotatedWidth =
                    rotationCW % 180 === 0 ? pattern.width : pattern.height;
                  const rotatedHeight =
                    rotationCW % 180 === 0 ? pattern.height : pattern.width;
                  const tileSize = Math.max(
                    8,
                    Math.floor(
                      (PATTERN_THUMB_HEIGHT - PATTERN_THUMB_PADDING * 2) /
                        Math.max(1, rotatedHeight)
                    )
                  );
                  const thumbWidth =
                    Math.max(1, rotatedWidth) * tileSize + PATTERN_THUMB_PADDING * 2;
                  const thumbHeight =
                    Math.max(1, rotatedHeight) * tileSize + PATTERN_THUMB_PADDING * 2;
                  return (
                    <Pressable
                      key={pattern.id}
                      onPress={() => {
                        if (isPatternSelectMode) {
                          toggleSelectPattern(pattern.id);
                          return;
                        }
                        setSelectedPatternId(pattern.id);
                        setIsPatternCreationMode(false);
                        setBrush({ mode: 'pattern' });
                        setShowPatternChooser(false);
                      }}
                      onLongPress={() => {
                        if (isPatternSelectMode) {
                          return;
                        }
                        setPatternRotations((prev) => ({
                          ...prev,
                          [pattern.id]: ((prev[pattern.id] ?? 0) + 90) % 360,
                        }));
                      }}
                      onPressIn={() => {
                        if (isPatternSelectMode) {
                          return;
                        }
                        const now = Date.now();
                        const lastTap = patternLastTapRef.current;
                        if (
                          lastTap &&
                          lastTap.id === pattern.id &&
                          now - lastTap.time < 260
                        ) {
                          setPatternMirrors((prev) => ({
                            ...prev,
                            [pattern.id]: !(prev[pattern.id] ?? false),
                          }));
                          patternLastTapRef.current = null;
                        } else {
                          patternLastTapRef.current = { id: pattern.id, time: now };
                        }
                      }}
                      style={[
                        styles.patternThumb,
                        { width: thumbWidth, height: thumbHeight },
                        (isPatternSelectMode
                          ? selectedPatternIds.has(pattern.id)
                          : selectedPattern?.id === pattern.id) &&
                          styles.patternThumbSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Pattern ${pattern.name}`}
                    >
                      <View
                        style={{
                          width: rotatedWidth * tileSize,
                          height: rotatedHeight * tileSize,
                          flexDirection: 'column',
                        }}
                      >
                        {Array.from({ length: rotatedHeight }, (_, rowIndex) => (
                          <View
                            key={`pattern-row-${pattern.id}-${rowIndex}`}
                            style={{ flexDirection: 'row' }}
                          >
                          {Array.from({ length: rotatedWidth }, (_, colIndex) => {
                            let mappedRow = rowIndex;
                            let mappedCol = colIndex;
                            if (mirrorX) {
                              mappedCol = rotatedWidth - 1 - mappedCol;
                            }
                            let sourceRow = mappedRow;
                            let sourceCol = mappedCol;
                              if (rotationCCW === 90) {
                                sourceRow = mappedCol;
                                sourceCol = pattern.width - 1 - mappedRow;
                              } else if (rotationCCW === 180) {
                                sourceRow = pattern.height - 1 - mappedRow;
                                sourceCol = pattern.width - 1 - mappedCol;
                              } else if (rotationCCW === 270) {
                                sourceRow = pattern.height - 1 - mappedCol;
                                sourceCol = mappedRow;
                              }
                            const index = sourceRow * pattern.width + sourceCol;
                            const tile = pattern.tiles[index];
                            const resolved = resolveTileAssetForFile(
                              tile,
                              tileSources,
                              activeFileTileSetIds
                            );
                            const tileName = resolved.name;
                            const source = resolved.source;
                              return (
                                <View
                                  key={`pattern-cell-${pattern.id}-${index}`}
                                  style={{
                                    width: tileSize,
                                    height: tileSize,
                                    backgroundColor: 'transparent',
                                  }}
                                >
                                  {source && tile && (
                                    <TileAsset
                                      source={source}
                                      name={tileName}
                                      strokeColor={activeLineColor}
                                      strokeWidth={activeLineWidth}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        transform: [
                                          { scaleX: tile.mirrorX !== mirrorX ? -1 : 1 },
                                          { scaleY: tile.mirrorY ? -1 : 1 },
                                          { rotate: `${(tile.rotation + rotationCW) % 360}deg` },
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
                    </Pressable>
                  );
                })}
              </ScrollView>
            </ThemedView>
          </View>
        )}
        {showPatternSaveModal && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={handleCancelPattern}
              accessibilityRole="button"
              accessibilityLabel="Cancel pattern creation"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">Save Pattern</ThemedText>
              {pendingPatternPreview && (
                <View
                  style={[
                    styles.patternSavePreview,
                    {
                      width: pendingPatternPreview.width * pendingPatternPreview.tileSize,
                      height: pendingPatternPreview.height * pendingPatternPreview.tileSize,
                    },
                  ]}
                >
                  {Array.from({ length: pendingPatternPreview.height }, (_, rowIndex) => (
                    <View
                      key={`pattern-save-row-${rowIndex}`}
                      style={{ flexDirection: 'row' }}
                    >
                      {Array.from(
                        { length: pendingPatternPreview.width },
                        (_, colIndex) => {
                          const index = rowIndex * pendingPatternPreview.width + colIndex;
                          const tileData = pendingPatternPreview.tiles[index];
                          const tile = tileData?.tile;
                          const resolved = resolveTileAssetForFile(
                            tile,
                            tileSources,
                            activeFileTileSetIds
                          );
                          const tileName = resolved.name;
                          const source = resolved.source;
                          return (
                            <View
                              key={`pattern-save-cell-${index}`}
                              style={{
                                width: pendingPatternPreview.tileSize,
                                height: pendingPatternPreview.tileSize,
                                backgroundColor: 'transparent',
                              }}
                            >
                              {source && tile && (
                                <TileAsset
                                  source={source}
                                  name={tileName}
                                  strokeColor={activeLineColor}
                                  strokeWidth={activeLineWidth}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    transform: [
                                      { scaleX: tile.mirrorX ? -1 : 1 },
                                      { scaleY: tile.mirrorY ? -1 : 1 },
                                      { rotate: `${tile.rotation}deg` },
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
                  ))}
                </View>
              )}
              <ThemedText type="defaultSemiBold">
                Save the selected tiles as a new pattern?
              </ThemedText>
              <ThemedView style={styles.inlineOptions}>
                <Pressable
                  onPress={handleCancelPattern}
                  style={styles.overlayItem}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel save pattern"
                >
                  <ThemedText type="defaultSemiBold">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={handleSavePattern}
                  style={[styles.overlayItem, styles.overlayItemSelected]}
                  accessibilityRole="button"
                  accessibilityLabel="Save pattern"
                >
                  <ThemedText type="defaultSemiBold">Save</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          </ThemedView>
        )}
        {showSettingsOverlay && (
          <ThemedView
            style={[styles.settingsScreen, { paddingTop: insets.top }]}
            accessibilityRole="dialog"
          >
            <ThemedView style={styles.settingsHeader}>
              <ThemedText type="title">Settings</ThemedText>
              <Pressable
                onPress={() => setShowSettingsOverlay(false)}
                style={styles.settingsClose}
                accessibilityRole="button"
                accessibilityLabel="Close settings"
              >
                <ThemedText type="defaultSemiBold">X</ThemedText>
              </Pressable>
            </ThemedView>
            <ScrollView
              style={styles.settingsScroll}
              contentContainerStyle={styles.settingsContent}
              showsVerticalScrollIndicator
            >
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">Allow Border Connections</ThemedText>
                <Switch
                  value={settings.allowEdgeConnections}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, allowEdgeConnections: value }))
                  }
                  accessibilityLabel="Toggle edge connections"
                />
              </ThemedView>
              <Pressable
                onPress={handleDownloadPng}
                style={styles.settingsAction}
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
            </ScrollView>
          </ThemedView>
        )}
        {showTileSetChooser && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => {
                if (selectedCategories.length === 0 && selectedTileSetIds.length === 0) {
                  setTileSetSelectionError('Select at least one tile set.');
                  return;
                }
                setShowTileSetChooser(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Close tile set chooser"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">Tile Sets</ThemedText>
              <ScrollView
                style={styles.tileSetChooserScroll}
                contentContainerStyle={styles.tileSetChooserScrollContent}
                showsVerticalScrollIndicator
              >
                <ThemedView style={styles.tileSetChooserSection}>
                  <ThemedView style={styles.tileSetChooserGrid}>
                {TILE_CATEGORIES.map((category) => {
                  const isSelected = selectedCategories.includes(category);
                  const firstTile = TILE_MANIFEST[category][0];
                  return (
                    <Pressable
                      key={category}
                      onPress={() => {
                        if (
                          isSelected &&
                          selectedCategories.length === 1 &&
                          selectedTileSetIds.length === 0
                        ) {
                          setTileSetSelectionError('Select at least one tile set.');
                          return;
                        }
                        const nextCategories = isSelected
                          ? selectedCategories.filter((entry) => entry !== category)
                          : [...selectedCategories, category];
                        const nextPaletteSources = getSourcesForSelection(
                          nextCategories,
                          selectedTileSetIds
                        );
                        const nextSourceNames = ensureFileSourceNames(nextPaletteSources);
                        setTileSetSelectionError(null);
                        setSelectedCategories(nextCategories);
                        setSettings((prev) => ({
                          ...prev,
                          tileSetCategories: nextCategories,
                          tileSetIds: selectedTileSetIds,
                        }));
                        if (activeFileId) {
                          upsertActiveFile({
                            tiles,
                            gridLayout,
                            tileSetIds: selectedTileSetIds,
                            sourceNames: nextSourceNames,
                            preferredTileSize: fileTileSize,
                            lineWidth: activeLineWidth,
                            lineColor: activeLineColor,
                          });
                        }
                      }}
                      style={styles.tileSetChooserCard}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={[
                          styles.tileSetChooserThumb,
                          !isSelected && styles.tileSetChooserThumbUnselected,
                          isSelected && styles.tileSetChooserThumbSelected,
                        ]}
                      >
                        {firstTile && (
                          <TileAsset
                            source={firstTile.source}
                            name={firstTile.name}
                            style={styles.tileSetChooserThumbImage}
                            resizeMode="cover"
                          />
                        )}
                      </View>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.tileSetChooserLabel}
                        numberOfLines={2}
                      >
                        {category}
                      </ThemedText>
                    </Pressable>
                  );
                })}
                  </ThemedView>
                </ThemedView>
                <View style={styles.tileSetChooserDivider} />
                <ThemedView style={styles.tileSetChooserSection}>
                  {userTileSets.length === 0 ? (
                    <ThemedText type="defaultSemiBold" style={styles.emptyText}>
                      No UGC tile sets yet
                    </ThemedText>
                  ) : (
                  <ThemedView style={styles.tileSetChooserGrid}>
                {userTileSets.map((set) => {
                  const isSelected = selectedTileSetIds.includes(set.id);
                  const firstTile = set.tiles[0];
                  const thumbUri = firstTile?.thumbnailUri ?? firstTile?.previewUri ?? null;
                  return (
                    <Pressable
                      key={set.id}
                      onPress={() => {
                        if (
                          isSelected &&
                          selectedTileSetIds.length === 1 &&
                          selectedCategories.length === 0
                        ) {
                          setTileSetSelectionError('Select at least one tile set.');
                          return;
                        }
                        const nextTileSetIds = isSelected
                          ? selectedTileSetIds.filter((entry) => entry !== set.id)
                          : [...selectedTileSetIds, set.id];
                        setTileSetSelectionError(null);
                        setSelectedTileSetIds(nextTileSetIds);
                        setSettings((prev) => ({
                          ...prev,
                          tileSetCategories: selectedCategories,
                          tileSetIds: nextTileSetIds,
                        }));
                        const nextPaletteSources = getSourcesForSelection(
                          selectedCategories,
                          nextTileSetIds
                        );
                        const nextSourceNames =
                          ensureFileSourceNames(nextPaletteSources);
                        if (activeFileId) {
                          upsertActiveFile({
                            tiles,
                            gridLayout,
                            tileSetIds: nextTileSetIds,
                            sourceNames: nextSourceNames,
                            preferredTileSize: fileTileSize,
                            lineWidth: activeLineWidth,
                            lineColor: activeLineColor,
                          });
                        }
                      }}
                      style={styles.tileSetChooserCard}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={[
                          styles.tileSetChooserThumb,
                          !isSelected && styles.tileSetChooserThumbUnselected,
                          isSelected && styles.tileSetChooserThumbSelected,
                        ]}
                      >
                        {thumbUri ? (
                          <TileAsset
                            source={{ uri: thumbUri }}
                            name="thumbnail"
                            style={styles.tileSetChooserThumbImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.tileSetChooserThumbPlaceholder} />
                        )}
                      </View>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.tileSetChooserLabel}
                        numberOfLines={2}
                      >
                        {set.name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
                  </ThemedView>
                  )}
                </ThemedView>
              </ScrollView>
              {tileSetSelectionError && (
                <ThemedText type="defaultSemiBold" style={styles.errorText}>
                  {tileSetSelectionError}
                </ThemedText>
              )}
            </ThemedView>
          </ThemedView>
        )}
      </ThemedView>
    </ThemedView>
  );

  return (
    <>
      {fileView}
      {modifyView}
    </>
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
    fontSize: 18,
    lineHeight: 20,
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
    zIndex: 200,
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
  settingsScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 100,
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
  settingsAction: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    alignItems: 'center',
  },
  settingsActionDanger: {
    borderColor: '#dc2626',
  },
  settingsActionDangerText: {
    color: '#dc2626',
  },
  overlayList: {
    gap: 8,
  },
  tileSetChooserScroll: {
    maxHeight: 320,
  },
  tileSetChooserScrollContent: {
    paddingVertical: 8,
    gap: 16,
  },
  tileSetChooserSection: {},
  tileSetChooserDivider: {
    height: 1,
    backgroundColor: '#d1d5db',
    marginVertical: 12,
    width: '100%',
  },
  tileSetChooserGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tileSetChooserCard: {
    width: 96,
    alignItems: 'center',
    padding: 6,
  },
  tileSetChooserThumb: {
    width: 72,
    height: 72,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  tileSetChooserThumbUnselected: {
    opacity: 0.5,
  },
  tileSetChooserThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  tileSetChooserThumbImage: {
    width: '100%',
    height: '100%',
  },
  tileSetChooserThumbPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f0f0f',
  },
  tileSetChooserLabel: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 12,
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
  errorText: {
    color: '#ef4444',
    marginTop: 6,
  },
  emptyText: {
    color: '#6b7280',
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
    zIndex: 20,
    elevation: 20,
    overflow: 'visible',
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
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
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
    backgroundColor: '#111',
  },
  fileThumbImage: {
    width: '100%',
    height: '100%',
  },
  fileThumbPlaceholder: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    borderRadius: 4,
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
  patternModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  patternModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  patternModalPanel: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 12,
    backgroundColor: '#3f3f3f',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 0,
    overflow: 'hidden',
  },
  patternModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 0,
  },
  patternModalTitle: {
    color: '#fff',
  },
  patternModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  patternHeaderIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  patternSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#1f1f1f',
    overflow: 'hidden',
    marginBottom: 10,
    borderRadius: 8,
  },
  patternSelectButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectDelete: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectDeleteText: {
    color: '#dc2626',
  },
  patternSelectExitText: {
    color: '#fff',
  },
  patternSelectCount: {
    color: '#9ca3af',
  },
  patternSavePreview: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#000',
  },
  patternCreationOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  patternCreationTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_HEIGHT,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  patternCreationBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 50,
  },
  patternCreationText: {
    color: '#fff',
  },
  patternModalClose: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  patternModalScroll: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  patternModalContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-start',
    paddingBottom: 8,
  },
  patternThumb: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#000',
    borderRadius: 6,
    padding: PATTERN_THUMB_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  patternCreateText: {
    color: '#fff',
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
  gridCanvasWebCenter: {
    width: '100%',
    alignItems: 'center',
  },
  gridWrapper: {
    position: 'relative',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  gridBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  patternSelection: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#22c55e',
    zIndex: 5,
  },
  patternAlignment: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: 'rgba(59, 130, 246, 0.5)',
    zIndex: 5,
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
    zIndex: 6,
  },
  gridPreviewBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
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
    zIndex: 7,
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
