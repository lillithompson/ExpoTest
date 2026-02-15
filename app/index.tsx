import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from 'react';
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
    TILE_CATEGORY_THUMBNAILS,
    TILE_MANIFEST,
    type TileCategory,
    type TileSource,
} from '@/assets/images/tiles/manifest';
import { DesktopNavTabs } from '@/components/desktop-nav-tabs';
import { PatternThumbnail } from '@/components/pattern-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { clearTileAssetCache, prefetchTileAssets, TileAsset } from '@/components/tile-asset';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { clearBrushFavorites, TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { TileGridCanvas } from '@/components/tile-grid-canvas';
import { TAB_BAR_HEIGHT, useTabBarVisible } from '@/contexts/tab-bar-visible';
import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';
import { getDefaultSettings, usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTileAtlas } from '@/hooks/use-tile-atlas';
import { useTileFiles, type TileFile } from '@/hooks/use-tile-files';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { useTilePatterns } from '@/hooks/use-tile-patterns';
import { useTileSets } from '@/hooks/use-tile-sets';
import { clearAllLocalData } from '@/utils/clear-local-data';
import { downloadUgcTileFile } from '@/utils/download-ugc-tile';
import {
    loadSampleFileContents,
    loadSamplePatternContents,
    loadSampleTileSetContents,
    shouldLoadSamplesThisSession,
} from '@/utils/load-sample-assets';
import {
    canApplyEmptyNewFileRestore,
    canApplyNonEmptyRestore,
} from '@/utils/load-state';
import {
    getCellIndicesInRegion,
    getLockedBoundaryEdges,
} from '@/utils/locked-regions';
import {
    buildPreviewPath,
    getFilePreviewUri,
    hasCachedThumbnail,
    hasPreview as hasPreviewState,
    isOwnPreviewUri,
    showPreview as showPreviewState,
} from '@/utils/preview-state';
import {
    getSetIdAndLegacyFromQualifiedName,
    parseBakedName,
} from '@/utils/tile-baked-name';
import {
    deserializeBundle,
    fileUsesUgc,
    getSetIdsFromPatternTiles,
    remapFilePayload,
    remapPatternTileNames,
    serializeFileBundle,
    serializePatternBundle,
} from '@/utils/tile-bundle-format';
import { getTransformedConnectionsForName, parseTileConnections, transformConnections } from '@/utils/tile-compat';
import {
    buildSourceXmlCache,
    exportTileCanvasAsSvg,
    getSourceUri,
    renderTileCanvasToDataUrl,
    renderTileCanvasToSvg,
} from '@/utils/tile-export';
import { deserializeTileFile, serializeTileFile } from '@/utils/tile-format';
import { hydrateTilesWithSourceNames, normalizeTiles, type Tile } from '@/utils/tile-grid';
import { deserializePattern, deserializeTileSet, serializePattern } from '@/utils/tile-ugc-format';
import JSZip from 'jszip';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const UNDO_REDO_BANNER_HEIGHT = HEADER_HEIGHT / 2;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const PATTERN_THUMB_HEIGHT = 70;
const PATTERN_THUMB_PADDING = 4;
const BRUSH_PANEL_ROW_GAP = 1;
/** Reserve space for horizontal scrollbar so the bottom row is not cut off on desktop web. */
const WEB_SCROLLBAR_HEIGHT = 17;
/** On mobile web, only commit single-finger paint on touchmove after this delay (ms) so a second finger can register. */
const MOBILE_WEB_COMMIT_MOVE_DELAY_MS = 180;
/** On mobile web, also require this much movement (px) before commit-on-move so jitter while second finger lands doesn't paint. */
const MOBILE_WEB_COMMIT_MOVE_MIN_PX = 8;
const FILE_GRID_MIN_CARD_WIDTH = 100;
/** On desktop web, use larger min card width so thumbnails display bigger (fewer columns). */
const FILE_GRID_MIN_CARD_WIDTH_DESKTOP_WEB = 240;
const FILE_GRID_SIDE_PADDING = 12;
const FILE_GRID_GAP = 12;
const DEFAULT_CATEGORY = (TILE_CATEGORIES as string[]).includes('angular')
  ? ('angular' as TileCategory)
  : TILE_CATEGORIES[0];
/** On iOS and mobile web, new file dialog shows S/M/L (resolutions 100, 50, 25). */
const NEW_FILE_RESOLUTION_SIMPLE: { label: string; size: number }[] = [
  { label: 'S', size: 100 },
  { label: 'M', size: 50 },
  { label: 'L', size: 25 },
];
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');
const PREVIEW_DIR = `${FileSystem.cacheDirectory ?? ''}tile-previews/`;
/** Max file thumbnail display size (web cap): narrow = this, desktop = 2×. */
const FILE_THUMB_DISPLAY_SIZE = 200;
/** Generated file thumbnail resolution (2× display for sharp rendering on desktop). */
const FILE_THUMB_SIZE = 400;
/** Min content width to treat as desktop (web); above this, thumbnails use 2× display size. */
const FILE_VIEW_DESKTOP_BREAKPOINT = 768;
const buildUserTileSourceFromName = (name: string): TileSource | null => {
  const colonIndex = name.indexOf(':');
  if (colonIndex < 0) {
    return null;
  }
  const setId = name.slice(0, colonIndex);
  const fileName = name.slice(colonIndex + 1);
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
  disabled?: boolean;
};

function ToolbarButton({
  label,
  onPress,
  onLongPress,
  icon,
  active,
  color,
  disabled = false,
}: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  const iconColor = disabled
    ? 'rgba(42, 42, 42, 0.35)'
    : (color ?? (active ? '#22c55e' : 'rgba(42, 42, 42, 0.8)'));
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      style={styles.toolbarButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={iconColor}
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
  isLocked?: boolean;
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
    isLocked = false,
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

    const tileContent = source ? (
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
    ) : null;

    return (
      <View style={isLocked ? { opacity: 0.5 } : undefined}>
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
          {tileContent != null ? (
            <View
              style={StyleSheet.absoluteFill}
              pointerEvents={Platform.OS === 'web' ? 'none' : 'auto'}
            >
              {tileContent}
            </View>
          ) : null}
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
      </View>
    );
  },
  (prev, next) =>
    prev.isLocked === next.isLocked &&
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
  const { tabBarVisible, setHideTabBarOverModify, setHideTabBarOverOverlay } =
    useTabBarVisible();
  const gridRef = useRef<View>(null);
  const gridCaptureRef = useRef<ViewShot>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const gridTouchRef = useRef<View>(null);
  const { settings, setSettings, reload: reloadSettings } = usePersistedSettings();
  const [selectedCategories, setSelectedCategories] = useState<TileCategory[]>(
    () => [DEFAULT_CATEGORY]
  );
  const [selectedTileSetIds, setSelectedTileSetIds] = useState<string[]>([]);
  const [fileSourceNames, setFileSourceNames] = useState<string[]>([]);
  const [tileSetSelectionError, setTileSetSelectionError] = useState<string | null>(
    null
  );
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showTileSetChooser, setShowTileSetChooser] = useState(false);
  const [showModifyTileSetBanner, setShowModifyTileSetBanner] = useState(false);
  const MODIFY_BANNER_HEIGHT = 52;
  const modifyBannerTranslateY = useRef(new Animated.Value(-MODIFY_BANNER_HEIGHT)).current;
  useEffect(() => {
    if (showModifyTileSetBanner) {
      modifyBannerTranslateY.setValue(-MODIFY_BANNER_HEIGHT);
      Animated.timing(modifyBannerTranslateY, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showModifyTileSetBanner, modifyBannerTranslateY]);
  const dismissModifyBanner = useCallback(() => {
    Animated.timing(modifyBannerTranslateY, {
      toValue: -MODIFY_BANNER_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowModifyTileSetBanner(false));
  }, [modifyBannerTranslateY]);
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [fileMenuTargetId, setFileMenuTargetId] = useState<string | null>(null);
  const importTileInputRef = useRef<HTMLInputElement | null>(null);
  const importPatternInputRef = useRef<HTMLInputElement | null>(null);
  const applyImportedPatternRef = useRef<
    (content: string) => { ok: false; error: string } | { ok: true }
  >(() => ({ ok: false, error: 'Not ready' }));
  const applyImportedTileFileRef = useRef<(content: string) => void>(() => {});
  const [downloadTargetId, setDownloadTargetId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDownloadOverlay, setShowDownloadOverlay] = useState(false);
  const [downloadRenderKey, setDownloadRenderKey] = useState(0);
  const [downloadLoadedCount, setDownloadLoadedCount] = useState(0);
  const [includeDownloadBackground, setIncludeDownloadBackground] = useState(true);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportModeForDownload, setExportModeForDownload] = useState(false);
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
    | { mode: 'draw' }
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
  useEffect(() => {
    setHideTabBarOverModify(viewMode === 'modify');
    return () => setHideTabBarOverModify(false);
  }, [viewMode, setHideTabBarOverModify]);
  const prevViewModeRef = useRef<'modify' | 'file'>(viewMode);
  useEffect(() => {
    // Clear zoom when opening a file (enter modify) or closing a file (enter file list).
    if (viewMode === 'file') {
      setZoomRegion(null);
    } else if (viewMode === 'modify' && prevViewModeRef.current === 'file') {
      setZoomRegion(null);
    }
    prevViewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    setHideTabBarOverOverlay(showSettingsOverlay);
    return () => setHideTabBarOverOverlay(false);
  }, [showSettingsOverlay, setHideTabBarOverOverlay]);
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>(
    {}
  );
  const [paletteMirrors, setPaletteMirrors] = useState<Record<number, boolean>>({});
  const [paletteMirrorsY, setPaletteMirrorsY] = useState<Record<number, boolean>>(
    {}
  );
  const { patterns, patternsByCategory, createPattern, deletePatterns, clearAllPatterns } = useTilePatterns();
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [isPatternCreationMode, setIsPatternCreationMode] = useState(false);
  const [patternSelection, setPatternSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [canvasSelection, setCanvasSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [zoomRegion, setZoomRegion] = useState<{
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  } | null>(null);
  const [patternAnchorIndex, setPatternAnchorIndex] = useState<number | null>(null);
  const [showPatternSaveModal, setShowPatternSaveModal] = useState(false);
  const [showPatternChooser, setShowPatternChooser] = useState(false);
  const [isPatternSelectMode, setIsPatternSelectMode] = useState(false);
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(new Set());
  const [showPatternExportMenu, setShowPatternExportMenu] = useState(false);
  const patternSelectAnim = useRef(new Animated.Value(0)).current;
  const [patternRotations, setPatternRotations] = useState<Record<string, number>>(
    {}
  );
  const [patternMirrors, setPatternMirrors] = useState<Record<string, boolean>>({});
  const patternLastTapRef = useRef<{ id: string; time: number } | null>(null);
  // tileSources is set after we resolve the active file/category.
  const isWeb = Platform.OS === 'web';
  const isMobileWeb = useIsMobileWeb();
  const isExpoGo = Constants.appOwnership === 'expo';
  const useSkiaGrid = Platform.OS !== 'web' && !isExpoGo;
  const platformLabel =
    Platform.OS === 'web'
      ? isMobileWeb
        ? 'Mobile Web'
        : 'Desktop Web'
      : isExpoGo
        ? 'Expo Go'
        : Platform.OS === 'ios'
          ? 'iOS'
          : 'Android';
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
    createFileFromTileData,
    duplicateFile,
    downloadFile,
    downloadTileFile,
    deleteFile,
    clearAllFiles,
    upsertActiveFile,
    updateActiveFileLockedCells,
    replaceTileSourceNames,
    replaceTileSourceNamesWithError,
    ready,
  } = useTileFiles(DEFAULT_CATEGORY);
  const {
    tileSets: userTileSets,
    bakedSourcesBySetId,
    currentBakedNamesBySetId,
    isLoaded: tileSetsLoaded,
    importTileSet,
    reloadTileSets,
  } = useTileSets({
    onBakedNamesReplaced: replaceTileSourceNames,
    onTileSourceNamesRemoved: replaceTileSourceNamesWithError,
  });

  const activeCategories = useMemo(
    () => normalizeCategories(selectedCategories),
    [selectedCategories]
  );
  const primaryCategory = activeCategories[0] ?? DEFAULT_CATEGORY;
  const areTileSetsReady = useCallback(
    (ids: string[]) =>
      ids.every((id) => {
        const sources = bakedSourcesBySetId[id] ?? [];
        if (sources.length === 0) {
          const set = userTileSets.find((s) => s.id === id);
          return set ? set.tiles.length === 0 : false;
        }
        const allPlaceholders = sources.every((s) => s.source === ERROR_TILE);
        if (allPlaceholders) return false;
        return true;
      }),
    [bakedSourcesBySetId, userTileSets]
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
  /** Resolve UGC names that no longer exist (e.g. old baked name) by setId + tileId so files load after tile edits. */
  const bakedBySetIdAndTileId = useMemo(() => {
    const outer = new Map<string, Map<string, TileSource>>();
    Object.entries(bakedSourcesBySetId).forEach(([setId, sources]) => {
      const inner = new Map<string, TileSource>();
      sources.forEach((source) => {
        if (!source?.name) return;
        const parsed = parseBakedName(source.name);
        if (parsed) {
          inner.set(parsed.tileId, source);
        }
      });
      if (inner.size > 0) {
        outer.set(setId, inner);
      }
    });
    return outer;
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
      // Resolve legacy UGC names (old baked timestamp) to current baked source by setId + tileId
      if (name.includes(':')) {
        const parsed = getSetIdAndLegacyFromQualifiedName(name);
        if (parsed) {
          const { setId, legacy } = parsed;
          const tileIdFromLegacy = parseBakedName(legacy)?.tileId;
          if (tileIdFromLegacy) {
            const currentSource = bakedBySetIdAndTileId.get(setId)?.get(tileIdFromLegacy);
            if (currentSource) {
              return normalizeUserTileSource(currentSource, currentSource.name);
            }
          }
        }
      }
      return normalizeUserTileSource(null, name);
    },
    [allSourceLookup, bakedLegacyLookup, bakedBySetIdAndTileId]
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
          if (name.includes(':') && Platform.OS !== 'web') {
            const ugcFallback = buildUserTileSourceFromName(name);
            if (ugcFallback && (!resolved || resolved.source === ERROR_TILE)) {
              return ugcFallback;
            }
          }
          return resolved ?? { name, source: ERROR_TILE };
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
  const userFiles = useMemo(
    () =>
      [...files]
        .filter((f) => !f.isSample)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [files]
  );
  const sampleFiles = useMemo(
    () =>
      [...files]
        .filter((f) => f.isSample)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [files]
  );
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
    }
  }, [brush.mode, activePatterns.length]);
  useEffect(() => {
    setPatternAnchorIndex(null);
  }, [selectedPattern?.id]);

  const fileTileSize = activeFile?.preferredTileSize ?? settings.preferredTileSize;
  const activeLineWidth = activeFile?.lineWidth ?? 10;
  const activeLineColor = activeFile?.lineColor ?? '#ffffff';
  const [lineWidthDraft, setLineWidthDraft] = useState(activeLineWidth);

  /** True while a paint drag is in progress so the whole stroke is one undo step. */
  const isPartOfDragRef = useRef(false);

  /** Deferred so the grid and zoomed tile slice update together, avoiding one frame of junk tiles. */
  const zoomRegionForGrid = useDeferredValue(zoomRegion);

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
    undo,
    redo,
    pushUndoForDragStart,
    canUndo,
    canRedo,
    clearCloneSource,
    setCloneSource,
    cloneSourceIndex,
    cloneSampleIndex,
    cloneAnchorIndex,
    cloneCursorIndex,
    clearDrawStroke,
    fullGridColumnsForZoom,
    fullGridRowsForZoom,
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
    canvasSelection: viewMode === 'modify' ? canvasSelection : null,
    lockedCells:
      viewMode === 'modify' ? (activeFile?.lockedCells ?? null) : null,
    isPartOfDragRef: viewMode === 'modify' ? isPartOfDragRef : undefined,
    zoomRegion: viewMode === 'modify' ? zoomRegionForGrid : null,
    fullGridColumns: viewMode === 'modify' && zoomRegion ? (activeFile?.grid.columns ?? undefined) : undefined,
    fullGridRows: viewMode === 'modify' && zoomRegion ? (activeFile?.grid.rows ?? undefined) : undefined,
  });
  const fullGridColumnsForMapping =
    zoomRegion && fullGridColumnsForZoom != null
      ? fullGridColumnsForZoom
      : (activeFile?.grid.columns ?? 0);
  const getFullIndexForCanvas = useCallback(
    (visibleIndex: number) => {
      if (!zoomRegion || fullGridColumnsForMapping <= 0) return visibleIndex;
      const { minRow, minCol, maxCol } = zoomRegion;
      const zoomCols = maxCol - minCol + 1;
      const visibleRow = Math.floor(visibleIndex / zoomCols);
      const visibleCol = visibleIndex % zoomCols;
      return (minRow + visibleRow) * fullGridColumnsForMapping + (minCol + visibleCol);
    },
    [zoomRegion, fullGridColumnsForMapping]
  );
  const showLockButton = viewMode === 'modify' && !!(canvasSelection && gridLayout.columns > 0);
  const showZoomButton =
    viewMode === 'modify' &&
    !!(canvasSelection && gridLayout.columns > 0) && !zoomRegion;

  /** Animate selected-region tools bar when it becomes available (region selected). */
  const regionToolsVisible = showLockButton || showZoomButton;
  const prevRegionToolsVisibleRef = useRef(false);
  const regionToolsOpacity = useRef(new Animated.Value(0)).current;
  const regionToolsScale = useRef(new Animated.Value(0.75)).current;
  const regionToolsTranslateY = useRef(new Animated.Value(-16)).current;
  useEffect(() => {
    if (regionToolsVisible && !prevRegionToolsVisibleRef.current) {
      prevRegionToolsVisibleRef.current = true;
      regionToolsOpacity.setValue(0);
      regionToolsScale.setValue(0.75);
      regionToolsTranslateY.setValue(-16);
      const useNative = Platform.OS !== 'web';
      Animated.parallel([
        Animated.timing(regionToolsOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: useNative,
        }),
        Animated.timing(regionToolsTranslateY, {
          toValue: 0,
          duration: 220,
          useNativeDriver: useNative,
        }),
        Animated.sequence([
          Animated.timing(regionToolsScale, {
            toValue: 1.1,
            duration: 120,
            useNativeDriver: useNative,
          }),
          Animated.timing(regionToolsScale, {
            toValue: 1,
            duration: 100,
            useNativeDriver: useNative,
          }),
        ]),
      ]).start();
    }
    if (!regionToolsVisible) prevRegionToolsVisibleRef.current = false;
  }, [regionToolsVisible, regionToolsOpacity, regionToolsScale, regionToolsTranslateY]);

  /** Ephemeral "Undoing" / "Redoing" banner over the tile canvas. */
  const [undoRedoBanner, setUndoRedoBanner] = useState<'undoing' | 'redoing' | null>(null);
  const undoRedoBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRedoBannerTranslateY = useRef(new Animated.Value(-UNDO_REDO_BANNER_HEIGHT)).current;

  const showUndoRedoBanner = useCallback(
    (action: 'undoing' | 'redoing') => {
      if (undoRedoBannerTimeoutRef.current) {
        clearTimeout(undoRedoBannerTimeoutRef.current);
        undoRedoBannerTimeoutRef.current = null;
      }
      setUndoRedoBanner(action);
      undoRedoBannerTranslateY.setValue(-UNDO_REDO_BANNER_HEIGHT);
      const useNative = Platform.OS !== 'web';
      Animated.timing(undoRedoBannerTranslateY, {
        toValue: 0,
        duration: 120,
        useNativeDriver: useNative,
      }).start();
      undoRedoBannerTimeoutRef.current = setTimeout(() => {
        undoRedoBannerTimeoutRef.current = null;
        Animated.timing(undoRedoBannerTranslateY, {
          toValue: -UNDO_REDO_BANNER_HEIGHT,
          duration: 120,
          useNativeDriver: useNative,
        }).start(() => setUndoRedoBanner(null));
      }, 600);
    },
    [undoRedoBannerTranslateY]
  );

  useEffect(() => {
    return () => {
      if (undoRedoBannerTimeoutRef.current) {
        clearTimeout(undoRedoBannerTimeoutRef.current);
      }
    };
  }, []);

  const tilesSignature = useMemo(
    () =>
      tiles
        .map(
          (tile) =>
            `${tile?.imageIndex ?? -1}:${tile?.rotation ?? 0}:${tile?.mirrorX ? 1 : 0}:${
              tile?.mirrorY ? 1 : 0
            }`
        )
        .join('|'),
    [tiles]
  );
  useEffect(() => {
    if (pendingPaletteFloodRef.current) {
      pendingPaletteFloodRef.current = false;
      floodFill();
    }
  }, [brush, floodFill]);
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
  const isDesktopWeb =
    Platform.OS === 'web' && width >= FILE_VIEW_DESKTOP_BREAKPOINT;
  const brushContentHeight =
    isDesktopWeb
      ? Math.max(0, brushPanelHeight - WEB_SCROLLBAR_HEIGHT)
      : brushPanelHeight;
  /** If row height would exceed this (px), use more rows so each row stays at or below it. */
  const MAX_BRUSH_ROW_HEIGHT = 120;
  const minRowsForHeight = Math.ceil(
    (brushContentHeight + BRUSH_PANEL_ROW_GAP) /
      (MAX_BRUSH_ROW_HEIGHT + BRUSH_PANEL_ROW_GAP)
  );
  const brushRows = Math.max(2, Math.min(minRowsForHeight, 5));
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
  const lastCanvasTapTimeRef = useRef(0);
  const canvasTouchDidMoveRef = useRef(false);
  /** On mobile web: 2 or 3 when a 2- or 3-finger gesture is in progress (for undo/redo tap). */
  const multiFingerTouchCountRef = useRef(0);
  /** On mobile web: pending single-finger point; we only commit on touchmove (drag) or touchend (tap) so two-finger tap never paints. */
  const pendingSingleTouchPointRef = useRef<{ x: number; y: number } | null>(null);
  /** When the pending single-finger touch started (ms); commit-on-move only after a short delay. */
  const pendingSingleTouchStartTimeRef = useRef(0);
  const lastCanvasClickTimeRef = useRef(0);
  const canvasMouseDidMoveRef = useRef(false);
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
  const pendingPaletteFloodRef = useRef(false);
  const floodLongPressHandledRef = useRef(false);
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
  /** When in pattern mode with a UGC pattern, include the pattern's tile set IDs so placed pattern tiles resolve. */
  const resolutionTileSetIds = useMemo(() => {
    const base =
      activeFileTileSetIds.length > 0 ? activeFileTileSetIds : selectedTileSetIds;
    if (
      brush.mode === 'pattern' &&
      selectedPattern?.tileSetIds &&
      selectedPattern.tileSetIds.length > 0
    ) {
      const set = new Set([...base, ...selectedPattern.tileSetIds]);
      return Array.from(set);
    }
    return base;
  }, [
    activeFileTileSetIds,
    selectedTileSetIds,
    brush.mode,
    selectedPattern?.tileSetIds,
  ]);
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
        resolveSourceName(name, resolutionTileSetIds),
        name
      );
    },
    [resolveSourceName, resolutionTileSetIds, tileSourcesByName]
  );
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
        if (resolved && resolved.source !== ERROR_TILE) {
          return { source: resolved.source, name: resolved.name };
        }
        if (tile.name.includes(':') && Platform.OS !== 'web') {
          const ugcSource = buildUserTileSourceFromName(tile.name);
          if (ugcSource && (!resolved || resolved.source === ERROR_TILE)) {
            return { source: ugcSource.source, name: ugcSource.name };
          }
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
  const resolvePatternTile = useCallback(
    (tile: Tile) => {
      const patternTileSetIds =
        selectedPattern?.tileSetIds && selectedPattern.tileSetIds.length > 0
          ? selectedPattern.tileSetIds
          : activeFileTileSetIds;
      return resolveTileAssetForFile(tile, tileSources, patternTileSetIds);
    },
    [
      resolveTileAssetForFile,
      selectedPattern?.tileSetIds,
      activeFileTileSetIds,
      tileSources,
    ]
  );
  /** Same thumbnail as pattern chooser so UGC tiles resolve correctly in the palette. */
  const patternThumbnailNode = useMemo(() => {
    if (!selectedPattern) return undefined;
    const rotationCW = ((patternRotations[selectedPattern.id] ?? 0) + 360) % 360;
    const rotatedWidth =
      rotationCW % 180 === 0 ? selectedPattern.width : selectedPattern.height;
    const rotatedHeight =
      rotationCW % 180 === 0 ? selectedPattern.height : selectedPattern.width;
    const tileSize = Math.max(
      4,
      Math.floor(brushItemSize / Math.max(1, Math.max(rotatedWidth, rotatedHeight)))
    );
    const patternTileSetIds =
      selectedPattern.tileSetIds && selectedPattern.tileSetIds.length > 0
        ? selectedPattern.tileSetIds
        : activeFileTileSetIds;
    return (
      <PatternThumbnail
        pattern={selectedPattern}
        rotationCW={rotationCW}
        mirrorX={patternMirrors[selectedPattern.id] ?? false}
        tileSize={tileSize}
        resolveTile={(t) =>
          resolveTileAssetForFile(t, tileSources, patternTileSetIds)
        }
        strokeColor={activeLineColor}
        strokeWidth={activeLineWidth}
        strokeScaleByName={strokeScaleByName}
      />
    );
  }, [
    selectedPattern,
    patternRotations,
    patternMirrors,
    brushItemSize,
    tileSources,
    activeFileTileSetIds,
    resolveTileAssetForFile,
    activeLineColor,
    activeLineWidth,
    strokeScaleByName,
  ]);
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
      const file = activeFile ?? null;
      if (!file?.tiles?.length) return true;
      const needsSource = file.tiles.some(
        (t) => t && t.imageIndex >= 0
      );
      return !needsSource;
    }
    return activeFileSourceNames.every((name) =>
      Boolean(resolveSourceName(name, activeFileTileSetIds))
    );
  }, [
    activeFile,
    activeFileSourceNames,
    resolveSourceName,
    activeFileTileSetIds,
    hasActiveFileTiles,
  ]);
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

  useFocusEffect(
    useCallback(() => {
      void reloadSettings();
    }, [reloadSettings])
  );

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
      const hasUgcNames = stored.some(
        (n) => typeof n === 'string' && n.includes(':')
      );
      if (
        hasUgcNames &&
        pendingTileSetIds.length > 0 &&
        !areTileSetsReady(pendingTileSetIds)
      ) {
        return;
      }
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
    bakedSourcesBySetId,
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
    setIsSelectionMode(false);
    setCanvasSelection(null);
    setZoomRegion(null);
    updateActiveFileLockedCells([]);
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
  }, [activeFileId, loadRequestId, ready, viewMode, clearCloneSource, updateActiveFileLockedCells]);

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
    if (zoomRegion) {
      return;
    }
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
    zoomRegion,
  ]);

  useEffect(() => {
    if (!ready || !activeFileId || viewMode !== 'modify') {
      return;
    }
    if (!isReadyLatched) {
      return;
    }
    if (zoomRegion) {
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
        if (zoomRegion) return;
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
            isInteractingRef.current ||
            zoomRegion
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
            zoomRegion ||
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
    zoomRegion,
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
    if (canvasSelection) {
      resetTiles();
      return;
    }
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
  const canvasSelectionRect = useMemo(() => {
    if (!canvasSelection || gridLayout.columns === 0) {
      return null;
    }
    const tileStride = gridLayout.tileSize + GRID_GAP;
    let minRow: number;
    let maxRow: number;
    let minCol: number;
    let maxCol: number;
    if (zoomRegion && fullGridColumnsForMapping > 0) {
      const fullCols = fullGridColumnsForMapping;
      const startRow = Math.floor(canvasSelection.start / fullCols);
      const startCol = canvasSelection.start % fullCols;
      const endRow = Math.floor(canvasSelection.end / fullCols);
      const endCol = canvasSelection.end % fullCols;
      const fullMinRow = Math.min(startRow, endRow);
      const fullMaxRow = Math.max(startRow, endRow);
      const fullMinCol = Math.min(startCol, endCol);
      const fullMaxCol = Math.max(startCol, endCol);
      minRow = Math.max(0, Math.min(gridLayout.rows - 1, fullMinRow - zoomRegion.minRow));
      maxRow = Math.max(0, Math.min(gridLayout.rows - 1, fullMaxRow - zoomRegion.minRow));
      minCol = Math.max(0, Math.min(gridLayout.columns - 1, fullMinCol - zoomRegion.minCol));
      maxCol = Math.max(0, Math.min(gridLayout.columns - 1, fullMaxCol - zoomRegion.minCol));
      if (minRow > maxRow || minCol > maxCol) return null;
    } else {
      const bounds = getSelectionBounds(canvasSelection.start, canvasSelection.end);
      minRow = bounds.minRow;
      maxRow = bounds.maxRow;
      minCol = bounds.minCol;
      maxCol = bounds.maxCol;
    }
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
  }, [canvasSelection, gridLayout.columns, gridLayout.rows, gridLayout.tileSize, zoomRegion, fullGridColumnsForMapping]);
  const lockedCellIndicesSet = useMemo(() => {
    const cells = activeFile?.lockedCells ?? [];
    if (cells.length === 0) {
      return null;
    }
    return new Set(cells);
  }, [activeFile?.lockedCells]);
  const lockedCellIndicesArray = useMemo(
    () => (lockedCellIndicesSet ? Array.from(lockedCellIndicesSet) : null),
    [lockedCellIndicesSet]
  );
  const lockedBoundaryEdges = useMemo(() => {
    const cells = activeFile?.lockedCells ?? [];
    if (cells.length === 0 || gridLayout.columns <= 0 || gridLayout.rows <= 0) {
      return [];
    }
    return getLockedBoundaryEdges(
      cells,
      gridLayout.columns,
      gridLayout.rows,
      gridLayout.tileSize,
      GRID_GAP
    );
  }, [
    activeFile?.lockedCells,
    gridLayout.columns,
    gridLayout.rows,
    gridLayout.tileSize,
  ]);
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
      ...(saveTileSetIds.length > 0 && { tileSetIds: saveTileSetIds }),
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
    setZoomRegion(null);
    setLoadRequestId((prev) => prev + 1);
    setLoadPreviewUri(getFilePreviewUri(file));
    setSuspendTiles(true);
    setHydrating(true);
    setActive(file.id);
    setShowModifyTileSetBanner(false);
    setViewMode('modify');
  };

  const applyImportedTileFile = useCallback(
    (content: string) => {
      const bundleResult = deserializeBundle(content);
      if (bundleResult.ok && bundleResult.kind === 'fileBundle') {
        const oldToNewSetId = new Map<string, string>();
        for (const { setId, payload } of bundleResult.payload.tileSets) {
          const newId = importTileSet(payload, { preserveBakedNames: true });
          oldToNewSetId.set(setId, newId);
        }
        const remapped = remapFilePayload(
          bundleResult.payload.file,
          oldToNewSetId
        );
        createFileFromTileData(remapped);
        setZoomRegion(null);
        setLoadRequestId((prev) => prev + 1);
        setLoadPreviewUri(null);
        setSuspendTiles(true);
        setLoadedToken(0);
        setHydrating(true);
        setShowModifyTileSetBanner(false);
        setViewMode('modify');
        return;
      }
      const result = deserializeTileFile(content);
      if (!result.ok) {
        if (Platform.OS === 'web') {
          window.alert(result.error);
        } else {
          Alert.alert('Invalid .tile file', result.error);
        }
        return;
      }
      const newId = createFileFromTileData(result.payload);
      setZoomRegion(null);
      setLoadRequestId((prev) => prev + 1);
      setLoadPreviewUri(null);
      setSuspendTiles(true);
      setLoadedToken(0);
      setHydrating(true);
      setShowModifyTileSetBanner(false);
      setViewMode('modify');
    },
    [createFileFromTileData, importTileSet]
  );

  const handleImportTileFilePress = useCallback(async () => {
    if (Platform.OS === 'web') {
      importTileInputRef.current?.click();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const uri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      applyImportedTileFile(content);
    } catch {
      Alert.alert('Import failed', 'Could not read the selected file.');
    }
  }, [applyImportedTileFile]);

  useEffect(() => {
    applyImportedTileFileRef.current = applyImportedTileFile;
  }, [applyImportedTileFile]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tile';
    input.style.display = 'none';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target?.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        applyImportedTileFileRef.current(text);
      };
      reader.readAsText(file);
      target.value = '';
    };
    document.body.appendChild(input);
    importTileInputRef.current = input;
    return () => {
      if (input.parentNode) {
        document.body.removeChild(input);
      }
      importTileInputRef.current = null;
    };
  }, []);

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

  const selectedFiles = useMemo(
    () => files.filter((f) => selectedFileIds.has(f.id)),
    [files, selectedFileIds]
  );

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

  const exportSelectedPatternsAsTile = useCallback(async () => {
    if (selectedPatternIds.size === 0) {
      setShowPatternExportMenu(false);
      return;
    }
    const selectedPatternsList = activePatterns.filter((p) =>
      selectedPatternIds.has(p.id)
    );
    if (selectedPatternsList.length === 0) {
      setShowPatternExportMenu(false);
      return;
    }
    if (selectedPatternsList.length === 1) {
      const pattern = selectedPatternsList[0];
      const ugcSetIds = getSetIdsFromPatternTiles(pattern.tiles);
      const tileSetsById = new Map(
        userTileSets.filter((s) => ugcSetIds.includes(s.id)).map((s) => [s.id, s])
      );
      const content =
        tileSetsById.size > 0
          ? serializePatternBundle(pattern, tileSetsById)
          : serializePattern(pattern);
      const index = patterns.findIndex((p) => p.id === pattern.id);
      const n = index >= 0 ? index : 0;
      await downloadUgcTileFile(content, `Pattern_${n}.tilepattern`);
      setShowPatternExportMenu(false);
      return;
    }
    if (Platform.OS !== 'web') {
      setShowPatternExportMenu(false);
      return;
    }
    setShowPatternExportMenu(false);
    const zip = new JSZip();
    const tileSetsById = new Map(userTileSets.map((s) => [s.id, s]));
    for (const pattern of selectedPatternsList) {
      const ugcSetIds = getSetIdsFromPatternTiles(pattern.tiles);
      const content =
        ugcSetIds.length > 0
          ? serializePatternBundle(pattern, tileSetsById)
          : serializePattern(pattern);
      const index = patterns.findIndex((p) => p.id === pattern.id);
      const n = index >= 0 ? index : 0;
      zip.file(`Pattern_${n}.tilepattern`, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'patterns.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [activePatterns, selectedPatternIds, patterns, userTileSets]);

  const applyImportedPattern = useCallback(
    (content: string): { ok: false; error: string } | { ok: true } => {
      const bundleResult = deserializeBundle(content);
      if (bundleResult.ok && bundleResult.kind === 'patternBundle') {
        const oldToNewSetId = new Map<string, string>();
        for (const { setId, payload } of bundleResult.payload.tileSets) {
          const newId = importTileSet(payload, { preserveBakedNames: true });
          oldToNewSetId.set(setId, newId);
        }
        const remapped = remapPatternTileNames(
          bundleResult.payload.pattern,
          oldToNewSetId
        );
        const patternTileSetIds = Array.from(oldToNewSetId.values());
        createPattern({
          name: remapped.name,
          category: remapped.category,
          width: remapped.width,
          height: remapped.height,
          tiles: remapped.tiles,
          ...(patternTileSetIds.length > 0 && { tileSetIds: patternTileSetIds }),
        });
        // Auto-select the pattern's UGC sets in the tile set chooser so the pattern
        // thumbnail and painting resolve correctly without the user toggling them on.
        if (patternTileSetIds.length > 0) {
          setSelectedTileSetIds((prev) => {
            const next = [...prev];
            let changed = false;
            patternTileSetIds.forEach((id) => {
              if (!next.includes(id)) {
                next.push(id);
                changed = true;
              }
            });
            return changed ? next : prev;
          });
          setSettings((prev) => ({
            ...prev,
            tileSetIds: [
              ...new Set([...(prev.tileSetIds ?? []), ...patternTileSetIds]),
            ],
          }));
        }
        return { ok: true };
      }
      const parseResult = deserializePattern(content);
      if (!parseResult.ok) {
        return { ok: false, error: parseResult.error };
      }
      const p = parseResult.payload;
      createPattern({
        name: p.name,
        category: p.category,
        width: p.width,
        height: p.height,
        tiles: p.tiles,
      });
      return { ok: true };
    },
    [createPattern, importTileSet]
  );

  const handleImportPatternPress = useCallback(async () => {
    if (Platform.OS === 'web') {
      importPatternInputRef.current?.click();
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) {
        return;
      }
      const uri = result.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const applyResult = applyImportedPattern(content);
      if (!applyResult.ok) {
        Alert.alert('Invalid .tilepattern file', applyResult.error);
      }
    } catch {
      Alert.alert('Import failed', 'Could not read the selected file.');
    }
  }, [applyImportedPattern]);

  useEffect(() => {
    applyImportedPatternRef.current = applyImportedPattern;
  }, [applyImportedPattern]);

  // Load sample files, patterns, and tile sets only on app load when the user has none (once per session).
  useEffect(() => {
    if (
      !ready ||
      !tileSetsLoaded ||
      !shouldLoadSamplesThisSession() ||
      (files.length > 0 && patterns.length > 0 && userTileSets.length > 0)
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (userTileSets.length === 0) {
          const contents = await loadSampleTileSetContents();
          for (const content of contents) {
            if (cancelled) return;
            const result = deserializeTileSet(content);
            if (result.ok) {
              importTileSet(result.payload);
            }
          }
        }
        if (patterns.length === 0) {
          const contents = await loadSamplePatternContents();
          for (const content of contents) {
            if (cancelled) return;
            applyImportedPattern(content);
          }
        }
        if (files.length === 0) {
          const contents = await loadSampleFileContents();
          for (const content of contents) {
            if (cancelled) return;
            const bundleResult = deserializeBundle(content);
            if (bundleResult.ok && bundleResult.kind === 'fileBundle') {
              const oldToNewSetId = new Map<string, string>();
              for (const { setId, payload } of bundleResult.payload.tileSets) {
                const newId = importTileSet(payload, { preserveBakedNames: true });
                oldToNewSetId.set(setId, newId);
              }
              const remapped = remapFilePayload(
                bundleResult.payload.file,
                oldToNewSetId
              );
              createFileFromTileData(remapped, { isSample: true });
            } else {
              const result = deserializeTileFile(content);
              if (result.ok) {
                createFileFromTileData(result.payload, { isSample: true });
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to load sample assets', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    tileSetsLoaded,
    files.length,
    patterns.length,
    userTileSets.length,
    createFileFromTileData,
    applyImportedPattern,
    importTileSet,
  ]);

  const handleReimportSamples = useCallback(async () => {
    try {
      const contents = await loadSampleFileContents();
      for (const content of contents) {
        const bundleResult = deserializeBundle(content);
        if (bundleResult.ok && bundleResult.kind === 'fileBundle') {
          const oldToNewSetId = new Map<string, string>();
          for (const { setId, payload } of bundleResult.payload.tileSets) {
            const newId = importTileSet(payload, { preserveBakedNames: true });
            oldToNewSetId.set(setId, newId);
          }
          const remapped = remapFilePayload(
            bundleResult.payload.file,
            oldToNewSetId
          );
          createFileFromTileData(remapped, { isSample: true });
        } else {
          const result = deserializeTileFile(content);
          if (result.ok) {
            createFileFromTileData(result.payload, { isSample: true });
          }
        }
      }
    } catch (error) {
      console.warn('Failed to reimport sample files', error);
      if (Platform.OS === 'web') {
        window.alert('Failed to reimport samples.');
      } else {
        Alert.alert('Reimport failed', 'Could not load sample files.');
      }
    }
  }, [
    createFileFromTileData,
    importTileSet,
    loadSampleFileContents,
    deserializeBundle,
    deserializeTileFile,
    remapFilePayload,
  ]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tilepattern';
    input.style.display = 'none';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target?.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const applyResult = applyImportedPatternRef.current(text);
        if (!applyResult.ok && typeof window !== 'undefined' && window.alert) {
          window.alert(`Invalid .tilepattern file: ${applyResult.error}`);
        }
      };
      reader.readAsText(file);
      target.value = '';
    };
    document.body.appendChild(input);
    importPatternInputRef.current = input;
    return () => {
      if (input.parentNode) {
        document.body.removeChild(input);
      }
      importPatternInputRef.current = null;
    };
  }, [applyImportedPattern]);

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
      setExportModeForDownload(false);
    }
  };

  /**
   * Build the source list for SVG export so every UGC tile in the file has a source.
   * getSourcesForFile(file) can miss UGC names if file.sourceNames is empty or out of sync.
   * We merge in buildUserTileSourceFromName(tile.name) for every tile.name that contains ':'
   * and isn't already in the list.
   */
  const getSourcesForSvgExport = useCallback(
    (file: TileFile): Array<{ name?: string; source?: unknown }> => {
      const base = getSourcesForFile(file);
      if (Platform.OS === 'web') {
        return base;
      }
      const namesInBase = new Set(
        base.map((s) => (s && typeof s.name === 'string' ? s.name : null)).filter(Boolean) as string[]
      );
      const ugcNamesFromTiles = new Set<string>();
      if (Array.isArray(file.tiles)) {
        for (const tile of file.tiles) {
          if (tile?.name && tile.name.includes(':')) {
            ugcNamesFromTiles.add(tile.name);
          }
        }
      }
      const toAdd: Array<{ name: string; source: unknown }> = [];
      ugcNamesFromTiles.forEach((name) => {
        if (namesInBase.has(name)) {
          return;
        }
        const ugcSource = buildUserTileSourceFromName(name);
        if (ugcSource) {
          toAdd.push(ugcSource);
        }
      });
      return toAdd.length === 0 ? base : [...base, ...toAdd];
    },
    [getSourcesForFile]
  );

  /**
   * Decode data:image/svg+xml URI to raw XML string.
   */
  const decodeDataSvgUri = useCallback((uri: string): string | null => {
    const comma = uri.indexOf(',');
    if (comma < 0) return null;
    const meta = uri.slice(0, comma).toLowerCase();
    const data = uri.slice(comma + 1);
    try {
      if (meta.includes(';base64')) return atob(data);
      return decodeURIComponent(data);
    } catch {
      return null;
    }
  }, []);

  /**
   * Build a map of UGC source name → SVG XML.
   * On native: read each UGC file from disk (file.tiles + sources).
   * On web: decode baked data URIs from sources so UGC is in the map.
   * Passed to renderTileCanvasToSvg as ugcXmlBySourceName so export uses this XML directly.
   */
  const buildUgcXmlBySourceName = useCallback(
    async (
      file: TileFile,
      sources?: Array<{ name?: string; source?: unknown }>
    ): Promise<Map<string, string>> => {
      const map = new Map<string, string>();
      const add = (name: string, xml: string) => {
        if (name && xml) map.set(name, xml);
      };
      if (Platform.OS !== 'web') {
        const readAndSet = async (name: string, uri: string): Promise<void> => {
          if (map.has(name) || !uri.includes('/tile-sets/')) return;
          try {
            const xml = await FileSystem.readAsStringAsync(uri);
            if (xml) map.set(name, xml);
          } catch {
            try {
              const alt = uri.startsWith('file://') ? uri.slice(7) : `file://${uri}`;
              const xml = await FileSystem.readAsStringAsync(alt);
              if (xml) map.set(name, xml);
            } catch {
              // skip
            }
          }
        };
        if (Array.isArray(file.tiles)) {
          for (const tile of file.tiles) {
            if (!tile?.name || !tile.name.includes(':')) continue;
            const ugcSource = buildUserTileSourceFromName(tile.name);
            const uri = ugcSource?.source && typeof ugcSource.source === 'object'
              ? (ugcSource.source as { uri?: string }).uri
              : undefined;
            if (uri) await readAndSet(tile.name, uri);
          }
        }
        if (Array.isArray(sources)) {
          for (const s of sources) {
            if (!s?.name || !s.name.includes(':')) continue;
            const uri = getSourceUri(s.source);
            if (uri) await readAndSet(s.name, uri);
          }
        }
      } else {
        if (Array.isArray(sources)) {
          for (const s of sources) {
            if (!s?.name || !s.name.includes(':')) continue;
            const uri = getSourceUri(s.source);
            if (uri?.startsWith('data:image/svg+xml')) {
              const xml = decodeDataSvgUri(uri);
              if (xml) add(s.name, xml);
            }
          }
        }
      }
      return map;
    },
    [decodeDataSvgUri]
  );

  /**
   * Replace UGC file-path sources with data URI sources by reading each UGC file
   * and inlining its SVG. This ensures the SVG export never has to read files by path
   * (which can fail); it only decodes data URIs.
   */
  const replaceUgcSourcesWithDataUris = useCallback(
    async (
      sources: Array<{ name?: string; source?: unknown }>
    ): Promise<Array<{ name?: string; source?: unknown }>> => {
      const result: Array<{ name?: string; source?: unknown }> = [];
      for (const s of sources) {
        const uri = getSourceUri(s.source);
        const isUgcPath =
          uri &&
          uri.toLowerCase().includes('.svg') &&
          uri.includes('/tile-sets/');
        if (isUgcPath && Platform.OS !== 'web') {
          let xml = '';
          try {
            xml = await FileSystem.readAsStringAsync(uri);
          } catch {
            try {
              xml = uri.startsWith('file://')
                ? await FileSystem.readAsStringAsync(uri.slice(7))
                : await FileSystem.readAsStringAsync(`file://${uri}`);
            } catch {
              // keep original source on read failure
            }
          }
          if (xml) {
            const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(xml)}`;
            result.push({ name: s.name, source: { uri: dataUri } });
            continue;
          }
        }
        result.push(s);
      }
      return result;
    },
    []
  );

  const exportSelectedAsPng = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setShowExportMenu(false);
      return;
    }
    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      if (Platform.OS === 'web') {
        const sources = getSourcesForFile(file);
        void downloadFile(file, sources, {
          backgroundColor: settings.backgroundColor,
          strokeScaleByName,
        });
      } else {
        setIncludeDownloadBackground(true);
        setExportModeForDownload(true);
        setDownloadTargetId(file.id);
        setShowDownloadOverlay(true);
      }
      setShowExportMenu(false);
      return;
    }
    if (Platform.OS !== 'web') {
      setShowExportMenu(false);
      return;
    }
    setShowExportMenu(false);
    const zip = new JSZip();
    for (const file of selectedFiles) {
      const sources = getSourcesForFile(file);
      const dataUrl = await renderTileCanvasToDataUrl({
        tiles: file.tiles,
        gridLayout: {
          rows: file.grid.rows,
          columns: file.grid.columns,
          tileSize: file.preferredTileSize,
        },
        tileSources: sources as any,
        gridGap: 0,
        blankSource: null,
        errorSource: null,
        lineColor: file.lineColor,
        lineWidth: file.lineWidth,
        backgroundColor: settings.backgroundColor,
        strokeScaleByName,
        maxDimension: 0,
      });
      if (dataUrl) {
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        const safeName = file.name.replace(/[^\w-]+/g, '_');
        zip.file(`${safeName}.png`, base64, { base64: true });
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exports.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [selectedFiles, getSourcesForFile, downloadFile, strokeScaleByName, settings.backgroundColor]);

  const exportSelectedAsSvg = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setShowExportMenu(false);
      return;
    }
    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      if (Platform.OS === 'web') {
        const sources = getSourcesForSvgExport(file);
        const ugcXmlBySourceName = await buildUgcXmlBySourceName(file, sources);
        const sourcesWithInlineUgc = await replaceUgcSourcesWithDataUris(sources);
        const sourceXmlCache = await buildSourceXmlCache(sourcesWithInlineUgc);
        await exportTileCanvasAsSvg({
          tiles: file.tiles,
          gridLayout: {
            rows: file.grid.rows,
            columns: file.grid.columns,
            tileSize: file.preferredTileSize,
          },
          tileSources: sourcesWithInlineUgc,
          gridGap: GRID_GAP,
          errorSource: ERROR_TILE,
          lineColor: file.lineColor,
          lineWidth: file.lineWidth,
          backgroundColor: settings.backgroundColor,
          strokeScaleByName,
          sourceXmlCache,
          ugcXmlBySourceName,
          fileName: `${file.name.replace(/[^\w-]+/g, '_')}.svg`,
        });
      } else {
        setIncludeDownloadBackground(true);
        setExportModeForDownload(true);
        setDownloadTargetId(file.id);
        setShowDownloadOverlay(true);
      }
      setShowExportMenu(false);
      return;
    }
    if (Platform.OS !== 'web') {
      setShowExportMenu(false);
      return;
    }
    setShowExportMenu(false);
    const zip = new JSZip();
    for (const file of selectedFiles) {
      const sources = getSourcesForSvgExport(file);
      const ugcXmlBySourceName = await buildUgcXmlBySourceName(file, sources);
      const sourcesWithInlineUgc = await replaceUgcSourcesWithDataUris(sources);
      const sourceXmlCache = await buildSourceXmlCache(sourcesWithInlineUgc);
      const svg = await renderTileCanvasToSvg({
        tiles: file.tiles,
        gridLayout: {
          rows: file.grid.rows,
          columns: file.grid.columns,
          tileSize: file.preferredTileSize,
        },
        tileSources: sourcesWithInlineUgc,
        gridGap: GRID_GAP,
        errorSource: ERROR_TILE,
        lineColor: file.lineColor,
        lineWidth: file.lineWidth,
        backgroundColor: settings.backgroundColor,
        sourceXmlCache,
        ugcXmlBySourceName,
        strokeScaleByName,
      });
      if (svg) {
        const safeName = file.name.replace(/[^\w-]+/g, '_');
        zip.file(`${safeName}.svg`, svg);
      }
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exports.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [
    selectedFiles,
    getSourcesForSvgExport,
    buildUgcXmlBySourceName,
    replaceUgcSourcesWithDataUris,
    buildSourceXmlCache,
    settings.backgroundColor,
    strokeScaleByName,
  ]);

  const downloadSingleFileAsTile = useCallback(
    async (file: TileFile) => {
      const sortedFiles = [...files].sort((a, b) => b.updatedAt - a.updatedAt);
      const fileIndex = sortedFiles.findIndex((f) => f.id === file.id);
      const index = fileIndex >= 0 ? fileIndex : 0;
      const fileName = `TileCanvas_${index}.tile`;
      const tileSetsById = new Map(userTileSets.map((s) => [s.id, s]));
      const content = fileUsesUgc(file)
        ? serializeFileBundle(file, tileSetsById)
        : serializeTileFile(file);
      await downloadUgcTileFile(content, fileName);
    },
    [files, userTileSets]
  );

  const exportSelectedAsTile = useCallback(async () => {
    if (selectedFiles.length === 0) {
      setShowExportMenu(false);
      return;
    }
    if (selectedFiles.length === 1) {
      await downloadSingleFileAsTile(selectedFiles[0]);
      setShowExportMenu(false);
      return;
    }
    const sortedFiles = [...files].sort((a, b) => b.updatedAt - a.updatedAt);
    const tileSetsById = new Map(userTileSets.map((s) => [s.id, s]));
    if (Platform.OS !== 'web') {
      setShowExportMenu(false);
      return;
    }
    setShowExportMenu(false);
    const zip = new JSZip();
    for (const file of selectedFiles) {
      const content = fileUsesUgc(file)
        ? serializeFileBundle(file, tileSetsById)
        : serializeTileFile(file);
      const fileIndex = sortedFiles.findIndex((f) => f.id === file.id);
      const index = fileIndex >= 0 ? fileIndex : 0;
      zip.file(`TileCanvas_${index}.tile`, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exports.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [selectedFiles, files, userTileSets, downloadSingleFileAsTile]);

  const handleDownloadSvg = async () => {
    if (!downloadTargetFile) {
      return;
    }
    setIsDownloading(true);
    try {
      const sources = getSourcesForSvgExport(downloadTargetFile);
      const ugcXmlBySourceName = await buildUgcXmlBySourceName(downloadTargetFile, sources);
      const sourcesWithInlineUgc = await replaceUgcSourcesWithDataUris(sources);
      const sourceXmlCache = await buildSourceXmlCache(sourcesWithInlineUgc);
      const svg = await renderTileCanvasToSvg({
        tiles: downloadTargetFile.tiles,
        gridLayout: {
          rows: downloadTargetFile.grid.rows,
          columns: downloadTargetFile.grid.columns,
          tileSize: downloadTargetFile.preferredTileSize,
        },
        tileSources: sourcesWithInlineUgc,
        gridGap: GRID_GAP,
        errorSource: ERROR_TILE,
        lineColor: downloadTargetFile.lineColor,
        lineWidth: downloadTargetFile.lineWidth,
        backgroundColor: includeDownloadBackground
          ? settings.backgroundColor
          : undefined,
        sourceXmlCache,
        ugcXmlBySourceName,
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
      setExportModeForDownload(false);
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
      ? FILE_THUMB_DISPLAY_SIZE * 2
      : FILE_THUMB_DISPLAY_SIZE;
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
          {Platform.OS === 'web' && !useIsMobileWeb() ? (
            <DesktopNavTabs />
          ) : (
            <Pressable
              onPress={() => {
                router.push('/tileSetCreator');
              }}
              accessibilityRole="button"
              accessibilityLabel="Open tile sets"
            >
              <ThemedText type="title" style={styles.fileTitle}>
                Files
              </ThemedText>
            </Pressable>
          )}
          <ThemedView style={styles.fileHeaderActions}>
            <ToolbarButton
              label="Import .tile file"
              icon="upload"
              color="#fff"
              onPress={handleImportTileFilePress}
            />
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
          <View style={styles.fileSelectDeleteExportRow}>
            <Pressable
              onPress={() => selectedFileIds.size > 0 && deleteSelectedFiles()}
              style={[
                styles.fileSelectDelete,
                selectedFileIds.size === 0 && styles.fileSelectDeleteDisabled,
              ]}
              disabled={selectedFileIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel="Delete selected files"
            >
              <ThemedText
                type="defaultSemiBold"
                style={[
                  styles.fileSelectDeleteText,
                  selectedFileIds.size === 0 && styles.fileSelectDeleteTextDisabled,
                ]}
              >
                Delete
              </ThemedText>
            </Pressable>
            <ThemedText type="defaultSemiBold" style={styles.fileSelectPipe}>
              {' | '}
            </ThemedText>
            <Pressable
              onPress={() => selectedFileIds.size > 0 && setShowExportMenu(true)}
              style={[
                styles.fileSelectExport,
                selectedFileIds.size === 0 && styles.fileSelectExportDisabled,
              ]}
              disabled={selectedFileIds.size === 0}
              accessibilityRole="button"
              accessibilityLabel="Export selected files"
            >
              <ThemedText
                type="defaultSemiBold"
                style={[
                  styles.fileSelectExportText,
                  selectedFileIds.size === 0 && styles.fileSelectExportTextDisabled,
                ]}
              >
                Export
              </ThemedText>
            </Pressable>
          </View>
          {!isMobileWeb && (
            <ThemedText type="defaultSemiBold" style={styles.fileSelectCount}>
              {selectedFileIds.size > 0 ? `${selectedFileIds.size} selected` : ''}
            </ThemedText>
          )}
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
            tabBarVisible &&
              viewMode !== 'modify' && {
                paddingBottom:
                  FILE_GRID_GAP + TAB_BAR_HEIGHT + insets.bottom,
              },
          ]}
          showsVerticalScrollIndicator
        >
          {userFiles.map((file) => {
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
                onContextMenu={Platform.OS === 'web' ? (e) => e.preventDefault() : undefined}
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
                  )}
                </ThemedView>
              </Pressable>
            );
          })}
          <View style={styles.fileGridSectionDivider} />
          <ThemedText style={styles.fileGridSectionTitle}>Samples</ThemedText>
          {sampleFiles.length > 0 ? (
            sampleFiles.map((file) => {
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
                  onContextMenu={Platform.OS === 'web' ? (e) => e.preventDefault() : undefined}
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
                    )}
                  </ThemedView>
                </Pressable>
              );
            })
          ) : (
            <Pressable
              onPress={() => void handleReimportSamples()}
              style={styles.reimportSamplesButton}
              accessibilityRole="button"
              accessibilityLabel="Reimport sample files"
            >
              <ThemedText type="defaultSemiBold" style={styles.reimportSamplesButtonText}>
                Reimport
              </ThemedText>
            </Pressable>
          )}
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
              {!exportModeForDownload && (
                <ThemedView style={styles.downloadOptions}>
                  <ThemedText type="defaultSemiBold">Include background color</ThemedText>
                  <Switch
                    value={includeDownloadBackground}
                    onValueChange={(value) => setIncludeDownloadBackground(value)}
                    accessibilityLabel="Include background color in download"
                  />
                </ThemedView>
              )}
              <ThemedView style={styles.downloadActions}>
                <Pressable
                  style={[
                    styles.downloadActionButton,
                    isDownloading && styles.downloadActionDisabled,
                  ]}
                  onPress={() => {
                    setShowDownloadOverlay(false);
                    setDownloadTargetId(null);
                    setExportModeForDownload(false);
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
                      const sources = getSourcesForSvgExport(file);
                      void (async () => {
                        const ugcXmlBySourceName = await buildUgcXmlBySourceName(file, sources);
                        const sourcesWithInlineUgc = await replaceUgcSourcesWithDataUris(sources);
                        const sourceXmlCache = await buildSourceXmlCache(sourcesWithInlineUgc);
                        await exportTileCanvasAsSvg({
                          tiles: file.tiles,
                          gridLayout: {
                            rows: file.grid.rows,
                            columns: file.grid.columns,
                            tileSize: file.preferredTileSize,
                          },
                          tileSources: sourcesWithInlineUgc,
                          gridGap: GRID_GAP,
                          errorSource: ERROR_TILE,
                          lineColor: file.lineColor,
                          lineWidth: file.lineWidth,
                          backgroundColor: includeDownloadBackground
                            ? settings.backgroundColor
                            : undefined,
                          strokeScaleByName,
                          sourceXmlCache,
                          ugcXmlBySourceName,
                          fileName: `${file.name}.svg`,
                        });
                      })();
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
                  const file = files.find((entry) => entry.id === fileMenuTargetId);
                  if (file) {
                    void downloadSingleFileAsTile(file);
                  }
                  setFileMenuTargetId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Download .tile file"
              >
                <ThemedText type="defaultSemiBold">Download .tile</ThemedText>
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
        {showExportMenu && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowExportMenu(false)}
              accessibilityRole="button"
              accessibilityLabel="Close export options"
            />
            <ThemedView style={styles.fileMenuPanel}>
              <Pressable
                style={styles.fileMenuButton}
                onPress={() => void exportSelectedAsPng()}
                accessibilityRole="button"
                accessibilityLabel="Export PNG"
              >
                <ThemedText type="defaultSemiBold">Export PNG</ThemedText>
              </Pressable>
              <Pressable
                style={styles.fileMenuButton}
                onPress={() => void exportSelectedAsSvg()}
                accessibilityRole="button"
                accessibilityLabel="Export SVG"
              >
                <ThemedText type="defaultSemiBold">Export SVG</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.fileMenuButton, styles.fileMenuButtonLast]}
                onPress={() => void exportSelectedAsTile()}
                accessibilityRole="button"
                accessibilityLabel="Export .tile file"
              >
                <ThemedText type="defaultSemiBold">Export .tile</ThemedText>
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
              <ThemedText type="title">
                {isWeb && !isMobileWeb ? 'Preferred Tile Size' : 'New File Size'}
              </ThemedText>
              <ThemedView style={styles.newFileGrid}>
                {(Platform.OS === 'ios' || isMobileWeb
                  ? NEW_FILE_RESOLUTION_SIMPLE
                  : NEW_FILE_TILE_SIZES.map((size) => ({ label: String(size), size }))
                ).map((option) => (
                  <Pressable
                    key={`new-file-size-${option.label}`}
                    onPress={() => {
                      const initialSources = getSourcesForSelection(
                        activeCategories,
                        selectedTileSetIds
                      ).map((source) => source.name);
                      createFile(DEFAULT_CATEGORY, option.size, {
                        lineWidth: activeLineWidth,
                        lineColor: activeLineColor,
                        tileSetIds: selectedTileSetIds,
                        sourceNames: initialSources,
                      });
                      setFileSourceNames(initialSources);
                      setZoomRegion(null);
                      setLoadRequestId((prev) => prev + 1);
                      setLoadPreviewUri(null);
                      setSuspendTiles(true);
                      setLoadedToken(0);
                      setHydrating(true);
                      setShowNewFileModal(false);
                      setShowModifyTileSetBanner(false);
                      setViewMode('modify');
                    }}
                    style={styles.newFileButton}
                    accessibilityRole="button"
                    accessibilityLabel={
                      Platform.OS === 'ios' || isMobileWeb
                        ? `Create file with resolution ${option.label} (${option.size}px)`
                        : `Create file with tile size ${option.size}`
                    }
                  >
                    <ThemedText type="defaultSemiBold">{option.label}</ThemedText>
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
              <Pressable
                style={styles.settingsAction}
                onPress={() => {
                  setShowSettingsOverlay(false);
                  router.push('/manual');
                }}
                accessibilityRole="button"
                accessibilityLabel="View manual"
              >
                <ThemedText type="defaultSemiBold">View manual</ThemedText>
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
              <TouchableOpacity
                style={[styles.settingsAction, styles.settingsActionDanger]}
                onPress={() => {
                  const message =
                    'Delete all local data? This will permanently delete all saved files, tile sets, patterns, and favorites, and reset all settings to their defaults. This cannot be undone.';
                  const doDelete = async () => {
                    await clearAllLocalData();
                    setSettings(getDefaultSettings());
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
              <ThemedView style={styles.settingsPlatformFooter}>
                <ThemedText style={styles.settingsPlatformLabel}>{platformLabel}</ThemedText>
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
          paddingBottom:
            tabBarVisible && viewMode !== 'modify'
              ? TAB_BAR_HEIGHT + insets.bottom
              : 0,
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
            <Pressable
              onPress={() => {
                if (zoomRegion) {
                  setZoomRegion(null);
                } else {
                  persistActiveFileNow();
                  setViewMode('file');
                }
              }}
              style={styles.navBackSquare}
              accessibilityRole="button"
              accessibilityLabel={zoomRegion ? 'Zoom out to full canvas' : 'Back to file list'}
            >
              <ThemedText type="defaultSemiBold" style={styles.navButtonText}>
                &lt;
              </ThemedText>
            </Pressable>
            <NavButton
              label="Tiles"
              onPress={() => {
                if (showModifyTileSetBanner) {
                  dismissModifyBanner();
                } else {
                  setShowModifyTileSetBanner(true);
                }
              }}
            />
            <ThemedView
              style={[
                styles.controls,
                (Platform.OS === 'ios' || (isWeb && isMobileWeb)) && {
                  gap: 0,
                },
              ]}
            >
            {!(isWeb && isMobileWeb) && (
              <>
                <ToolbarButton
                  label="Undo"
                  icon="undo"
                  disabled={!canUndo}
                  onPress={() => {
                    dismissModifyBanner();
                    showUndoRedoBanner('undoing');
                    undo();
                  }}
                />
                <ToolbarButton
                  label="Redo"
                  icon="redo"
                  disabled={!canRedo}
                  onPress={() => {
                    dismissModifyBanner();
                    showUndoRedoBanner('redoing');
                    redo();
                  }}
                />
              </>
            )}
            <View style={styles.selectionWithRegionToolsWrapper}>
              <ToolbarButton
                key={`selection-${isSelectionMode}`}
                label="Selection"
                icon="select-drag"
                active={isSelectionMode}
                onPress={() => {
                  dismissModifyBanner();
                  setIsSelectionMode((prev) => !prev);
                  setCanvasSelection(null);
                }}
              />
              {regionToolsVisible && (
                <Animated.View
                  style={[
                    styles.regionToolsBarOuter,
                    {
                      opacity: regionToolsOpacity,
                      transform: [
                        { translateY: regionToolsTranslateY },
                        { scale: regionToolsScale },
                      ],
                    },
                  ]}
                >
                  <View style={styles.regionToolsBarInner}>
                  {showLockButton && (() => {
                    const selectionIndices =
                      canvasSelection && fullGridColumnsForMapping > 0
                        ? getCellIndicesInRegion(
                            canvasSelection.start,
                            canvasSelection.end,
                            fullGridColumnsForMapping
                          )
                        : [];
                    const allSelectedLocked =
                      selectionIndices.length > 0 &&
                      (lockedCellIndicesSet
                        ? selectionIndices.every((i) => lockedCellIndicesSet.has(i))
                        : false);
                    return (
                      <ToolbarButton
                        label={allSelectedLocked ? 'Unlock region' : 'Lock region'}
                        icon="lock"
                        active={allSelectedLocked}
                        color={allSelectedLocked ? '#dc2626' : undefined}
                        onPress={() => {
                          dismissModifyBanner();
                          if (!canvasSelection || fullGridColumnsForMapping === 0) return;
                          const indices = getCellIndicesInRegion(
                            canvasSelection.start,
                            canvasSelection.end,
                            fullGridColumnsForMapping
                          );
                          if (lockedCellIndicesSet && indices.every((i) => lockedCellIndicesSet.has(i))) {
                            const next = (activeFile?.lockedCells ?? []).filter(
                              (i) => !indices.includes(i)
                            );
                            updateActiveFileLockedCells(next);
                          } else {
                            const next = [...new Set([...(activeFile?.lockedCells ?? []), ...indices])];
                            updateActiveFileLockedCells(next);
                          }
                        }}
                      />
                    );
                  })()}
                  {showZoomButton && (() => {
                    if (zoomRegion) {
                      return (
                        <ToolbarButton
                          label="Zoom out"
                          icon="magnify-minus-outline"
                          active
                          onPress={() => {
                            dismissModifyBanner();
                            setZoomRegion(null);
                          }}
                        />
                      );
                    }
                    if (!canvasSelection || gridLayout.columns === 0) return null;
                    return (
                      <ToolbarButton
                        label="Zoom to selection"
                        icon="magnify-plus-outline"
                        onPress={() => {
                          dismissModifyBanner();
                          if (!canvasSelection || gridLayout.columns === 0) return;
                          const { minRow, maxRow, minCol, maxCol } = getSelectionBounds(
                            canvasSelection.start,
                            canvasSelection.end
                          );
                          startTransition(() => {
                            setZoomRegion({ minRow, maxRow, minCol, maxCol });
                            setIsSelectionMode(false);
                            setCanvasSelection(null);
                          });
                        }}
                      />
                    );
                  })()}
                  <ToolbarButton
                    label="Move region"
                    icon="cursor-move"
                    onPress={() => {
                      dismissModifyBanner();
                      if (!canvasSelection || gridLayout.columns === 0) return;
                      // TODO: enter move mode or show move UI
                    }}
                  />
                  <ToolbarButton
                    label="Rotate region"
                    icon="rotate-right"
                    onPress={() => {
                      dismissModifyBanner();
                      if (!canvasSelection || gridLayout.columns === 0) return;
                      // TODO: rotate selected region 90° CW
                    }}
                  />
                  </View>
                </Animated.View>
              )}
            </View>
            <ToolbarButton
              label="Reset"
              icon="refresh"
              onPress={() => {
                dismissModifyBanner();
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
                dismissModifyBanner();
                if (floodLongPressHandledRef.current) {
                  floodLongPressHandledRef.current = false;
                  return;
                }
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                pendingFloodCompleteRef.current = setTimeout(() => {
                  pendingFloodCompleteRef.current = null;
                  floodFill();
                }, 0);
              }}
              onLongPress={() => {
                dismissModifyBanner();
                floodLongPressHandledRef.current = true;
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
                dismissModifyBanner();
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                reconcileTiles();
              }}
              onLongPress={() => {
                dismissModifyBanner();
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                controlledRandomize();
              }}
            />
            <ToolbarButton
              label={
                !settings.mirrorHorizontal && !settings.mirrorVertical
                  ? 'Mirror (off)'
                  : settings.mirrorHorizontal && settings.mirrorVertical
                    ? 'Mirror: Horizontal + Vertical'
                    : settings.mirrorHorizontal
                      ? 'Mirror: Horizontal'
                      : 'Mirror: Vertical'
              }
              icon={
                !settings.mirrorHorizontal && !settings.mirrorVertical
                  ? 'flip-horizontal'
                  : settings.mirrorHorizontal && settings.mirrorVertical
                    ? 'arrow-all'
                    : settings.mirrorHorizontal
                      ? 'flip-horizontal'
                      : 'flip-vertical'
              }
              active={settings.mirrorHorizontal || settings.mirrorVertical}
              color={
                settings.mirrorHorizontal || settings.mirrorVertical
                  ? '#3b82f6'
                  : undefined
              }
              onPress={() => {
                dismissModifyBanner();
                setSettings((prev) => {
                  const { mirrorHorizontal: h, mirrorVertical: v } = prev;
                  if (!h && !v) return { ...prev, mirrorHorizontal: true };
                  if (h && !v) return { ...prev, mirrorVertical: true };
                  if (h && v) return { ...prev, mirrorHorizontal: false };
                  return { ...prev, mirrorVertical: false };
                });
              }}
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
            key={zoomRegion ? `zoomed-${gridLayout.rows}-${gridLayout.columns}` : `full-${gridLayout.rows}-${gridLayout.columns}`}
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
          {canvasSelectionRect && (
            <View
              pointerEvents="none"
              style={[styles.canvasSelectionBox, canvasSelectionRect]}
            />
          )}
          {lockedBoundaryEdges.map((rect, idx) => (
            <View
              key={`locked-edge-${idx}`}
              pointerEvents="none"
              style={[styles.lockedBoundaryEdge, rect]}
            />
          ))}
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
                  canvasMouseDidMoveRef.current = false;
                  setInteracting(true);
                  markInteractionStart();
                  const point = getRelativePoint(event);
                if (point) {
                  const cellIndex = getCellIndexForPoint(point.x, point.y);
                  if (cellIndex === null) {
                    return;
                  }
                  if (isSelectionMode) {
                    const fullIdx = getFullIndexForCanvas(cellIndex);
                    setCanvasSelection({ start: fullIdx, end: fullIdx });
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
                    return;
                  }
                  if (lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))) {
                    setIsSelectionMode(true);
                    const fullIdx = getFullIndexForCanvas(cellIndex);
                    setCanvasSelection({ start: fullIdx, end: fullIdx });
                    return;
                  }
                  if (brush.mode === 'clone' && cloneSourceIndex === null) {
                    setCloneSource(cellIndex);
                    lastPaintedRef.current = null;
                    return;
                  }
                  if (!isPartOfDragRef.current) {
                    pushUndoForDragStart();
                    isPartOfDragRef.current = true;
                  }
                  handlePaintAt(point.x, point.y);
                }
              }}
              onMouseMove={(event: any) => {
                if (event.buttons === 1) {
                  canvasMouseDidMoveRef.current = true;
                  const point = getRelativePoint(event);
                  if (point) {
                    if (isSelectionMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        const fullIdx = getFullIndexForCanvas(cellIndex);
                        setCanvasSelection((prev) =>
                          prev ? { ...prev, end: fullIdx } : prev
                        );
                      }
                      return;
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
                }
              }}
              onMouseLeave={() => {
                isPartOfDragRef.current = false;
                clearDrawStroke();
                setInteracting(false);
                lastPaintedRef.current = null;
              }}
              onMouseUp={(event: any) => {
                isPartOfDragRef.current = false;
                clearDrawStroke();
                setInteracting(false);
                const now = Date.now();
                if (
                  isSelectionMode &&
                  !canvasMouseDidMoveRef.current &&
                  now - lastCanvasClickTimeRef.current < 400
                ) {
                  lastCanvasClickTimeRef.current = 0;
                  setIsSelectionMode(false);
                  setCanvasSelection(null);
                  return;
                }
                lastCanvasClickTimeRef.current = now;
                if (isSelectionMode) {
                  if (canvasSelection && canvasSelection.start === canvasSelection.end) {
                    setCanvasSelection(null);
                  }
                  return;
                }
                if (isPatternCreationMode) {
                  if (patternSelection) {
                    setShowPatternSaveModal(true);
                  }
                  return;
                }
                lastPaintedRef.current = null;
              }}
              onDoubleClick={() => {
                setIsSelectionMode(false);
                setCanvasSelection(null);
              }}
              onTouchStartCapture={(event: any) => {
                // Use capture phase so we receive touchstart even when the target is a child
                // (e.g. tile image). Otherwise on mobile web, starting a drag on an initialized
                // tile only fires tap and touchmove never runs.
                const touchCount = event?.touches?.length ?? 0;
                if (isWeb && isMobileWeb && touchCount >= 2) {
                  pendingSingleTouchPointRef.current = null;
                  pendingSingleTouchStartTimeRef.current = 0;
                  multiFingerTouchCountRef.current = touchCount === 3 ? 3 : 2;
                  isTouchDragActiveRef.current = true;
                  canvasTouchDidMoveRef.current = false;
                  setInteracting(true);
                  return;
                }
                if (isWeb && isMobileWeb && touchCount === 1) {
                  setInteracting(true);
                  markInteractionStart();
                  isTouchDragActiveRef.current = true;
                  canvasTouchDidMoveRef.current = false;
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
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex !== null && !isSelectionMode && !isPatternCreationMode && !(brush.mode === 'clone' && cloneSourceIndex === null)) {
                      if (lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))) {
                        multiFingerTouchCountRef.current = 0;
                        setIsSelectionMode(true);
                        const fullIdx = getFullIndexForCanvas(cellIndex);
                        setCanvasSelection({ start: fullIdx, end: fullIdx });
                        return;
                      }
                      pendingSingleTouchPointRef.current = { x: point.x, y: point.y };
                      pendingSingleTouchStartTimeRef.current = Date.now();
                      multiFingerTouchCountRef.current = 0;
                      return;
                    }
                  }
                  multiFingerTouchCountRef.current = 0;
                }
                isTouchDragActiveRef.current = true;
                canvasTouchDidMoveRef.current = false;
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
                  if (isSelectionMode) {
                    const fullIdx = getFullIndexForCanvas(cellIndex);
                    setCanvasSelection({ start: fullIdx, end: fullIdx });
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
                    return;
                  }
                  if (lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))) {
                    setIsSelectionMode(true);
                    const fullIdx = getFullIndexForCanvas(cellIndex);
                    setCanvasSelection({ start: fullIdx, end: fullIdx });
                    return;
                  }
                  if (brush.mode === 'clone' && cloneSourceIndex === null) {
                    setCloneSource(cellIndex);
                    lastPaintedRef.current = null;
                    return;
                  }
                  if (!isPartOfDragRef.current) {
                    pushUndoForDragStart();
                    isPartOfDragRef.current = true;
                  }
                  handlePaintAt(point.x, point.y);
                }
              }}
              onTouchMoveCapture={(event: any) => {
                if (!isTouchDragActiveRef.current) {
                  return;
                }
                canvasTouchDidMoveRef.current = true;
                if (multiFingerTouchCountRef.current >= 2) {
                  return;
                }
                const point = getRelativePoint(event);
                if (isWeb && isMobileWeb && pendingSingleTouchPointRef.current && point) {
                  const startedAt = pendingSingleTouchStartTimeRef.current;
                  const pt = pendingSingleTouchPointRef.current;
                  const delayPassed = Date.now() - startedAt >= MOBILE_WEB_COMMIT_MOVE_DELAY_MS;
                  const movedEnough = Math.hypot(point.x - pt.x, point.y - pt.y) >= MOBILE_WEB_COMMIT_MOVE_MIN_PX;
                  if (delayPassed && movedEnough) {
                    pendingSingleTouchPointRef.current = null;
                    pendingSingleTouchStartTimeRef.current = 0;
                    if (!isPartOfDragRef.current) {
                      pushUndoForDragStart();
                      isPartOfDragRef.current = true;
                    }
                    handlePaintAt(pt.x, pt.y);
                  }
                }
                if (point) {
                  if (isSelectionMode) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex !== null) {
                      const fullIdx = getFullIndexForCanvas(cellIndex);
                      setCanvasSelection((prev) =>
                        prev ? { ...prev, end: fullIdx } : prev
                      );
                    }
                    return;
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
              onTouchEndCapture={(event: any) => {
                const touchCount = event?.touches?.length ?? 0;
                if (isWeb && isMobileWeb && touchCount === 0 && pendingSingleTouchPointRef.current && multiFingerTouchCountRef.current === 0 && !canvasTouchDidMoveRef.current) {
                  const pt = pendingSingleTouchPointRef.current;
                  pendingSingleTouchPointRef.current = null;
                  pendingSingleTouchStartTimeRef.current = 0;
                  if (!isPartOfDragRef.current) {
                    pushUndoForDragStart();
                    isPartOfDragRef.current = true;
                  }
                  handlePaintAt(pt.x, pt.y);
                }
                if (isWeb && isMobileWeb && touchCount === 0) {
                  const count = multiFingerTouchCountRef.current;
                  multiFingerTouchCountRef.current = 0;
                  if (
                    count === 2 &&
                    !canvasTouchDidMoveRef.current &&
                    canUndo
                  ) {
                    showUndoRedoBanner('undoing');
                    undo();
                    isTouchDragActiveRef.current = false;
                    setInteracting(false);
                    return;
                  }
                  if (
                    count === 3 &&
                    !canvasTouchDidMoveRef.current &&
                    canRedo
                  ) {
                    showUndoRedoBanner('redoing');
                    redo();
                    isTouchDragActiveRef.current = false;
                    setInteracting(false);
                    return;
                  }
                }
                isPartOfDragRef.current = false;
                clearDrawStroke();
                isTouchDragActiveRef.current = false;
                setInteracting(false);
                const now = Date.now();
                if (
                  !canvasTouchDidMoveRef.current &&
                  now - lastCanvasTapTimeRef.current < 400
                ) {
                  lastCanvasTapTimeRef.current = 0;
                  setIsSelectionMode(false);
                  setCanvasSelection(null);
                  return;
                }
                lastCanvasTapTimeRef.current = now;
                if (isSelectionMode) {
                  if (canvasSelection && canvasSelection.start === canvasSelection.end) {
                    setCanvasSelection(null);
                  }
                  return;
                }
                if (isPatternCreationMode) {
                  if (patternSelection) {
                    setShowPatternSaveModal(true);
                  }
                  return;
                }
                lastPaintedRef.current = null;
              }}
              onTouchCancelCapture={() => {
                pendingSingleTouchPointRef.current = null;
                pendingSingleTouchStartTimeRef.current = 0;
                multiFingerTouchCountRef.current = 0;
                isPartOfDragRef.current = false;
                clearDrawStroke();
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
                        isLocked={lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))}
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
                  lockedCellIndices={lockedCellIndicesArray}
                  lockedBoundaryEdges={lockedBoundaryEdges}
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
                          isLocked={lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))}
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
                  canvasTouchDidMoveRef.current = false;
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (isSelectionMode) {
                      const fullIdx = getFullIndexForCanvas(cellIndex);
                      setCanvasSelection({ start: fullIdx, end: fullIdx });
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
                      if (!isPartOfDragRef.current) {
                        pushUndoForDragStart();
                        isPartOfDragRef.current = true;
                      }
                      paintCellIndex(cellIndex);
                    } else if (cloneSourceIndex === null) {
                      setCloneSource(cellIndex);
                      lastPaintedRef.current = null;
                    }
                  }
                }}
                onResponderMove={(event: any) => {
                  canvasTouchDidMoveRef.current = true;
                  const point = getRelativePoint(event);
                  if (point) {
                    if (isSelectionMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        const fullIdx = getFullIndexForCanvas(cellIndex);
                        setCanvasSelection((prev) =>
                          prev ? { ...prev, end: fullIdx } : prev
                        );
                      }
                      return;
                    }
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
                onResponderRelease={(event: any) => {
                  isPartOfDragRef.current = false;
                  clearDrawStroke();
                  setInteracting(false);
                  const now = Date.now();
                  if (
                    !canvasTouchDidMoveRef.current &&
                    now - lastCanvasTapTimeRef.current < 400
                  ) {
                    lastCanvasTapTimeRef.current = 0;
                    setIsSelectionMode(false);
                    setCanvasSelection(null);
                    return;
                  }
                  lastCanvasTapTimeRef.current = now;
                  if (isSelectionMode) {
                    if (canvasSelection && canvasSelection.start === canvasSelection.end) {
                      setCanvasSelection(null);
                    }
                    return;
                  }
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
                  isPartOfDragRef.current = false;
                  clearDrawStroke();
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
          {undoRedoBanner !== null && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.undoRedoBanner,
                {
                  transform: [{ translateY: undoRedoBannerTranslateY }],
                },
              ]}
            >
              <Text
                style={styles.undoRedoBannerText}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {undoRedoBanner === 'undoing' ? 'Undoing' : 'Redoing'}
              </Text>
            </Animated.View>
          )}
          {zoomRegion !== null && (
            <View pointerEvents="box-none" style={[styles.undoRedoBanner, styles.zoomedBannerRow]}>
              <Text
                style={styles.undoRedoBannerText}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Zoomed in
              </Text>
              <Pressable
                onPress={() => setZoomRegion(null)}
                hitSlop={8}
                style={({ pressed }) => [styles.zoomedBannerBackLink, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Zoom out to full canvas"
              >
                <Text style={styles.zoomedBannerBackLinkText}>Back</Text>
              </Pressable>
            </View>
          )}
          </View>
          {showModifyTileSetBanner && (
            <>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={dismissModifyBanner}
                accessibilityRole="button"
                accessibilityLabel="Dismiss tile set banner"
              />
              <Animated.View
                style={[
                  styles.modifyTileSetBanner,
                  { transform: [{ translateY: modifyBannerTranslateY }] },
                ]}
                pointerEvents="box-none"
              >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                style={styles.modifyTileSetBannerScroll}
                contentContainerStyle={styles.modifyTileSetBannerScrollContent}
              >
                {TILE_CATEGORIES.map((category) => {
                  const isSelected = selectedCategories.includes(category);
                  const firstTile =
                    TILE_CATEGORY_THUMBNAILS[category] ?? TILE_MANIFEST[category][0];
                  return (
                    <Pressable
                      key={category}
                      onPress={() => {
                        if (
                          isSelected &&
                          selectedCategories.length === 1 &&
                          selectedTileSetIds.length === 0
                        ) {
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
                      style={styles.modifyTileSetBannerThumbWrap}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={[
                          styles.modifyTileSetBannerThumb,
                          !isSelected && styles.modifyTileSetBannerThumbUnselected,
                          isSelected && styles.modifyTileSetBannerThumbSelected,
                        ]}
                      >
                        {firstTile && (
                          <TileAsset
                            source={firstTile.source}
                            name={firstTile.name}
                            style={styles.modifyTileSetBannerThumbImage}
                            resizeMode="cover"
                          />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
                {userTileSets.map((set) => {
                  const isSelected = selectedTileSetIds.includes(set.id);
                  const firstTile =
                    [...set.tiles].sort((a, b) =>
                      (a.name ?? '').localeCompare(b.name ?? '')
                    )[0] ?? null;
                  const thumbUri = firstTile?.thumbnailUri ?? firstTile?.previewUri ?? null;
                  const bakedSources = bakedSourcesBySetId[set.id] ?? [];
                  const firstBakedSource = bakedSources[0];
                  const thumbSource =
                    thumbUri
                      ? { uri: thumbUri }
                      : firstBakedSource?.source
                        ? firstBakedSource.source
                        : null;
                  return (
                    <Pressable
                      key={set.id}
                      onPress={() => {
                        if (
                          isSelected &&
                          selectedTileSetIds.length === 1 &&
                          selectedCategories.length === 0
                        ) {
                          return;
                        }
                        const nextTileSetIds = isSelected
                          ? selectedTileSetIds.filter((entry) => entry !== set.id)
                          : [...selectedTileSetIds, set.id];
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
                      style={styles.modifyTileSetBannerThumbWrap}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <View
                        style={[
                          styles.modifyTileSetBannerThumb,
                          styles.modifyTileSetBannerThumbUgc,
                          !isSelected && styles.modifyTileSetBannerThumbUnselected,
                          isSelected && styles.modifyTileSetBannerThumbSelected,
                        ]}
                      >
                        {thumbSource ? (
                          <TileAsset
                            source={thumbSource}
                            name={firstBakedSource?.name ?? 'thumbnail'}
                            style={styles.modifyTileSetBannerThumbImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.modifyTileSetBannerThumbPlaceholder} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable
                onPress={dismissModifyBanner}
                style={styles.modifyTileSetBannerClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Dismiss tile set banner"
              >
                <MaterialCommunityIcons name="close" size={24} color="#fff" />
              </Pressable>
            </Animated.View>
            </>
          )}
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
          resolvePatternTile={resolvePatternTile}
          patternThumbnailNode={patternThumbnailNode}
          onSelect={(next) => {
            dismissModifyBanner();
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
              if (isSelectionMode && canvasSelection) {
                pendingPaletteFloodRef.current = true;
              }
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
            if (isSelectionMode && canvasSelection) {
              pendingPaletteFloodRef.current = true;
            }
          }}
          onRotate={(index) => {
            dismissModifyBanner();
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
            });
          }}
          onMirror={(index) => {
            dismissModifyBanner();
            const rotation = paletteRotations[index] ?? 0;
            const curX = paletteMirrors[index] ?? false;
            const curY = paletteMirrorsY[index] ?? false;
            const horizontalInR0 = rotation === 0 || rotation === 180 ? curX : curY;
            const verticalInR0 = rotation === 0 || rotation === 180 ? curY : curX;
            const newH = !horizontalInR0;
            const newMirrorX = rotation === 0 || rotation === 180 ? newH : verticalInR0;
            const newMirrorY = rotation === 0 || rotation === 180 ? verticalInR0 : newH;
            setPaletteMirrors((prev) => ({ ...prev, [index]: newMirrorX }));
            setPaletteMirrorsY((prev) => ({ ...prev, [index]: newMirrorY }));
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
                mirrorX: newMirrorX,
                mirrorY: newMirrorY,
              });
            }
          }}
          onMirrorVertical={(index) => {
            dismissModifyBanner();
            const rotation = paletteRotations[index] ?? 0;
            const curX = paletteMirrors[index] ?? false;
            const curY = paletteMirrorsY[index] ?? false;
            const horizontalInR0 = rotation === 0 || rotation === 180 ? curX : curY;
            const verticalInR0 = rotation === 0 || rotation === 180 ? curY : curX;
            const newV = !verticalInR0;
            const newMirrorX = rotation === 0 || rotation === 180 ? horizontalInR0 : newV;
            const newMirrorY = rotation === 0 || rotation === 180 ? newV : horizontalInR0;
            setPaletteMirrors((prev) => ({ ...prev, [index]: newMirrorX }));
            setPaletteMirrorsY((prev) => ({ ...prev, [index]: newMirrorY }));
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
                mirrorX: newMirrorX,
                mirrorY: newMirrorY,
              });
            }
          }}
          getRotation={(index) => paletteRotations[index] ?? 0}
          getMirror={(index) => paletteMirrors[index] ?? false}
          getMirrorVertical={(index) => paletteMirrorsY[index] ?? false}
          onPatternLongPress={() => {
            dismissModifyBanner();
            if (brush.mode !== 'pattern') {
              setBrush({ mode: 'pattern' });
            }
            setIsPatternCreationMode(false);
            setShowPatternChooser(true);
          }}
          onPatternDoubleTap={() => {
            dismissModifyBanner();
            if (brush.mode !== 'pattern') {
              setBrush({ mode: 'pattern' });
            }
            setIsPatternCreationMode(false);
            setShowPatternChooser(true);
          }}
          onRandomLongPress={() => {
            dismissModifyBanner();
            setShowTileSetChooser(true);
          }}
          onRandomDoubleTap={() => {
            dismissModifyBanner();
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
                    onPress={handleImportPatternPress}
                    style={styles.patternHeaderIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Import .tilepattern file"
                  >
                    <MaterialCommunityIcons name="upload" size={24} color="#fff" />
                  </Pressable>
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
                <View style={styles.patternSelectDeleteExportRow}>
                  <Pressable
                    onPress={() =>
                      selectedPatternIds.size > 0 && deleteSelectedPatterns()
                    }
                    style={[
                      styles.patternSelectDelete,
                      selectedPatternIds.size === 0 && styles.patternSelectDeleteDisabled,
                    ]}
                    disabled={selectedPatternIds.size === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Delete selected patterns"
                  >
                    <ThemedText
                      type="defaultSemiBold"
                      style={[
                        styles.patternSelectDeleteText,
                        selectedPatternIds.size === 0 &&
                          styles.patternSelectDeleteTextDisabled,
                      ]}
                    >
                      Delete
                    </ThemedText>
                  </Pressable>
                  <ThemedText type="defaultSemiBold" style={styles.patternSelectPipe}>
                    {' | '}
                  </ThemedText>
                  <Pressable
                    onPress={() =>
                      selectedPatternIds.size > 0 && setShowPatternExportMenu(true)
                    }
                    style={[
                      styles.patternSelectExport,
                      selectedPatternIds.size === 0 && styles.patternSelectExportDisabled,
                    ]}
                    disabled={selectedPatternIds.size === 0}
                    accessibilityRole="button"
                    accessibilityLabel="Export selected patterns"
                  >
                    <ThemedText
                      type="defaultSemiBold"
                      style={[
                        styles.patternSelectExportText,
                        selectedPatternIds.size === 0 &&
                          styles.patternSelectExportTextDisabled,
                      ]}
                    >
                      Export
                    </ThemedText>
                  </Pressable>
                </View>
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
                {activePatterns.length === 0 ? (
                  <View style={styles.patternModalEmpty}>
                    <ThemedText style={styles.patternModalEmptyText}>
                      No patterns yet
                    </ThemedText>
                  </View>
                ) : (
                <>
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
                      <PatternThumbnail
                        pattern={pattern}
                        rotationCW={rotationCW}
                        mirrorX={mirrorX}
                        tileSize={tileSize}
                        resolveTile={(t) =>
                          resolveTileAssetForFile(
                            t,
                            tileSources,
                            pattern.tileSetIds && pattern.tileSetIds.length > 0
                              ? pattern.tileSetIds
                              : activeFileTileSetIds
                          )
                        }
                        strokeColor={activeLineColor}
                        strokeWidth={activeLineWidth}
                        strokeScaleByName={strokeScaleByName}
                      />
                    </Pressable>
                  );
                })}
                </>
                )}
              </ScrollView>
            </ThemedView>
          </View>
        )}
        {showPatternExportMenu && (
          <ThemedView style={[styles.overlay, { zIndex: 40 }]} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowPatternExportMenu(false)}
              accessibilityRole="button"
              accessibilityLabel="Close export options"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="defaultSemiBold">Export .tilepattern?</ThemedText>
              <ThemedView style={styles.inlineOptions}>
                <Pressable
                  onPress={() => setShowPatternExportMenu(false)}
                  style={styles.overlayItem}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel export"
                >
                  <ThemedText type="defaultSemiBold">Cancel</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void exportSelectedPatternsAsTile()}
                  style={[styles.overlayItem, styles.overlayItemSelected]}
                  accessibilityRole="button"
                  accessibilityLabel="Export .tilepattern file"
                >
                  <ThemedText type="defaultSemiBold">Export</ThemedText>
                </Pressable>
              </ThemedView>
            </ThemedView>
          </ThemedView>
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
              <Pressable
                style={styles.settingsAction}
                onPress={() => {
                  setShowSettingsOverlay(false);
                  router.push('/manual');
                }}
                accessibilityRole="button"
                accessibilityLabel="View manual"
              >
                <ThemedText type="defaultSemiBold">View manual</ThemedText>
              </Pressable>
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
              <ThemedView style={styles.settingsPlatformFooter}>
                <ThemedText style={styles.settingsPlatformLabel}>{platformLabel}</ThemedText>
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
              <ScrollView
                style={styles.tileSetChooserScroll}
                contentContainerStyle={styles.tileSetChooserScrollContent}
                showsVerticalScrollIndicator
              >
                <ThemedView style={styles.tileSetChooserSection}>
                  <ThemedView style={styles.tileSetChooserGrid}>
                {TILE_CATEGORIES.map((category) => {
                  const isSelected = selectedCategories.includes(category);
                  const firstTile =
                    TILE_CATEGORY_THUMBNAILS[category] ?? TILE_MANIFEST[category][0];
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
                  const firstTile =
                    [...set.tiles].sort((a, b) =>
                      (a.name ?? '').localeCompare(b.name ?? '')
                    )[0] ?? null;
                  const thumbUri = firstTile?.thumbnailUri ?? firstTile?.previewUri ?? null;
                  const bakedSources = bakedSourcesBySetId[set.id] ?? [];
                  const firstBakedSource = bakedSources[0];
                  const thumbSource =
                    thumbUri
                      ? { uri: thumbUri }
                      : firstBakedSource?.source
                        ? firstBakedSource.source
                        : null;
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
                          styles.tileSetChooserThumbUgc,
                          !isSelected && styles.tileSetChooserThumbUnselected,
                          isSelected && styles.tileSetChooserThumbSelected,
                        ]}
                      >
                        {thumbSource ? (
                          <TileAsset
                            source={thumbSource}
                            name={firstBakedSource?.name ?? 'thumbnail'}
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
  selectionWithRegionToolsWrapper: {
    position: 'relative',
    flexDirection: 'column',
    alignItems: 'center',
  },
  regionToolsBarOuter: {
    position: 'absolute',
    top: TOOLBAR_BUTTON_SIZE + 4,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  regionToolsBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(180, 180, 180, 0.9)',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingVertical: 0,
    paddingHorizontal: 6,
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
  navBackSquare: {
    width: Math.round(TOOLBAR_BUTTON_SIZE * 0.75),
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
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
  settingsPlatformFooter: {
    paddingTop: 16,
    alignItems: 'center',
  },
  settingsPlatformLabel: {
    color: '#9ca3af',
    fontSize: 13,
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
  /** UGC tile set thumbnails only: dark blue background to match in-app tile styling. */
  tileSetChooserThumbUgc: {
    backgroundColor: '#0F1430',
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
  modifyTileSetBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#5a5a5a',
  },
  modifyTileSetBannerScroll: {
    flex: 1,
    maxHeight: 40,
  },
  modifyTileSetBannerClose: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modifyTileSetBannerScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modifyTileSetBannerThumbWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modifyTileSetBannerThumb: {
    width: 40,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  modifyTileSetBannerThumbUgc: {
    backgroundColor: '#0F1430',
  },
  modifyTileSetBannerThumbUnselected: {
    opacity: 0.5,
  },
  modifyTileSetBannerThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  modifyTileSetBannerThumbImage: {
    width: '100%',
    height: '100%',
  },
  modifyTileSetBannerThumbPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f0f0f',
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
  fileSelectDeleteExportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileSelectDelete: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  fileSelectDeleteText: {
    color: '#dc2626',
  },
  fileSelectDeleteDisabled: {
    opacity: 0.5,
  },
  fileSelectDeleteTextDisabled: {
    color: '#b91c1c',
  },
  fileSelectPipe: {
    color: '#9ca3af',
  },
  fileSelectExport: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  fileSelectExportText: {
    color: '#9ca3af',
  },
  fileSelectExportDisabled: {
    opacity: 0.5,
  },
  fileSelectExportTextDisabled: {
    color: '#6b7280',
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
  fileGridSectionDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#6b7280',
    marginTop: 8,
    marginBottom: 0,
  },
  fileGridSectionTitle: {
    width: '100%',
    fontSize: 12,
    marginBottom: 2,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reimportSamplesButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#9ca3af',
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    opacity: 0.25,
  },
  reimportSamplesButtonText: {
    color: '#4b5563',
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
    borderRadius: 0,
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
  patternSelectDeleteDisabled: {
    opacity: 0.5,
  },
  patternSelectDeleteTextDisabled: {
    color: '#b91c1c',
  },
  patternSelectDeleteExportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  patternSelectPipe: {
    color: '#9ca3af',
  },
  patternSelectExport: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectExportText: {
    color: '#9ca3af',
  },
  patternSelectExportDisabled: {
    opacity: 0.5,
  },
  patternSelectExportTextDisabled: {
    color: '#6b7280',
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
  patternModalEmpty: {
    height: PATTERN_THUMB_HEIGHT,
    minHeight: PATTERN_THUMB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternModalEmptyText: {
    color: '#9ca3af',
    fontSize: 16,
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
    width: 320,
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
  undoRedoBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: UNDO_REDO_BANNER_HEIGHT,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  undoRedoBannerText: {
    color: '#fff',
    fontSize: 11,
  },
  zoomedBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  zoomedBannerBackLink: {
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  zoomedBannerBackLinkText: {
    color: '#fff',
    fontSize: 11,
    textDecorationLine: 'underline',
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
  canvasSelectionBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#22c55e',
    zIndex: 3,
  },
  lockedBoundaryEdge: {
    position: 'absolute',
    backgroundColor: '#dc2626',
    zIndex: 15,
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
