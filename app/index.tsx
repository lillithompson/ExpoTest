import { MaterialCommunityIcons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { memo, startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Image,
    Modal,
    PixelRatio,
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
import { clearBrushFavorites } from '@/components/tile-brush-panel';
import { LayerSidePanel } from '@/components/layer-side-panel';
import { ModifyPalette } from '@/components/modify-palette';
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
import { paletteProfileLogParent } from '@/utils/palette-profile';
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
    renderTileCanvasToSvg
} from '@/utils/tile-export';
import { deserializeTileFile, serializeTileFile } from '@/utils/tile-format';
import {
    buildInitialTiles,
    computeFixedGridLayout,
    computeGridLayout,
    getEmphasizeStrokeColor,
    getGridLevelLinePositions,
    getLevelCellIndexForPoint,
    getLevelGridInfo,
    getMaxGridResolutionLevel,
    hydrateTilesWithSourceNames,
    normalizeTiles,
    type LevelGridInfo,
    type Tile,
} from '@/utils/tile-grid';
import { displayToPatternCell, getRotatedDimensions } from '@/utils/pattern-transform';
import { applyGroupRotationToTile, normalizeRotationCW } from '@/utils/tile-group-rotate';
import type { CrossLayerContext } from '@/utils/cross-layer-compat';
import { deserializePattern, deserializeTileSet, serializePattern } from '@/utils/tile-ugc-format';
import JSZip from 'jszip';

const GRID_GAP = 0;
/** Max internal grid level (3 = 4×4 cells per tile). Display: L1 = coarsest, Lmax = finest. */
const MAX_EDITABLE_GRID_LEVEL = 3;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const UNDO_REDO_BANNER_HEIGHT = HEADER_HEIGHT / 2;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const PATTERN_THUMB_HEIGHT = 70;
const PATTERN_THUMB_PADDING = 4;
/** All 8 pattern orientation variants: 4 rotations × 2 (no mirror / mirror X). */
const PATTERN_ORIENTATION_VARIANTS: Array<{
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
const BRUSH_PANEL_ROW_GAP = 2;
/** Reserve space for horizontal scrollbar on desktop web so the bottom row is not cut off. */
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
/** New files use max resolution: tile size 25 (Large on mobile, 25px on web). */
const NEW_FILE_TILE_SIZE = 25;
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
  gridGap?: number;
  /** 1 = tile grid; 2+ = subdivided halves (centered). Clamped to valid range by caller. */
  gridResolutionLevel?: number;
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
  gridGap = 0,
  gridResolutionLevel = 1,
}: GridBackgroundProps) {
  if (rows <= 0 || columns <= 0 || tileSize <= 0) {
    return null;
  }
  const strokeWidth = Math.max(0, lineWidth);
  const { verticalPx, horizontalPx } = getGridLevelLinePositions(
    columns,
    rows,
    gridResolutionLevel,
    tileSize,
    gridGap
  );
  return (
    <View
      pointerEvents="none"
      style={[
        styles.gridBackground,
        { width, height, backgroundColor },
      ]}
    >
      {strokeWidth > 0 &&
        verticalPx.map((left, i) => (
          <View
            key={`grid-v-${i}`}
            style={[
              styles.gridLineVertical,
              {
                left: left - strokeWidth / 2,
                width: strokeWidth,
                height,
                backgroundColor: lineColor,
              },
            ]}
          />
        ))}
      {strokeWidth > 0 &&
        horizontalPx.map((top, i) => (
          <View
            key={`grid-h-${i}`}
            style={[
              styles.gridLineHorizontal,
              {
                top: top - strokeWidth / 2,
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
        displaySize={tileSize}
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

/**
 * Computes the coordinate offset from level-N (coarser) cells to level-M (finer) cells.
 * Level-N cell (j, i) maps to level-M cells at rows [j*scale+C_row .. j*scale+C_row+scale-1]
 * and cols [i*scale+C_col .. i*scale+C_col+scale-1].
 */
function getLevelNtoMOffsets(
  columns: number,
  rows: number,
  levelN: number,
  levelM: number
): { scale: number; C_row: number; C_col: number } | null {
  if (levelN <= levelM || levelN < 2 || levelM < 1) return null;
  const cellTilesN = Math.pow(2, levelN - 1);
  const cellTilesM = Math.pow(2, levelM - 1);
  const scale = Math.round(cellTilesN / cellTilesM);
  const centerCol = Math.floor(columns / 2);
  const centerRow = Math.floor(rows / 2);
  const kMinV_N = Math.ceil(-centerCol / cellTilesN);
  const kMinV_M = Math.ceil(-centerCol / cellTilesM);
  const kMinH_N = Math.ceil(-centerRow / cellTilesN);
  const kMinH_M = Math.ceil(-centerRow / cellTilesM);
  return {
    scale,
    C_row: kMinH_N * scale - kMinH_M,
    C_col: kMinV_N * scale - kMinV_M,
  };
}

/**
 * Compute a pattern tile at (row, col) using explicit pattern data.
 * Mirrors the hook's getPatternTileForPosition; row/col can be absolute (flood fill)
 * or anchor-relative (single-cell painting).
 */
function computePatternTileFromData(
  row: number,
  col: number,
  patternTiles: Tile[],
  patternWidth: number,
  patternHeight: number,
  rotationDeg: number,
  mirrorX: boolean
): { imageIndex: number; rotation: number; mirrorX: boolean; mirrorY: boolean; name?: string } | null {
  if (patternTiles.length === 0 || patternWidth <= 0 || patternHeight <= 0) return null;
  const rotationCW = ((rotationDeg % 360) + 360) % 360;
  const { rotW, rotH } = getRotatedDimensions(rotationCW, patternWidth, patternHeight);
  const localRow = ((row % rotH) + rotH) % rotH;
  const localCol = ((col % rotW) + rotW) % rotW;
  const mapped = displayToPatternCell(localRow, localCol, patternWidth, patternHeight, rotationCW, mirrorX);
  if (!mapped) return null;
  const { sourceRow, sourceCol } = mapped;
  const patternTile = patternTiles[sourceRow * patternWidth + sourceCol];
  if (!patternTile) return null;
  const rot = normalizeRotationCW(rotationCW);
  const transformed = applyGroupRotationToTile(patternTile.rotation, patternTile.mirrorX, patternTile.mirrorY, rot);
  return {
    imageIndex: patternTile.imageIndex,
    rotation: transformed.rotation,
    mirrorX: transformed.mirrorX,
    mirrorY: transformed.mirrorY,
    ...(patternTile.name !== undefined && { name: patternTile.name }),
  };
}

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
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [canvasAreaWidth, setCanvasAreaWidth] = useState(0);
  const [canvasAreaHeight, setCanvasAreaHeight] = useState(0);
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
  const [isMoveMode, setIsMoveMode] = useState(false);
  const [moveDragOffset, setMoveDragOffset] = useState<{ dRow: number; dCol: number } | null>(null);
  const [showMoveConfirmDialog, setShowMoveConfirmDialog] = useState(false);
  const [showZoomOutMirrorConfirm, setShowZoomOutMirrorConfirm] = useState(false);
  const [pendingMoveOffset, setPendingMoveOffset] = useState<{ dRow: number; dCol: number } | null>(null);
  const moveDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [patternAnchorIndex, setPatternAnchorIndex] = useState<number | null>(null);
  const [stampDragPatternId, setStampDragPatternId] = useState<string | null>(null);
  const [stampDropCell, setStampDropCell] = useState<{ row: number; col: number } | null>(null);
  const [showStampConfirmDialog, setShowStampConfirmDialog] = useState(false);
  const [pendingStampCell, setPendingStampCell] = useState<{ row: number; col: number } | null>(null);
  const stampDragTransformRef = useRef<{ rotation: number; mirrorX: boolean }>({ rotation: 0, mirrorX: false });
  const stampDragPatternIdRef = useRef<string | null>(null);
  const isStampDraggingRef = useRef(false);
  const [pendingStampPatternId, setPendingStampPatternId] = useState<string | null>(null);
  // Absolute screen position of the canvas, captured at drag start for coordinate conversion.
  const canvasScreenOffsetRef = useRef({ x: 0, y: 0 });
  // File grid (L1) dimensions cached at drag start, used to scale pattern level dimensions.
  const stampGridDimsRef = useRef({ cols: 0, rows: 0 });
  /** Accumulated finer-layer cell updates during pattern painting. Flushed on debounce timer. */
  const finerLayerPendingRef = useRef<Record<number, Record<number, Tile>>>({});
  const finerLayerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPatternSaveModal, setShowPatternSaveModal] = useState(false);
  const [showPatternExportMenu, setShowPatternExportMenu] = useState(false);
  const [selectedPatternIdsForExport, setSelectedPatternIdsForExport] = useState<string[]>([]);
  const [patternRotations, setPatternRotations] = useState<Record<string, number>>(
    {}
  );
  const [patternMirrors, setPatternMirrors] = useState<Record<string, boolean>>({});
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

  const availableWidth = contentWidth - CONTENT_PADDING * 2;
  /** Tile palette (File Modify): fixed 2 rows, 75px per tile. Reserve this height so canvas can center above. */
  const PALETTE_FIXED_TILE_SIZE = 75;
  const PALETTE_FIXED_ROWS = 2;
  const fixedPaletteHeight =
    PALETTE_FIXED_ROWS * PALETTE_FIXED_TILE_SIZE +
    BRUSH_PANEL_ROW_GAP * (PALETTE_FIXED_ROWS - 1);
  const isDesktopWeb =
    Platform.OS === 'web' && width >= FILE_VIEW_DESKTOP_BREAKPOINT;
  const paletteReservedHeight =
    fixedPaletteHeight +
    (isDesktopWeb ? WEB_SCROLLBAR_HEIGHT : 0);
  const reservedBrushHeight =
    viewMode === 'modify'
      ? Math.min(
          paletteReservedHeight,
          Math.max(
            0,
            contentHeight -
              HEADER_HEIGHT -
              CONTENT_PADDING * 2 -
              TITLE_SPACING
          )
        )
      : BRUSH_PANEL_HEIGHT;
  const availableHeight = Math.max(
    contentHeight -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      reservedBrushHeight,
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
    updateActiveFileLockedCellsForLayer,
    updateActiveFileLayerCells,
    updateActiveFileLayer,
    updateActiveFileTilesL1,
    updateActiveFileLayerVisibility,
    updateActiveFileLayerLocked,
    updateActiveFileLayerEmphasized,
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
  const paletteSources = useMemo(() => {
    const t0 = performance.now();
    const result = getSourcesForSelection(activeCategories, selectedTileSetIds);
    paletteProfileLogParent('paletteSources', performance.now() - t0, `sources=${result.length}`);
    return result;
  }, [activeCategories, selectedTileSetIds, getSourcesForSelection]);
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
  const patternListForPalette = useMemo(
    () =>
      activePatterns.map((p) => ({
        id: p.id,
        pattern: { tiles: p.tiles, width: p.width, height: p.height },
        rotation: patternRotations[p.id] ?? 0,
        mirrorX: patternMirrors[p.id] ?? false,
        tileSetIds: p.tileSetIds,
      })),
    [activePatterns, patternRotations, patternMirrors]
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

  /** Max resolution level from file grid (level-1 dimensions only). Does not change when switching editing level. */
  const maxResolutionLevelFromFile = useMemo(
    () =>
      getMaxGridResolutionLevel(
        activeFile?.grid?.columns ?? 0,
        activeFile?.grid?.rows ?? 0
      ),
    [activeFile?.grid?.columns, activeFile?.grid?.rows]
  );

  /** Same cap used by the modal (1..maxLevel). Ensures display level and options stay in sync. */
  const maxDisplayLevel = Math.min(maxResolutionLevelFromFile, MAX_EDITABLE_GRID_LEVEL);

  // Auto-select the coarsest editing level required by the selected pattern.
  // Depends on maxResolutionLevelFromFile so it re-evaluates once a file is loaded
  // (getMaxGridResolutionLevel(0,0) = 0 before any file is open, which would corrupt the level).
  useEffect(() => {
    if (!selectedPattern?.createdAtLevel || !maxResolutionLevelFromFile) return;
    // Includes layerTiles keys: all levels are captured on save, so keys can be both finer AND
    // coarser than createdAtLevel. Use the coarsest level to ensure the full pattern is applied.
    const allPatternLevels = [
      selectedPattern.createdAtLevel,
      ...Object.keys(selectedPattern.layerTiles ?? {}).map(Number).filter((n) => !isNaN(n)),
    ];
    const coarsestLevel = Math.max(...allPatternLevels);
    const targetLevel = Math.min(
      Math.max(1, coarsestLevel),
      maxResolutionLevelFromFile,
      MAX_EDITABLE_GRID_LEVEL
    );
    setSettings((prev) => {
      if ((prev.gridResolutionLevel ?? 1) === targetLevel) return prev;
      return { ...prev, gridResolutionLevel: targetLevel };
    });
  }, [selectedPattern?.id, maxResolutionLevelFromFile]);

  /** Internal editing level (1 = tile grid, 2 = 2×2, 3 = 4×4). No change to grid/layout. */
  const editingLevel = useMemo(() => {
    return Math.min(
      Math.max(1, settings.gridResolutionLevel ?? 1),
      maxResolutionLevelFromFile,
      MAX_EDITABLE_GRID_LEVEL
    );
  }, [maxResolutionLevelFromFile, settings.gridResolutionLevel]);

  /**
   * Tracks which editing level the grid hook's `tiles` is actually populated for.
   * Updated in the same effect batch as loadTiles so display never reads hook tiles
   * for the wrong level during the one-render gap before the effect fires.
   */
  const [hookLoadedLevel, setHookLoadedLevel] = useState(() =>
    Math.min(
      Math.max(1, settings.gridResolutionLevel ?? 1),
      MAX_EDITABLE_GRID_LEVEL
    )
  );

  /** Display only: L1 = coarsest, Lmax = finest. Uses same max as modal so selection highlight matches. */
  const displayResolutionLevel = useMemo(
    () => maxDisplayLevel - editingLevel + 1,
    [maxDisplayLevel, editingLevel]
  );

  /**
   * Pattern data to pass to useTileGrid, selected for the current editing level.
   * For patterns with createdAtLevel: use layerTiles[editingLevel] if editing a finer level,
   * use tiles if same level, null if no data for current level.
   * For legacy patterns (no createdAtLevel): always use tiles (backward compat).
   */
  const effectivePatternForHook = useMemo(() => {
    if (!selectedPattern) return null;
    const createdAtLevel = selectedPattern.createdAtLevel;
    let tileData: { tiles: Tile[]; width: number; height: number } | null = null;
    if (createdAtLevel == null) {
      tileData = { tiles: selectedPattern.tiles, width: selectedPattern.width, height: selectedPattern.height };
    } else if (editingLevel === createdAtLevel) {
      tileData = { tiles: selectedPattern.tiles, width: selectedPattern.width, height: selectedPattern.height };
    } else {
      // Any other level: look up layerTiles (works for both finer and coarser levels)
      tileData = selectedPattern.layerTiles?.[editingLevel] ?? null;
    }
    if (!tileData) return null;
    return {
      tiles: tileData.tiles,
      width: tileData.width,
      height: tileData.height,
      rotation: patternRotations[selectedPattern.id] ?? 0,
      mirrorX: patternMirrors[selectedPattern.id] ?? false,
    };
  }, [selectedPattern, editingLevel, patternRotations, patternMirrors]);

  /** Flush accumulated finer-layer pattern cell updates to file state. */
  const flushFinerLayerPending = useCallback(() => {
    const pending = finerLayerPendingRef.current;
    if (Object.keys(pending).length === 0) return;
    finerLayerPendingRef.current = {};
    for (const [levelStr, cellUpdates] of Object.entries(pending)) {
      updateActiveFileLayerCells(parseInt(levelStr, 10), cellUpdates);
    }
  }, [updateActiveFileLayerCells]);

  /** Schedule a debounced flush of finer-layer pending updates (150 ms). */
  const scheduleFinerLayerFlush = useCallback(() => {
    if (finerLayerFlushTimerRef.current) {
      clearTimeout(finerLayerFlushTimerRef.current);
    }
    finerLayerFlushTimerRef.current = setTimeout(() => {
      finerLayerFlushTimerRef.current = null;
      flushFinerLayerPending();
    }, 150);
  }, [flushFinerLayerPending]);

  /** Layer is visible (default true). Hidden layers are excluded from canvas, exports, and thumbnails. */
  const isLayerVisible = useCallback(
    (file: { layerVisibility?: Record<number, boolean> } | null, level: number) =>
      file?.layerVisibility?.[level] !== false,
    []
  );
  /** Layer is locked (default false). Locked layers cannot be edited. */
  const isLayerLocked = useCallback(
    (file: { layerLocked?: Record<number, boolean> } | null, level: number) =>
      file?.layerLocked?.[level] === true,
    []
  );
  /** Layer is emphasized (default false). Emphasized layers show tiles with a blue tint. */
  const isLayerEmphasized = useCallback(
    (file: { layerEmphasized?: Record<number, boolean> } | null, level: number) =>
      file?.layerEmphasized?.[level] === true,
    []
  );

  /** Current layer can be edited (visible and not locked). When false, brush and tools do nothing on this layer. */
  const canEditCurrentLayer = Boolean(
    activeFile &&
      isLayerVisible(activeFile, editingLevel) &&
      !isLayerLocked(activeFile, editingLevel)
  );

  const isEditingInvisibleLayer = Boolean(
    activeFile && viewMode === 'modify' && !isLayerVisible(activeFile, editingLevel)
  );

  /** Level-1 layout (for persist when editing a higher layer). When file has 0,0 grid (new file),
   * compute from preferredTileSize so we never persist the current layer's dimensions as level-1. */
  const level1LayoutForPersist = useMemo(() => {
    const rows = activeFile?.grid.rows ?? 0;
    const cols = activeFile?.grid.columns ?? 0;
    if (rows > 0 && cols > 0) {
      return computeFixedGridLayout(availableWidth, availableHeight, GRID_GAP, rows, cols);
    }
    const preferred = activeFile?.preferredTileSize ?? 25;
    if (availableWidth <= 0 && availableHeight <= 0) return null;
    return computeGridLayout(availableWidth, availableHeight, GRID_GAP, preferred);
  }, [activeFile?.grid?.rows, activeFile?.grid?.columns, activeFile?.preferredTileSize, availableWidth, availableHeight]);

  /** When editing level 2+, the grid of complete cells at that level (for hook params and loadTiles). */
  const levelGridInfo = useMemo(() => {
    if (editingLevel < 2) return null;
    const cols = activeFile?.grid.columns ?? 0;
    const rows = activeFile?.grid.rows ?? 0;
    if (cols <= 0 || rows <= 0) return null;
    return getLevelGridInfo(cols, rows, editingLevel);
  }, [editingLevel, activeFile?.grid?.columns, activeFile?.grid?.rows]);

  const isEditingHigherLayer = editingLevel >= 2 && levelGridInfo != null && level1LayoutForPersist != null;

  /** Locked cells for the active editing layer, in that layer's coordinate space. */
  const activeLayerLockedCells = useMemo(() => {
    if (!activeFile) return null;
    if (isEditingHigherLayer) {
      const cells = activeFile.lockedCellsPerLayer?.[editingLevel];
      return cells && cells.length > 0 ? cells : null;
    }
    const cells = activeFile.lockedCells;
    return cells && cells.length > 0 ? cells : null;
  }, [activeFile, isEditingHigherLayer, editingLevel]);

  /** Level-2 grid info for drawing the level-2 overlay (all layers composited). */
  const level2GridInfo = useMemo(
    () =>
      getLevelGridInfo(
        activeFile?.grid.columns ?? 0,
        activeFile?.grid.rows ?? 0,
        2
      ),
    [activeFile?.grid?.columns, activeFile?.grid?.rows]
  );

  /** Level-3 grid info for drawing the level-3 overlay (when grid supports it). */
  const level3GridInfo = useMemo(
    () =>
      getLevelGridInfo(
        activeFile?.grid.columns ?? 0,
        activeFile?.grid.rows ?? 0,
        3
      ),
    [activeFile?.grid?.columns, activeFile?.grid?.rows]
  );

  /** When editing level 2+, fixedTileSize so the level grid fills the full canvas (same total size as level-1). */
  const layerFixedTileSize = useMemo(() => {
    if (!isEditingHigherLayer || !level1LayoutForPersist || !levelGridInfo)
      return undefined;
    const tw =
      level1LayoutForPersist.columns * level1LayoutForPersist.tileSize +
      GRID_GAP * (level1LayoutForPersist.columns - 1);
    const th =
      level1LayoutForPersist.rows * level1LayoutForPersist.tileSize +
      GRID_GAP * (level1LayoutForPersist.rows - 1);
    const w =
      (tw - (levelGridInfo.levelCols - 1) * GRID_GAP) / levelGridInfo.levelCols;
    const h =
      (th - (levelGridInfo.levelRows - 1) * GRID_GAP) / levelGridInfo.levelRows;
    return Math.min(w, h);
  }, [isEditingHigherLayer, level1LayoutForPersist, levelGridInfo]);

  /** True while a paint drag is in progress so the whole stroke is one undo step. */
  const isPartOfDragRef = useRef(false);

  /** Deferred so the grid and zoomed tile slice update together, avoiding one frame of junk tiles. */
  const zoomRegionForGrid = useDeferredValue(zoomRegion);

  /**
   * canvasSelection.start/end are always level-1 (finest grid) indices.
   * useTileGrid interprets them using its own gridLayout.columns (= levelCols for higher layers),
   * so translate to layer-N cell indices before passing the selection in.
   */
  const hookCanvasSelection = useMemo(() => {
    if (!canvasSelection || !isEditingHigherLayer || !levelGridInfo) return canvasSelection;
    const fullCols = activeFile?.grid.columns ?? 0;
    if (fullCols <= 0) return null;
    const startRow = Math.floor(canvasSelection.start / fullCols);
    const startCol = canvasSelection.start % fullCols;
    const endRow = Math.floor(canvasSelection.end / fullCols);
    const endCol = canvasSelection.end % fullCols;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const { levelCols } = levelGridInfo;
    let layerMinRow = Infinity;
    let layerMaxRow = -Infinity;
    let layerMinCol = Infinity;
    let layerMaxCol = -Infinity;
    levelGridInfo.cells.forEach((cell, idx) => {
      if (
        cell.minRow >= minRow && cell.maxRow <= maxRow &&
        cell.minCol >= minCol && cell.maxCol <= maxCol
      ) {
        const layerRow = Math.floor(idx / levelCols);
        const layerCol = idx % levelCols;
        if (layerRow < layerMinRow) layerMinRow = layerRow;
        if (layerRow > layerMaxRow) layerMaxRow = layerRow;
        if (layerCol < layerMinCol) layerMinCol = layerCol;
        if (layerCol > layerMaxCol) layerMaxCol = layerCol;
      }
    });
    if (layerMinRow === Infinity) return null;
    return { start: layerMinRow * levelCols + layerMinCol, end: layerMaxRow * levelCols + layerMaxCol };
  }, [canvasSelection, isEditingHigherLayer, levelGridInfo, activeFile?.grid.columns]);

  /** Cross-layer context: tiles from other layers for connectivity checking. */
  const crossLayerContext: CrossLayerContext | null = useMemo(() => {
    if (!settings.crossLayerConnectivity) return null;
    if (!activeFile) return null;
    const baseCols = activeFile.grid.columns ?? 0;
    const baseRows = activeFile.grid.rows ?? 0;
    if (baseCols <= 0 || baseRows <= 0) return null;

    const otherLayers: CrossLayerContext['otherLayers'] = {};

    // Include level 1 if we're not editing it and it's visible
    if (editingLevel !== 1 && activeFile.layerVisibility?.[1] !== false) {
      const l1Tiles = activeFile.tiles;
      if (l1Tiles && l1Tiles.length > 0) {
        const l1GridInfo = getLevelGridInfo(baseCols, baseRows, 1);
        if (l1GridInfo) {
          otherLayers[1] = { tiles: l1Tiles, gridInfo: l1GridInfo };
        }
      }
    }

    // Include other populated layers (2+) that are visible
    if (activeFile.layers) {
      for (const levelStr of Object.keys(activeFile.layers)) {
        const level = Number(levelStr);
        if (level === editingLevel || level < 2) continue;
        if (activeFile.layerVisibility?.[level] === false) continue;
        const layerTiles = activeFile.layers[level];
        if (!layerTiles || layerTiles.length === 0) continue;
        // Check if any tile is initialized
        const hasAny = layerTiles.some((t: Tile) => t && t.imageIndex >= 0);
        if (!hasAny) continue;
        const layerGridInfo = getLevelGridInfo(baseCols, baseRows, level);
        if (layerGridInfo) {
          otherLayers[level] = { tiles: layerTiles, gridInfo: layerGridInfo };
        }
      }
    }

    if (Object.keys(otherLayers).length === 0) return null;

    return {
      editingLevel,
      baseColumns: baseCols,
      baseRows: baseRows,
      otherLayers,
    };
  }, [activeFile, editingLevel, settings.crossLayerConnectivity]);

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
    moveRegion,
    rotateRegion,
    placeStamp,
    fullTilesForSave,
    fullGridLayoutForSave,
    mirrorZoomRegionToRestOfGrid,
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    preferredTileSize: fileTileSize,
    allowEdgeConnections: settings.allowEdgeConnections,
    suspendRemap: true,
    randomSourceIndices,
    fixedRows: isEditingHigherLayer ? levelGridInfo!.levelRows : (activeFile?.grid.rows ?? 0),
    fixedColumns: isEditingHigherLayer ? levelGridInfo!.levelCols : (activeFile?.grid.columns ?? 0),
    fixedTileSize: layerFixedTileSize,
    onTilesChange:
      editingLevel >= 2
        ? (t: Tile[]) => updateActiveFileLayer(editingLevel, t)
        : undefined,
    brush,
    mirrorHorizontal: settings.mirrorHorizontal,
    mirrorVertical: settings.mirrorVertical,
    pattern: effectivePatternForHook ?? null,
    patternAnchorKey: selectedPattern?.id ?? null,
    getFixedBrushSourceName: () => fixedBrushSourceNameRef.current,
    canvasSelection: viewMode === 'modify' ? hookCanvasSelection : null,
    lockedCells: viewMode === 'modify' ? activeLayerLockedCells : null,
    isPartOfDragRef: viewMode === 'modify' ? isPartOfDragRef : undefined,
    zoomRegion:
      viewMode === 'modify' && !isEditingHigherLayer ? zoomRegionForGrid : null,
    fullGridColumns: viewMode === 'modify' && zoomRegion ? (activeFile?.grid.columns ?? undefined) : undefined,
    fullGridRows: viewMode === 'modify' && zoomRegion ? (activeFile?.grid.rows ?? undefined) : undefined,
    crossLayerContext,
  });
  /** When switching resolution layer or file, load that layer's tiles into the grid hook. */
  const lastLayerLoadRef = useRef({ editingLevel: 0, fileId: '' });
  // Reset the guard on each new load so returning to the same file/layer always re-runs the load.
  useEffect(() => {
    lastLayerLoadRef.current = { editingLevel: 0, fileId: '' };
  }, [loadToken]);
  useEffect(() => {
    if (!activeFile || viewMode !== 'modify') return;
    const key = { editingLevel, fileId: activeFile.id };
    if (
      lastLayerLoadRef.current.editingLevel === key.editingLevel &&
      lastLayerLoadRef.current.fileId === key.fileId
    )
      return;
    lastLayerLoadRef.current = key;
    if (editingLevel >= 2 && levelGridInfo) {
      loadTiles(
        normalizeTiles(
          activeFile.layers?.[editingLevel],
          levelGridInfo.cells.length,
          tileSources.length
        )
      );
    } else {
      const cols = activeFile.grid?.columns ?? 0;
      const rows = activeFile.grid?.rows ?? 0;
      const n = cols * rows;
      if (n > 0)
        loadTiles(normalizeTiles(activeFile.tiles, n, tileSources.length));
    }
    setHookLoadedLevel(editingLevel);
  }, [
    editingLevel,
    activeFile?.id,
    levelGridInfo,
    activeFile,
    viewMode,
    loadTiles,
    tileSources.length,
  ]);

  /** Clear canvas selection and deactivate region tool when switching layers. */
  useEffect(() => {
    setCanvasSelection(null);
    setIsSelectionMode(false);
    setIsMoveMode(false);
    setMoveDragOffset(null);
  }, [editingLevel]);

  const fullGridColumnsForMapping =
    zoomRegion && fullGridColumnsForZoom != null
      ? fullGridColumnsForZoom
      : (activeFile?.grid.columns ?? 0);
  const getFullIndexForCanvas = useCallback(
    (visibleIndex: number) => {
      if (zoomRegion && fullGridColumnsForMapping > 0) {
        const { minRow, minCol, maxCol } = zoomRegion;
        const zoomCols = maxCol - minCol + 1;
        const visibleRow = Math.floor(visibleIndex / zoomCols);
        const visibleCol = visibleIndex % zoomCols;
        return (minRow + visibleRow) * fullGridColumnsForMapping + (minCol + visibleCol);
      }
      if (isEditingHigherLayer && levelGridInfo && fullGridColumnsForMapping > 0) {
        const cell = levelGridInfo.cells[visibleIndex];
        if (!cell) return visibleIndex;
        return cell.minRow * fullGridColumnsForMapping + cell.minCol;
      }
      return visibleIndex;
    },
    [zoomRegion, fullGridColumnsForMapping, isEditingHigherLayer, levelGridInfo]
  );

  /** Level-1 index range for the given canvas cell (so selection outline and bounds use level-1 at all layers). */
  const getLevel1BoundsForCanvasCell = useCallback(
    (cellIndex: number): { minIdx: number; maxIdx: number } => {
      const fullCols = fullGridColumnsForMapping;
      if (fullCols <= 0) return { minIdx: cellIndex, maxIdx: cellIndex };
      if (isEditingHigherLayer && levelGridInfo) {
        const cell = levelGridInfo.cells[cellIndex];
        if (!cell) return { minIdx: cellIndex, maxIdx: cellIndex };
        const minIdx = cell.minRow * fullCols + cell.minCol;
        const maxIdx = cell.maxRow * fullCols + cell.maxCol;
        return { minIdx, maxIdx };
      }
      const idx = zoomRegion ? getFullIndexForCanvas(cellIndex) : cellIndex;
      return { minIdx: idx, maxIdx: idx };
    },
    [fullGridColumnsForMapping, isEditingHigherLayer, levelGridInfo, zoomRegion, getFullIndexForCanvas]
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
      if (canEditCurrentLayer) {
        floodFill();
        applyPatternFloodToFinerLayers(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brush, floodFill, canEditCurrentLayer]);
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
    }
  }, [tileSourcesKey, clearCloneSource, brush, tileSources]);
  /** Tiles for the currently edited layer (hook). */
  const displayTiles = tiles;

  /** Canvas size: always level-1 grid size when we have a file so switching resolution doesn't change what's displayed. */
  const displayGridWidth =
    level1LayoutForPersist != null
      ? level1LayoutForPersist.columns * level1LayoutForPersist.tileSize +
        GRID_GAP * Math.max(0, level1LayoutForPersist.columns - 1)
      : gridLayout.columns * gridLayout.tileSize +
          GRID_GAP * Math.max(0, gridLayout.columns - 1);
  const displayGridHeight =
    level1LayoutForPersist != null
      ? level1LayoutForPersist.rows * level1LayoutForPersist.tileSize +
        GRID_GAP * Math.max(0, level1LayoutForPersist.rows - 1)
      : gridLayout.rows * gridLayout.tileSize +
          GRID_GAP * Math.max(0, gridLayout.rows - 1);

  /** Level-1 layout for drawing (stable so layer composite doesn't jump). When we have a file with grid, always use level-1 dimensions so level-1 is visible when editing L2. */
  const level1DisplayLayout = useMemo(() => {
    if (level1LayoutForPersist != null) return level1LayoutForPersist;
    const rows = activeFile?.grid?.rows ?? 0;
    const cols = activeFile?.grid?.columns ?? 0;
    if (rows > 0 && cols > 0 && !zoomRegion) {
      return computeFixedGridLayout(availableWidth, availableHeight, GRID_GAP, rows, cols);
    }
    return gridLayout;
  }, [level1LayoutForPersist, activeFile?.grid?.rows, activeFile?.grid?.columns, zoomRegion, availableWidth, availableHeight, gridLayout]);

  /**
   * Level-1 tiles to show. Uses hook's live `tiles` only when the hook is confirmed loaded
   * for L1 (hookLoadedLevel === 1), preventing stale hook data from flashing on layer switch.
   * Hidden layer 1 shows as empty.
   */
  const level1TilesForDisplay = useMemo(() => {
    const total = level1DisplayLayout.rows * level1DisplayLayout.columns;
    if (total <= 0) return [];
    if (activeFile && activeFile.layerVisibility?.[1] === false) {
      return Array.from({ length: total }, () => ({
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      }));
    }
    if (editingLevel === 1 && hookLoadedLevel === 1) return tiles;
    const fromList = files.find((f) => f.id === activeFileId)?.tiles;
    const fromActive = activeFile?.tiles ?? [];
    return (fromList?.length ?? 0) >= total ? (fromList ?? []) : fromActive;
  }, [
    editingLevel,
    hookLoadedLevel,
    tiles,
    files,
    activeFileId,
    activeFile?.tiles,
    activeFile?.layerVisibility,
    level1DisplayLayout.rows,
    level1DisplayLayout.columns,
  ]);
  /** Level-2 tiles to show. Uses hook's live tiles only once the hook is loaded for L2. */
  const level2TilesForDisplay =
    editingLevel === 2 && hookLoadedLevel === 2 ? tiles : (activeFile?.layers?.[2] ?? []);
  /** Level-3 tiles to show. Uses hook's live tiles only once the hook is loaded for L3. */
  const level3TilesForDisplay =
    editingLevel === 3 && hookLoadedLevel === 3 ? tiles : (activeFile?.layers?.[3] ?? []);

  /** Full grid level-1 tiles used only for building the zoom slice (stable so switching layers doesn't change the zoomed view). Uses file data so L2/L3 view is correct; when editing L1 the hook's slice is used for display. */
  const fullGridLevel1TilesForZoom = useMemo(() => {
    const fullCols = activeFile?.grid?.columns ?? 0;
    const fullRows = activeFile?.grid?.rows ?? 0;
    const n = fullCols * fullRows;
    if (n <= 0) return [];
    if (activeFile?.layerVisibility?.[1] === false) {
      return Array.from({ length: n }, () => ({
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      }));
    }
    const source = activeFile?.tiles ?? [];
    if (source.length >= n) return source;
    const out = source.slice();
    while (out.length < n) {
      out.push({ imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false });
    }
    return out;
  }, [
    activeFile?.grid?.columns,
    activeFile?.grid?.rows,
    activeFile?.tiles,
    activeFile?.layerVisibility?.[1],
  ]);

  /** When zoomed, slice of full grid L1 for the zoom region. Built from file so the view does not change when switching layers (only grid lines change). */
  const zoomedLevel1TilesSlice = useMemo(() => {
    if (!zoomRegion) return null;
    const fullCols = activeFile?.grid?.columns ?? 0;
    if (fullCols <= 0) return null;
    const { minRow, maxRow, minCol, maxCol } = zoomRegion;
    const out: Tile[] = [];
    for (let r = minRow; r <= maxRow; r += 1) {
      for (let c = minCol; c <= maxCol; c += 1) {
        const idx = r * fullCols + c;
        const t = fullGridLevel1TilesForZoom[idx];
        out.push(t ?? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false });
      }
    }
    return out;
  }, [zoomRegion, activeFile?.grid?.columns, fullGridLevel1TilesForZoom]);

  /** For thumbnail/preview/save image: always use level-1 so we never overwrite level-1 with level-2 data.
   * When editing a higher layer, the hook's tiles are that layer's tiles; we must persist level-1 from the file only. */
  const tilesForSaveImage =
    editingLevel === 1
      ? fullTilesForSave
      : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []);
  const gridLayoutForSaveImage =
    editingLevel === 1
      ? fullGridLayoutForSave
      : (level1LayoutForPersist ?? fullGridLayoutForSave);

  /** Base tiles for composite (thumbnail/export); empty when layer 1 is hidden. */
  const baseTilesForComposite = useMemo(() => {
    const rows = gridLayoutForSaveImage.rows;
    const cols = gridLayoutForSaveImage.columns;
    const n = rows * cols;
    if (n <= 0) return [];
    if (activeFile?.layerVisibility?.[1] === false) {
      return Array.from({ length: n }, () => ({
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      }));
    }
    return tilesForSaveImage;
  }, [
    activeFile?.layerVisibility,
    gridLayoutForSaveImage.rows,
    gridLayoutForSaveImage.columns,
    tilesForSaveImage,
  ]);

  /** Overlay layers (L2, L3) for composite thumbnail/preview; only includes visible layers. */
  const overlayLayersForThumbnail = useMemo(() => {
    const cols = gridLayoutForSaveImage.columns;
    const rows = gridLayoutForSaveImage.rows;
    const level1TileSize = gridLayoutForSaveImage.tileSize;
    if (cols <= 0 || rows <= 0) return undefined;
    const layers: Array<{
      tiles: Tile[];
      levelInfo: LevelGridInfo;
      level1TileSize: number;
      gridGap: number;
      lineColor?: string;
      lineWidth?: number;
      strokeScaleByName?: Map<string, number>;
    }> = [];
    if (activeFile?.layerVisibility?.[2] !== false) {
      const level2Info = getLevelGridInfo(cols, rows, 2);
      const l2Tiles = editingLevel === 2 ? tiles : (activeFile?.layers?.[2] ?? []);
      if (level2Info && l2Tiles.length === level2Info.cells.length) {
        layers.push({
          tiles: l2Tiles,
          levelInfo: level2Info,
          level1TileSize,
          gridGap: GRID_GAP,
          lineColor: activeLineColor,
          lineWidth: activeLineWidth,
          strokeScaleByName,
        });
      }
    }
    if (activeFile?.layerVisibility?.[3] !== false) {
      const level3Info = getLevelGridInfo(cols, rows, 3);
      const l3Tiles = editingLevel === 3 ? tiles : (activeFile?.layers?.[3] ?? []);
      if (level3Info && l3Tiles.length === level3Info.cells.length) {
        layers.push({
          tiles: l3Tiles,
          levelInfo: level3Info,
          level1TileSize,
          gridGap: GRID_GAP,
          lineColor: activeLineColor,
          lineWidth: activeLineWidth,
          strokeScaleByName,
        });
      }
    }
    return layers.length > 0 ? layers : undefined;
  }, [
    gridLayoutForSaveImage.columns,
    gridLayoutForSaveImage.rows,
    gridLayoutForSaveImage.tileSize,
    editingLevel,
    tiles,
    activeFile?.layers,
    activeFile?.layerVisibility,
    activeLineColor,
    activeLineWidth,
    strokeScaleByName,
  ]);

  const gridWidth = displayGridWidth;
  const gridHeight = displayGridHeight;

  /** Display is always level-1 composite so switching layers only changes grid lines. When zoomed: use file-based slice so the view is stable when switching to L2/L3; when editing L1 use the hook's zoom slice so in-progress edits are visible. */
  const zoomRows = zoomRegion ? zoomRegion.maxRow - zoomRegion.minRow + 1 : 0;
  const zoomCols = zoomRegion ? zoomRegion.maxCol - zoomRegion.minCol + 1 : 0;
  const zoomedDisplayTiles =
    zoomRegion && zoomedLevel1TilesSlice
      ? editingLevel === 1
        ? level1TilesForDisplay
        : zoomedLevel1TilesSlice
      : null;
  const effectiveRows = zoomedDisplayTiles ? zoomRows : level1DisplayLayout.rows;
  const effectiveCols = zoomedDisplayTiles ? zoomCols : level1DisplayLayout.columns;
  const effectiveTileSize = zoomedDisplayTiles ? gridLayout.tileSize : level1DisplayLayout.tileSize;
  const effectiveTiles = zoomedDisplayTiles ?? level1TilesForDisplay;

  /** When zoomed, use zoomed content dimensions so the canvas can be centered; otherwise full grid size. */
  const actualGridWidth = zoomRegion
    ? effectiveCols * effectiveTileSize + (effectiveCols - 1) * GRID_GAP
    : gridWidth;
  const actualGridHeight = zoomRegion
    ? effectiveRows * effectiveTileSize + (effectiveRows - 1) * GRID_GAP
    : gridHeight;

  const effectiveRowIndices = useMemo(
    () => Array.from({ length: effectiveRows }, (_, i) => i),
    [effectiveRows]
  );
  const effectiveColumnIndices = useMemo(
    () => Array.from({ length: effectiveCols }, (_, i) => i),
    [effectiveCols]
  );

  /** Level-2 overlay: cell size in px. Baked image uses proportionally thinner stroke so it's not just L1 scaled (same stroke/cell ratio as L1). */
  const level2CellSize =
    level1DisplayLayout.tileSize * 2 + GRID_GAP;
  const TILE_VIEWBOX_SIZE = 256;
  const level2StrokeWidth = useMemo(() => {
    const base = level1DisplayLayout.tileSize;
    if (base <= 0 || level2CellSize <= 0) return activeLineWidth;
    return activeLineWidth * (base / level2CellSize);
  }, [level1DisplayLayout.tileSize, level2CellSize, activeLineWidth]);
  const level2StrokeScaleByName = useMemo(() => {
    const map = new Map<string, number>();
    strokeScaleByName.forEach((scale, name) => {
      map.set(name, scale ?? 1);
    });
    return map;
  }, [strokeScaleByName]);
  const level2Atlas = useTileAtlas({
    tileSources: renderTileSources,
    tileSize: level2CellSize,
    strokeColor: activeLineColor,
    strokeWidth: level2StrokeWidth,
    strokeScaleByName: level2StrokeScaleByName,
  });

  /** Level-3 overlay: 4×4 level-1 tiles per cell. Same viewBox stroke formula so rasterized stroke matches L1 ratio. */
  const level3CellSize =
    level1DisplayLayout.tileSize * 4 + GRID_GAP * 3;
  const level3StrokeWidth = useMemo(() => {
    const base = level1DisplayLayout.tileSize;
    if (base <= 0 || level3CellSize <= 0) return activeLineWidth;
    return activeLineWidth * (base / level3CellSize);
  }, [level1DisplayLayout.tileSize, level3CellSize, activeLineWidth]);
  const level3StrokeScaleByName = useMemo(() => {
    const map = new Map<string, number>();
    strokeScaleByName.forEach((scale, name) => {
      map.set(name, scale ?? 1);
    });
    return map;
  }, [strokeScaleByName]);
  const level3Atlas = useTileAtlas({
    tileSources: renderTileSources,
    tileSize: level3CellSize,
    strokeColor: activeLineColor,
    strokeWidth: level3StrokeWidth,
    strokeScaleByName: level3StrokeScaleByName,
  });

  const brushPanelHeight = reservedBrushHeight;
  const brushRows = PALETTE_FIXED_ROWS;
  const brushItemSize = PALETTE_FIXED_TILE_SIZE;
  const gridAtlas = useTileAtlas({
    tileSources: renderTileSources,
    tileSize: effectiveTileSize,
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
  /** When true, we have zoomed in this session so pending restore must not overwrite current grid on zoom out. */
  const hasZoomedInThisSessionRef = useRef(false);
  /** Last loadRequestId we handled; prevents re-running the load effect on setSettings re-render and resetting hydrating/loadedToken. */
  const lastLoadRequestIdHandledRef = useRef(0);
  useEffect(() => {
    if (viewMode !== 'modify') {
      lastLoadRequestIdHandledRef.current = 0;
    }
  }, [viewMode]);
  const setHydrating = useCallback((value: boolean) => {
    isHydratingFileRef.current = value;
    setIsHydratingFile(value);
  }, []);
  const handleCreateNewFile = useCallback(() => {
    const initialSources = getSourcesForSelection(
      activeCategories,
      selectedTileSetIds
    ).map((source: { name: string }) => source.name);
    createFile(DEFAULT_CATEGORY, NEW_FILE_TILE_SIZE, {
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
    setShowModifyTileSetBanner(false);
    // Force grid resolution to L1 (finest) so the grid hook uses full level-1 dimensions.
    // If we left a coarser layer selected (e.g. L2), the hook could receive that layer's
    // fixedRows/fixedColumns and initialize the new file with the wrong grid size.
    setSettings((prev) => ({ ...prev, gridResolutionLevel: 1 }));
    setViewMode('modify');
  }, [
    activeCategories,
    selectedTileSetIds,
    getSourcesForSelection,
    createFile,
    activeLineWidth,
    activeLineColor,
    setFileSourceNames,
    setZoomRegion,
    setLoadRequestId,
    setLoadPreviewUri,
    setSuspendTiles,
    setLoadedToken,
    setHydrating,
    setShowModifyTileSetBanner,
    setSettings,
    setViewMode,
  ]);
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
    const tilesSnapshot =
      fileSnapshot?.tiles ??
      (editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []));
    const gridSnapshot =
      fileSnapshot?.grid ??
      (editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave));
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
    fullTilesForSave,
    fullGridLayoutForSave,
    editingLevel,
    activeFile?.tiles,
    level1LayoutForPersist,
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
    if (loadRequestId === lastLoadRequestIdHandledRef.current) {
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
    lastLoadRequestIdHandledRef.current = loadRequestId;
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
    hasZoomedInThisSessionRef.current = false;
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
    const maxLevel = Math.min(
      getMaxGridResolutionLevel(file.grid.columns, file.grid.rows),
      MAX_EDITABLE_GRID_LEVEL
    );
    setSettings((prev) => ({
      ...prev,
      gridResolutionLevel: Math.max(1, maxLevel - 1),
    }));
  }, [activeFileId, loadRequestId, ready, viewMode, clearCloneSource, setSettings]);

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
    const fileDimensionsMatch =
      activeFile &&
      pending.rows === activeFile.grid.rows &&
      pending.columns === activeFile.grid.columns;
    // Enter non-empty branch when canApplyNonEmptyRestore passes, OR when file dimensions match but
    // pending has empty level-1 tiles (e.g. file was never edited at L1). In that case gridLayout
    // is the current layer (e.g. N-1) so canApplyNonEmptyRestore is false; we still need to run
    // load-or-defer so we clear pending and setLoadedToken (avoid stuck preview).
    const canApplyNonEmpty = canApplyNonEmptyRestore(pendingShape, shapeForApply);
    const enterViaFileDimensionsOnly =
      shapeForApply &&
      !canApplyNonEmpty &&
      Boolean(fileDimensionsMatch) &&
      pending.rows > 0 &&
      pending.columns > 0;
    const enterNonEmptyBranch =
      shapeForApply &&
      (canApplyNonEmpty || enterViaFileDimensionsOnly);
    if (typeof __DEV__ !== 'undefined' && __DEV__ && enterViaFileDimensionsOnly) {
      console.log('[apply effect] Entering non-empty branch via fileDimensionsMatch (empty L1 tiles)', {
        pendingRows: pending.rows,
        pendingCols: pending.columns,
        pendingTilesLength: pending.tiles.length,
        gridLayoutRows: gridLayout.rows,
        gridLayoutCols: gridLayout.columns,
      });
    }
    if (enterNonEmptyBranch) {
      if (hasZoomedInThisSessionRef.current) {
        pendingRestoreRef.current = null;
        setHydrating(false);
        setSuspendTiles(false);
        return;
      }
      // When editing L2/L3, gridLayout has level-2/3 dimensions so it never matches pending (level-1).
      // Use file dimensions so we load the correct layer's tiles; only apply when grid shape matches
      // to avoid loading 25 L2 tiles into a 400-cell grid (which would show as data loss).
      let didLoad = false;
      if (fileDimensionsMatch) {
        const nameSource =
          pending.sourceNames && pending.sourceNames.length > 0
            ? pending.sourceNames
            : activeFileSourceNames;
        // Load the current editing layer's data so we don't overwrite L2/L3 with L1 (race with layer-sync effect).
        let tilesToLoad: Tile[];
        if (editingLevel >= 2 && activeFile?.layers?.[editingLevel] != null && (activeFile.layers[editingLevel]?.length ?? 0) > 0) {
          const levelInfo = getLevelGridInfo(
            pending.rows,
            pending.columns,
            editingLevel
          );
          if (levelInfo && levelInfo.cells.length > 0) {
            const layerTiles = activeFile.layers[editingLevel] ?? [];
            const hydratedLayer =
              nameSource.length > 0
                ? hydrateTilesWithSourceNames(layerTiles, nameSource)
                : layerTiles;
            tilesToLoad = normalizeTiles(
              hydratedLayer,
              levelInfo.cells.length,
              tileSources.length
            );
          } else {
            const hydrated =
              nameSource.length > 0
                ? hydrateTilesWithSourceNames(pending.tiles, nameSource)
                : pending.tiles;
            tilesToLoad = hydrated;
          }
        } else {
          const hydrated =
            nameSource.length > 0
              ? hydrateTilesWithSourceNames(pending.tiles, nameSource)
              : pending.tiles;
          tilesToLoad = hydrated;
        }
        const gridCells = gridLayout.rows * gridLayout.columns;
        const expectedCells = tilesToLoad.length;
        if (gridCells === expectedCells) {
          loadTiles(tilesToLoad);
          didLoad = true;
        }
      }
      if (didLoad) {
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
      } else {
        // We didn't load (grid shape mismatch or !fileDimensionsMatch). Layer-sync will load. Defer finalize so file becomes editable.
        if (typeof __DEV__ !== 'undefined' && __DEV__ && enterViaFileDimensionsOnly) {
          console.log('[apply effect] Deferred finalize (no load, gridCells !== expectedCells); will setLoadedToken');
        }
        const token = pending.token ?? 0;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (pendingRestoreRef.current?.fileId === activeFileId && pendingRestoreRef.current?.token === token) {
              pendingRestoreRef.current = null;
              setHydrating(false);
              setSuspendTiles(false);
              setLoadedToken(token);
            }
          });
        });
      }
      return;
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__ && pending && activeFileId === pending.fileId) {
      console.log('[apply effect] Stuck preview: no branch taken', {
        pendingRows: pending.rows,
        pendingCols: pending.columns,
        pendingTilesLength: pending.tiles.length,
        gridLayoutRows: gridLayout.rows,
        gridLayoutCols: gridLayout.columns,
        canApplyNonEmpty,
        fileDimensionsMatch: Boolean(fileDimensionsMatch),
        isActuallyNewFile: Boolean(activeFile && activeFile.grid.rows === 0 && activeFile.grid.columns === 0),
      });
    }
    // Only treat as empty new file when the file itself has 0,0 grid. Prevents wiping content when pending is stale (0,0) but activeFile has real grid.
    const isActuallyNewFile =
      activeFile &&
      activeFile.grid.rows === 0 &&
      activeFile.grid.columns === 0;
    // For new files, use intended full-grid shape from preferredTileSize so we never use
    // gridLayout from a coarser layer (e.g. L2 from the previous file), which would initialize the wrong size.
    const newFileIntendedShape =
      isActuallyNewFile && (availableWidth > 0 || availableHeight > 0)
        ? computeGridLayout(
            availableWidth,
            availableHeight,
            GRID_GAP,
            (pending as { preferredTileSize?: number }).preferredTileSize ?? 25
          )
        : null;
    const emptyBranchShape = isActuallyNewFile && newFileIntendedShape
      ? newFileIntendedShape
      : shapeForApply;
    if (
      emptyBranchShape &&
      canApplyEmptyNewFileRestore(pendingShape, emptyBranchShape) &&
      isActuallyNewFile
    ) {
      if (hasZoomedInThisSessionRef.current) {
        pendingRestoreRef.current = null;
        setHydrating(false);
        setSuspendTiles(false);
        return;
      }
      resetTiles();
      pendingRestoreRef.current = null;
      setHydrating(false);
      setSuspendTiles(false);
      setLoadedToken(pending.token ?? 0);
      const maxLevel = Math.min(
        getMaxGridResolutionLevel(emptyBranchShape.columns, emptyBranchShape.rows),
        MAX_EDITABLE_GRID_LEVEL
      );
      setSettings((prev) => ({
        ...prev,
        gridResolutionLevel: Math.max(1, maxLevel - 1),
      }));
    }
  }, [
    activeFileId,
    activeFile,
    editingLevel,
    availableWidth,
    availableHeight,
    gridLayout.tileSize,
    gridLayout.columns,
    gridLayout.rows,
    loadTiles,
    setHydrating,
    loadToken,
    activeFileSourceNames,
    setSettings,
    tileSources.length,
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
                tiles: baseTilesForComposite,
                gridLayout: gridLayoutForSaveImage,
                tileSources,
                gridGap: GRID_GAP,
                blankSource: null,
                errorSource: ERROR_TILE,
                lineColor: activeLineColor,
                lineWidth: activeLineWidth,
                strokeScaleByName,
                overlayLayers: overlayLayersForThumbnail,
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
          tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
          gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
            tiles: baseTilesForComposite,
            gridLayout: gridLayoutForSaveImage,
            tileSources,
            gridGap: GRID_GAP,
            blankSource: null,
            errorSource: ERROR_TILE,
            lineColor: activeLineColor,
            lineWidth: activeLineWidth,
            strokeScaleByName,
            overlayLayers: overlayLayersForThumbnail,
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
            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
                gridLayoutForSaveImage.columns * gridLayoutForSaveImage.tileSize +
                  GRID_GAP * Math.max(0, gridLayoutForSaveImage.columns - 1)
              )
            );
            const fullHeight = Math.max(
              1,
              Math.round(
                gridLayoutForSaveImage.rows * gridLayoutForSaveImage.tileSize +
                  GRID_GAP * Math.max(0, gridLayoutForSaveImage.rows - 1)
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
            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
    fullTilesForSave,
    fullGridLayoutForSave,
    tilesForSaveImage,
    gridLayoutForSaveImage,
    editingLevel,
    level1LayoutForPersist,
    activeFile?.tiles,
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
    const stride = level1DisplayLayout.tileSize + GRID_GAP;
    const effectiveStride = effectiveTileSize + GRID_GAP;
    if (isEditingHigherLayer && levelGridInfo && level1LayoutForPersist) {
      const level1Rows = activeFile?.grid.rows ?? 0;
      const xFull = zoomRegion ? (x / effectiveStride + zoomRegion.minCol) * stride : x;
      const yFull = zoomRegion ? (y / effectiveStride + zoomRegion.minRow) * stride : y;
      return getLevelCellIndexForPoint(
        xFull,
        yFull,
        levelGridInfo,
        level1LayoutForPersist.tileSize,
        GRID_GAP,
        level1Rows
      );
    }
    const zoomed = Boolean(zoomRegion);
    const cols = zoomed ? (zoomRegion!.maxCol - zoomRegion!.minCol + 1) : gridLayout.columns;
    const rows = zoomed ? (zoomRegion!.maxRow - zoomRegion!.minRow + 1) : gridLayout.rows;
    if (cols === 0 || rows === 0) {
      return null;
    }
    const tileStride = zoomed ? effectiveStride : gridLayout.tileSize + GRID_GAP;
    const col = Math.floor(x / (tileStride || 1));
    const row = Math.floor(y / (tileStride || 1));
    if (col < 0 || row < 0 || col >= cols || row >= rows) {
      return null;
    }
    return row * cols + col;
  };

  const getSelectionBounds = (startIndex: number, endIndex: number) => {
    const cols = fullGridColumnsForMapping > 0 ? fullGridColumnsForMapping : gridLayout.columns;
    const startRow = Math.floor(startIndex / cols);
    const startCol = startIndex % cols;
    const endRow = Math.floor(endIndex / cols);
    const endCol = endIndex % cols;
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    return { minRow, maxRow, minCol, maxCol };
  };

  const paintCellIndex = (cellIndex: number) => {
    if (!canEditCurrentLayer) return;
    if (lastPaintedRef.current === cellIndex) {
      return;
    }
    lastPaintedRef.current = cellIndex;
    handlePress(cellIndex);
  };

  const clearCanvas = () => {
    clearSequenceRef.current += 1;
    if (canvasSelection) {
      if (!canEditCurrentLayer) return;
      resetTiles();
      return;
    }
    const clearId = clearSequenceRef.current;
    suppressAutosaveRef.current = true;
    setIsClearing(true);
    // Clear all layers (L1 + L2 + L3) except locked layers; other tools apply only to current layer.
    const rows = activeFile?.grid?.rows ?? 0;
    const cols = activeFile?.grid?.columns ?? 0;
    const totalL1 = rows * cols;
    const emptyTile = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
    const lockedSet = new Set(activeFile?.lockedCells ?? []);
    const emptyL1 =
      totalL1 <= 0
        ? []
        : (() => {
            const next = buildInitialTiles(totalL1);
            const current = activeFile?.tiles ?? [];
            lockedSet.forEach((i) => {
              if (i >= 0 && i < current.length && current[i]) next[i] = { ...current[i] };
            });
            return next;
          })();
    const l2Count = level2GridInfo?.cells.length ?? 0;
    const emptyL2 = Array.from({ length: l2Count }, () => ({ ...emptyTile }));
    const l3Count = level3GridInfo?.cells.length ?? 0;
    const emptyL3 = Array.from({ length: l3Count }, () => ({ ...emptyTile }));
    const newTiles =
      activeFile && isLayerLocked(activeFile, 1) ? (activeFile.tiles ?? []) : emptyL1;
    const newL2 =
      activeFile && isLayerLocked(activeFile, 2)
        ? (activeFile.layers?.[2] ?? [])
        : emptyL2;
    const newL3 =
      activeFile && isLayerLocked(activeFile, 3)
        ? (activeFile.layers?.[3] ?? [])
        : emptyL3;
    if (activeFile && totalL1 > 0) {
      upsertActiveFile({
        ...activeFile,
        tiles: newTiles,
        gridLayout: {
          rows,
          columns: cols,
          tileSize: activeFile.preferredTileSize,
        },
        category: activeFile.category,
        categories: activeFile.categories,
        preferredTileSize: activeFile.preferredTileSize,
      });
    }
    if (l2Count > 0) updateActiveFileLayer(2, newL2);
    if (l3Count > 0) updateActiveFileLayer(3, newL3);
    const tilesForCurrentLayer =
      editingLevel === 1 ? newTiles : editingLevel === 2 ? newL2 : newL3;
    loadTiles(tilesForCurrentLayer);
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
    // Apply pattern to finer layers when painting at a higher internal level
    if (
      brush.mode === 'pattern' &&
      !isPatternCreationMode &&
      isEditingHigherLayer &&
      levelGridInfo &&
      selectedPattern &&
      activeFile
    ) {
      const patCreatedAtLevel = selectedPattern.createdAtLevel;
      const hasFinerData = Array.from({ length: editingLevel - 1 }, (_, i) => i + 1).some(
        (M) => M === patCreatedAtLevel || !!(selectedPattern.layerTiles?.[M])
      );
      if (hasFinerData) {
      const cols = gridLayout.columns; // = levelGridInfo.levelCols
      const anchor = patternAnchorIndex ?? cellIndex;
      const destRow_N = Math.floor(cellIndex / cols);
      const destCol_N = cellIndex % cols;
      const anchorRow_N = Math.floor(anchor / cols);
      const anchorCol_N = anchor % cols;
      const gridCols = activeFile.grid.columns;
      const gridRows = activeFile.grid.rows;
      const patternRotation = patternRotations[selectedPattern.id] ?? 0;
      const patternMirrorX = patternMirrors[selectedPattern.id] ?? false;
      for (let M = 1; M < editingLevel; M++) {
        // Use base tiles when M matches the level the pattern was created at
        const patternDataM = M === patCreatedAtLevel
          ? { tiles: selectedPattern.tiles, width: selectedPattern.width, height: selectedPattern.height }
          : selectedPattern.layerTiles?.[M];
        if (!patternDataM) continue;
        const mInfo = getLevelGridInfo(gridCols, gridRows, M);
        if (!mInfo) continue;
        const offsets = getLevelNtoMOffsets(gridCols, gridRows, editingLevel, M);
        if (!offsets) continue;
        const { scale, C_row, C_col } = offsets;
        const mLevelCols = mInfo.levelCols;
        const mCellRowStart = destRow_N * scale + C_row;
        const mCellColStart = destCol_N * scale + C_col;
        const mAnchorRowStart = anchorRow_N * scale + C_row;
        const mAnchorColStart = anchorCol_N * scale + C_col;
        const cellUpdates: Record<number, Tile> = {};
        for (let dr = 0; dr < scale; dr++) {
          for (let dc = 0; dc < scale; dc++) {
            const mr = mCellRowStart + dr;
            const mc = mCellColStart + dc;
            if (mr < 0 || mr >= mInfo.levelRows || mc < 0 || mc >= mLevelCols) continue;
            const tile = computePatternTileFromData(
              mr - mAnchorRowStart, mc - mAnchorColStart,
              patternDataM.tiles, patternDataM.width, patternDataM.height,
              patternRotation, patternMirrorX
            );
            if (tile) {
              cellUpdates[mr * mLevelCols + mc] = {
                imageIndex: tile.imageIndex, rotation: tile.rotation,
                mirrorX: tile.mirrorX, mirrorY: tile.mirrorY,
                ...(tile.name !== undefined && { name: tile.name }),
              };
            }
          }
        }
        if (Object.keys(cellUpdates).length > 0) {
          if (!finerLayerPendingRef.current[M]) finerLayerPendingRef.current[M] = {};
          Object.assign(finerLayerPendingRef.current[M], cellUpdates);
        }
      }
      scheduleFinerLayerFlush();
      } // end hasFinerData
    }
  };

  const patternSelectionRect = useMemo(() => {
    if (!patternSelection || gridLayout.columns === 0) {
      return null;
    }
    // patternSelection is in layer-N space; use gridLayout.columns (not fullGridColumnsForMapping)
    const pCols = gridLayout.columns;
    const psStartRow = Math.floor(patternSelection.start / pCols);
    const psStartCol = patternSelection.start % pCols;
    const psEndRow = Math.floor(patternSelection.end / pCols);
    const psEndCol = patternSelection.end % pCols;
    const minRow = Math.min(psStartRow, psEndRow);
    const maxRow = Math.max(psStartRow, psEndRow);
    const minCol = Math.min(psStartCol, psEndCol);
    const maxCol = Math.max(psStartCol, psEndCol);
    // When editing a higher layer, derive pixel bounds from levelGridInfo.cells + level-1 stride
    // so the box aligns with the grid background (drawn at level-1 tileSize, not layerFixedTileSize).
    if (isEditingHigherLayer && levelGridInfo && level1DisplayLayout && level1DisplayLayout.tileSize > 0) {
      const l1Stride = level1DisplayLayout.tileSize + GRID_GAP;
      const startCellIdx = minRow * levelGridInfo.levelCols + minCol;
      const endCellIdx = maxRow * levelGridInfo.levelCols + maxCol;
      const startCell = levelGridInfo.cells[startCellIdx];
      const endCell = levelGridInfo.cells[endCellIdx];
      if (!startCell || !endCell) return null;
      const left = startCell.minCol * l1Stride;
      const top = startCell.minRow * l1Stride;
      const right = (endCell.maxCol + 1) * l1Stride - (GRID_GAP > 0 ? GRID_GAP : 0);
      const bottom = (endCell.maxRow + 1) * l1Stride - (GRID_GAP > 0 ? GRID_GAP : 0);
      return { left, top, width: right - left, height: bottom - top };
    }
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
  }, [patternSelection, gridLayout.columns, gridLayout.tileSize, gridLayout.rows, isEditingHigherLayer, levelGridInfo, level1DisplayLayout]);
  /** Selection is always stored in full level-1 indices; draw the green outline in level-1 coordinates so it aligns with the grid at any layer. */
  const canvasSelectionRect = useMemo(() => {
    if (!canvasSelection || fullGridColumnsForMapping <= 0) return null;
    const fullCols = fullGridColumnsForMapping;
    const stride = (zoomRegion ? effectiveTileSize : level1DisplayLayout.tileSize) + GRID_GAP;
    const startRow = Math.floor(canvasSelection.start / fullCols);
    const startCol = canvasSelection.start % fullCols;
    const endRow = Math.floor(canvasSelection.end / fullCols);
    const endCol = canvasSelection.end % fullCols;
    const fullMinRow = Math.min(startRow, endRow);
    const fullMaxRow = Math.max(startRow, endRow);
    const fullMinCol = Math.min(startCol, endCol);
    const fullMaxCol = Math.max(startCol, endCol);
    let minRow: number;
    let maxRow: number;
    let minCol: number;
    let maxCol: number;
    if (zoomRegion) {
      const zoomRows = zoomRegion.maxRow - zoomRegion.minRow + 1;
      const zoomCols = zoomRegion.maxCol - zoomRegion.minCol + 1;
      minRow = Math.max(0, Math.min(zoomRows - 1, fullMinRow - zoomRegion.minRow));
      maxRow = Math.max(0, Math.min(zoomRows - 1, fullMaxRow - zoomRegion.minRow));
      minCol = Math.max(0, Math.min(zoomCols - 1, fullMinCol - zoomRegion.minCol));
      maxCol = Math.max(0, Math.min(zoomCols - 1, fullMaxCol - zoomRegion.minCol));
      if (minRow > maxRow || minCol > maxCol) return null;
    } else {
      minRow = fullMinRow;
      maxRow = fullMaxRow;
      minCol = fullMinCol;
      maxCol = fullMaxCol;
    }
    const width =
      (maxCol - minCol + 1) * stride - (GRID_GAP > 0 ? GRID_GAP : 0);
    const height =
      (maxRow - minRow + 1) * stride - (GRID_GAP > 0 ? GRID_GAP : 0);
    return {
      left: minCol * stride,
      top: minRow * stride,
      width,
      height,
    };
  }, [canvasSelection, fullGridColumnsForMapping, level1DisplayLayout.tileSize, zoomRegion]);

  const selectionBoundsFullGrid = useMemo(() => {
    if (!canvasSelection || fullGridColumnsForMapping <= 0) return null;
    const cols = fullGridColumnsForMapping;
    const startRow = Math.floor(canvasSelection.start / cols);
    const startCol = canvasSelection.start % cols;
    const endRow = Math.floor(canvasSelection.end / cols);
    const endCol = canvasSelection.end % cols;
    return {
      minRow: Math.min(startRow, endRow),
      maxRow: Math.max(startRow, endRow),
      minCol: Math.min(startCol, endCol),
      maxCol: Math.max(startCol, endCol),
    };
  }, [canvasSelection, fullGridColumnsForMapping]);

  /** When editing a higher resolution layer (L2/L3), convert the full-grid selection bounds to layer-cell row/col coordinates.
   * Layer cells are row-major: index = layerRow * levelCols + layerCol.
   * Returns null when not editing a higher layer or no selection. */
  const selectionBoundsLayerGrid = useMemo(() => {
    if (!selectionBoundsFullGrid || !isEditingHigherLayer || !levelGridInfo) return null;
    const { minRow, maxRow, minCol, maxCol } = selectionBoundsFullGrid;
    let layerMinRow = Infinity;
    let layerMaxRow = -Infinity;
    let layerMinCol = Infinity;
    let layerMaxCol = -Infinity;
    const { levelCols } = levelGridInfo;
    levelGridInfo.cells.forEach((cell, idx) => {
      if (
        cell.minRow >= minRow && cell.maxRow <= maxRow &&
        cell.minCol >= minCol && cell.maxCol <= maxCol
      ) {
        const layerRow = Math.floor(idx / levelCols);
        const layerCol = idx % levelCols;
        if (layerRow < layerMinRow) layerMinRow = layerRow;
        if (layerRow > layerMaxRow) layerMaxRow = layerRow;
        if (layerCol < layerMinCol) layerMinCol = layerCol;
        if (layerCol > layerMaxCol) layerMaxCol = layerCol;
      }
    });
    if (layerMinRow === Infinity) return null;
    return { minRow: layerMinRow, maxRow: layerMaxRow, minCol: layerMinCol, maxCol: layerMaxCol };
  }, [selectionBoundsFullGrid, isEditingHigherLayer, levelGridInfo]);

  const fullGridRows = activeFile?.grid.rows ?? 0;

  const movePreviewRect = useMemo(() => {
    if (!isMoveMode || !canvasSelection || !moveDragOffset || !selectionBoundsFullGrid) {
      return null;
    }
    const zoomed = Boolean(zoomRegion);
    const visRows = zoomed ? zoomRegion!.maxRow - zoomRegion!.minRow + 1 : gridLayout.rows;
    const visCols = zoomed ? zoomRegion!.maxCol - zoomRegion!.minCol + 1 : gridLayout.columns;
    if (visCols === 0 || visRows === 0) return null;
    const tileStride = zoomed
      ? level1DisplayLayout.tileSize + GRID_GAP
      : gridLayout.tileSize + GRID_GAP;
    // When editing a higher layer and not zoomed, use layer-cell coordinates for the preview.
    const previewBounds =
      !zoomed && isEditingHigherLayer && selectionBoundsLayerGrid
        ? selectionBoundsLayerGrid
        : selectionBoundsFullGrid;
    const { minRow: fullMinRow, maxRow: fullMaxRow, minCol: fullMinCol, maxCol: fullMaxCol } = previewBounds;
    const { dRow, dCol } = moveDragOffset;
    let visMinRow: number;
    let visMaxRow: number;
    let visMinCol: number;
    let visMaxCol: number;
    if (zoomRegion) {
      const { minRow: selMinRow, maxRow: selMaxRow, minCol: selMinCol, maxCol: selMaxCol } = selectionBoundsFullGrid;
      visMinRow = selMinRow + dRow - zoomRegion.minRow;
      visMaxRow = selMaxRow + dRow - zoomRegion.minRow;
      visMinCol = selMinCol + dCol - zoomRegion.minCol;
      visMaxCol = selMaxCol + dCol - zoomRegion.minCol;
    } else {
      visMinRow = fullMinRow + dRow;
      visMaxRow = fullMaxRow + dRow;
      visMinCol = fullMinCol + dCol;
      visMaxCol = fullMaxCol + dCol;
    }
    if (visMinRow > visRows - 1 || visMaxRow < 0 || visMinCol > visCols - 1 || visMaxCol < 0) {
      return null;
    }
    const clampMinR = Math.max(0, visMinRow);
    const clampMaxR = Math.min(visRows - 1, visMaxRow);
    const clampMinC = Math.max(0, visMinCol);
    const clampMaxC = Math.min(visCols - 1, visMaxCol);
    const width = (clampMaxC - clampMinC + 1) * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    const height = (clampMaxR - clampMinR + 1) * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0);
    return {
      left: clampMinC * tileStride,
      top: clampMinR * tileStride,
      width,
      height,
    };
  }, [isMoveMode, canvasSelection, moveDragOffset, selectionBoundsFullGrid, selectionBoundsLayerGrid, isEditingHigherLayer, gridLayout, zoomRegion, level1DisplayLayout.tileSize]);

  const handlePatternStampDragStart = useCallback((patternId: string, rotation: number, mirrorX: boolean) => {
    isStampDraggingRef.current = true;
    stampDragPatternIdRef.current = patternId;
    setStampDragPatternId(patternId);
    stampDragTransformRef.current = { rotation, mirrorX };
    setStampDropCell(null);
    stampGridDimsRef.current = {
      cols: activeFile?.grid.columns ?? 0,
      rows: activeFile?.grid.rows ?? 0,
    };
    // Capture the canvas's absolute screen position for screen→canvas coordinate conversion.
    // On web getBoundingClientRect gives client coords; on native measure() gives page coords.
    if (isWeb) {
      const el = gridTouchRef.current as any;
      if (el?.getBoundingClientRect) {
        const rect = el.getBoundingClientRect();
        canvasScreenOffsetRef.current = { x: rect.left, y: rect.top };
      }
    } else {
      (gridTouchRef.current as any)?.measure?.(
        (_fx: number, _fy: number, _w: number, _h: number, px: number, py: number) => {
          canvasScreenOffsetRef.current = { x: px, y: py };
        }
      );
    }
  }, [isWeb, activeFile?.grid.columns, activeFile?.grid.rows]);

  const handlePatternStampDragMove = useCallback((screenX: number, screenY: number) => {
    if (!stampDragPatternId) return;
    const pattern = patterns.find((p) => p.id === stampDragPatternId);
    if (!pattern) return;
    const { rotation } = stampDragTransformRef.current;
    const rotCW = ((rotation % 360) + 360) % 360;
    const { rotW: rotW_native, rotH: rotH_native } = getRotatedDimensions(rotCW, pattern.width, pattern.height);
    const mainLevel = pattern.createdAtLevel ?? 1;
    const { cols: gc, rows: gr } = stampGridDimsRef.current;
    const offsets = mainLevel > 1 ? getLevelNtoMOffsets(gc, gr, mainLevel, 1) : null;
    const displayW = offsets ? rotW_native * offsets.scale : rotW_native;
    const displayH = offsets ? rotH_native * offsets.scale : rotH_native;
    const canvasX = screenX - canvasScreenOffsetRef.current.x;
    const canvasY = screenY - canvasScreenOffsetRef.current.y;
    const tileStride = effectiveTileSize + GRID_GAP;
    const rawCol = Math.floor(canvasX / tileStride) - Math.floor(displayW / 2);
    const rawRow = Math.floor(canvasY / tileStride) - Math.floor(displayH / 2);
    let col: number;
    let row: number;
    if (offsets) {
      // Clamp in level-N cell-index space so the anchor always lands on a complete cell.
      const levelInfo = getLevelGridInfo(gc, gr, mainLevel);
      if (!levelInfo || levelInfo.levelCols < rotW_native || levelInfo.levelRows < rotH_native) {
        setStampDropCell(null);
        return;
      }
      const rawI = Math.round((rawCol - offsets.C_col) / offsets.scale);
      const rawJ = Math.round((rawRow - offsets.C_row) / offsets.scale);
      const clampedI = Math.max(0, Math.min(levelInfo.levelCols - rotW_native, rawI));
      const clampedJ = Math.max(0, Math.min(levelInfo.levelRows - rotH_native, rawJ));
      col = offsets.C_col + clampedI * offsets.scale;
      row = offsets.C_row + clampedJ * offsets.scale;
    } else {
      col = Math.max(0, Math.min(effectiveCols - displayW, rawCol));
      row = Math.max(0, Math.min(effectiveRows - displayH, rawRow));
    }
    if (
      canvasX >= 0 &&
      canvasY >= 0 &&
      canvasX < effectiveCols * tileStride &&
      canvasY < effectiveRows * tileStride
    ) {
      setStampDropCell({ row, col });
    } else {
      setStampDropCell(null);
    }
  }, [stampDragPatternId, patterns, effectiveTileSize, effectiveCols, effectiveRows]);

  const handlePatternStampDragEnd = useCallback((screenX: number, screenY: number) => {
    isStampDraggingRef.current = false;
    const patternId = stampDragPatternIdRef.current;
    stampDragPatternIdRef.current = null;
    if (patternId) {
      const pattern = patterns.find((p) => p.id === patternId);
      if (pattern) {
        const { rotation, mirrorX } = stampDragTransformRef.current;
        const rotCW = ((rotation % 360) + 360) % 360;
        const { rotW: rotW_native, rotH: rotH_native } = getRotatedDimensions(rotCW, pattern.width, pattern.height);
        const mainLevel = pattern.createdAtLevel ?? 1;
        const { cols: gc, rows: gr } = stampGridDimsRef.current;
        const offsets = mainLevel > 1 ? getLevelNtoMOffsets(gc, gr, mainLevel, 1) : null;
        const displayW = offsets ? rotW_native * offsets.scale : rotW_native;
        const displayH = offsets ? rotH_native * offsets.scale : rotH_native;
        const canvasX = screenX - canvasScreenOffsetRef.current.x;
        const canvasY = screenY - canvasScreenOffsetRef.current.y;
        const tileStride = effectiveTileSize + GRID_GAP;
        if (canvasX >= 0 && canvasY >= 0 && canvasX < effectiveCols * tileStride && canvasY < effectiveRows * tileStride) {
          const rawCol = Math.floor(canvasX / tileStride) - Math.floor(displayW / 2);
          const rawRow = Math.floor(canvasY / tileStride) - Math.floor(displayH / 2);
          let col: number;
          let row: number;
          if (offsets) {
            const levelInfo = getLevelGridInfo(gc, gr, mainLevel);
            if (!levelInfo || levelInfo.levelCols < rotW_native || levelInfo.levelRows < rotH_native) return;
            const rawI = Math.round((rawCol - offsets.C_col) / offsets.scale);
            const rawJ = Math.round((rawRow - offsets.C_row) / offsets.scale);
            col = offsets.C_col + Math.max(0, Math.min(levelInfo.levelCols - rotW_native, rawI)) * offsets.scale;
            row = offsets.C_row + Math.max(0, Math.min(levelInfo.levelRows - rotH_native, rawJ)) * offsets.scale;
          } else {
            col = Math.max(0, Math.min(effectiveCols - displayW, rawCol));
            row = Math.max(0, Math.min(effectiveRows - displayH, rawRow));
          }
          setPendingStampCell({ row, col });
          setPendingStampPatternId(patternId);
          setShowStampConfirmDialog(true);
        }
      }
    }
    setStampDragPatternId(null);
    setStampDropCell(null);
  }, [patterns, effectiveTileSize, effectiveCols, effectiveRows]);

  const handlePatternStampDragCancel = useCallback(() => {
    isStampDraggingRef.current = false;
    stampDragPatternIdRef.current = null;
    setStampDragPatternId(null);
    setStampDropCell(null);
  }, []);

  /**
   * Write stamp tiles directly to the file at a specific level.
   * anchorRow_L1 / anchorCol_L1 are always in L1 (finest, internal level 1) coordinates.
   */
  const applyStampToFileLevel = useCallback(
    (
      targetLevel: number,
      anchorRow_L1: number,
      anchorCol_L1: number,
      patternTiles: Tile[],
      patternWidth: number,
      patternHeight: number,
      rotation: number,
      mirrorX: boolean
    ) => {
      const gridCols = activeFile?.grid.columns ?? 0;
      const gridRows = activeFile?.grid.rows ?? 0;
      const mInfo = getLevelGridInfo(gridCols, gridRows, targetLevel);
      if (!mInfo) return;

      // Anchor is in L1 units; contract to targetLevel if it is coarser than L1.
      let anchorRow_M = anchorRow_L1;
      let anchorCol_M = anchorCol_L1;
      if (targetLevel > 1) {
        const offsets = getLevelNtoMOffsets(gridCols, gridRows, targetLevel, 1);
        if (!offsets) return;
        anchorRow_M = Math.floor((anchorRow_L1 - offsets.C_row) / offsets.scale);
        anchorCol_M = Math.floor((anchorCol_L1 - offsets.C_col) / offsets.scale);
      }

      const rotCW = ((rotation % 360) + 360) % 360;
      const { rotW, rotH } = getRotatedDimensions(rotCW, patternWidth, patternHeight);
      const { levelCols: mCols, levelRows: mRows } = mInfo;
      const rot = normalizeRotationCW(rotCW);
      const cellUpdates: Record<number, Tile> = {};
      for (let dr = 0; dr < rotH; dr++) {
        for (let dc = 0; dc < rotW; dc++) {
          const mr = anchorRow_M + dr;
          const mc = anchorCol_M + dc;
          if (mr < 0 || mr >= mRows || mc < 0 || mc >= mCols) continue;
          const mapped = displayToPatternCell(dr, dc, patternWidth, patternHeight, rotCW, mirrorX);
          if (!mapped) continue;
          const srcTile = patternTiles[mapped.sourceRow * patternWidth + mapped.sourceCol];
          if (!srcTile) continue;
          const tr = applyGroupRotationToTile(srcTile.rotation, srcTile.mirrorX, srcTile.mirrorY, rot);
          cellUpdates[mr * mCols + mc] = {
            imageIndex: srcTile.imageIndex,
            rotation: tr.rotation,
            mirrorX: mirrorX ? !tr.mirrorX : tr.mirrorX,
            mirrorY: tr.mirrorY,
            name: srcTile.name,
          };
        }
      }
      if (Object.keys(cellUpdates).length > 0) {
        updateActiveFileLayerCells(targetLevel, cellUpdates);
      }
    },
    [activeFile?.grid.columns, activeFile?.grid.rows, updateActiveFileLayerCells]
  );

  const stampPreviewRect = useMemo(() => {
    if (!stampDragPatternId || !stampDropCell) return null;
    const pattern = patterns.find((p) => p.id === stampDragPatternId);
    if (!pattern) return null;
    const rotCW = ((stampDragTransformRef.current.rotation % 360) + 360) % 360;
    const { rotW: rotW_native, rotH: rotH_native } = getRotatedDimensions(rotCW, pattern.width, pattern.height);
    const mainLevel = pattern.createdAtLevel ?? 1;
    let displayW = rotW_native;
    let displayH = rotH_native;
    if (mainLevel > 1) {
      const offsets = getLevelNtoMOffsets(stampGridDimsRef.current.cols, stampGridDimsRef.current.rows, mainLevel, 1);
      if (offsets) { displayW = rotW_native * offsets.scale; displayH = rotH_native * offsets.scale; }
    }
    const tileStride = effectiveTileSize + GRID_GAP;
    return {
      left: stampDropCell.col * tileStride,
      top: stampDropCell.row * tileStride,
      width: displayW * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0),
      height: displayH * tileStride - (GRID_GAP > 0 ? GRID_GAP : 0),
    };
  }, [stampDragPatternId, stampDropCell, patterns, effectiveTileSize]);

  const lockedCellIndicesSet = useMemo(() => {
    const cells = activeLayerLockedCells ?? [];
    if (cells.length === 0) {
      return null;
    }
    return new Set(cells);
  }, [activeLayerLockedCells]);
  const lockedCellIndicesArray = useMemo(
    () => (lockedCellIndicesSet ? Array.from(lockedCellIndicesSet) : null),
    [lockedCellIndicesSet]
  );
  const lockedBoundaryEdges = useMemo(() => {
    const cells = activeLayerLockedCells ?? [];
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
    activeLayerLockedCells,
    gridLayout.columns,
    gridLayout.rows,
    gridLayout.tileSize,
  ]);
  const patternAlignmentRect = useMemo(() => {
    if (
      brush.mode !== 'pattern' ||
      isPatternCreationMode ||
      !selectedPattern ||
      !effectivePatternForHook ||
      patternAnchorIndex === null ||
      gridLayout.columns === 0
    ) {
      return null;
    }
    const rotationCW =
      ((patternRotations[selectedPattern.id] ?? 0) + 360) % 360;
    const widthCells =
      rotationCW % 180 === 0 ? effectivePatternForHook.width : effectivePatternForHook.height;
    const heightCells =
      rotationCW % 180 === 0 ? effectivePatternForHook.height : effectivePatternForHook.width;
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
    effectivePatternForHook,
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
    // patternSelection is in layer-N space; use gridLayout.columns (not fullGridColumnsForMapping)
    const pCols = gridLayout.columns;
    const psStartRow = Math.floor(patternSelection.start / pCols);
    const psStartCol = patternSelection.start % pCols;
    const psEndRow = Math.floor(patternSelection.end / pCols);
    const psEndCol = patternSelection.end % pCols;
    const minRow = Math.min(psStartRow, psEndRow);
    const maxRow = Math.max(psStartRow, psEndRow);
    const minCol = Math.min(psStartCol, psEndCol);
    const maxCol = Math.max(psStartCol, psEndCol);
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
    // Capture tiles from every resolution level where complete cells fall within the selection.
    // Works regardless of the current editing level — finer and coarser levels are both captured.
    let allLayerCaptures: Record<number, { tiles: Tile[]; width: number; height: number }> | undefined;
    if (activeFile) {
      const gridCols = activeFile.grid.columns;
      const gridRows = activeFile.grid.rows;
      if (gridCols > 0 && gridRows > 0) {
        // Convert selection to level-1 bounding box
        let l1MinRow = Infinity, l1MaxRow = -Infinity, l1MinCol = Infinity, l1MaxCol = -Infinity;
        if (isEditingHigherLayer && levelGridInfo) {
          for (let j = minRow; j <= maxRow; j++) {
            for (let i = minCol; i <= maxCol; i++) {
              const cellIdx = j * levelGridInfo.levelCols + i;
              const cell = levelGridInfo.cells[cellIdx];
              if (!cell) continue;
              if (cell.minRow < l1MinRow) l1MinRow = cell.minRow;
              if (cell.maxRow > l1MaxRow) l1MaxRow = cell.maxRow;
              if (cell.minCol < l1MinCol) l1MinCol = cell.minCol;
              if (cell.maxCol > l1MaxCol) l1MaxCol = cell.maxCol;
            }
          }
        } else {
          // At level 1 the selection is already in level-1 space
          l1MinRow = minRow; l1MaxRow = maxRow; l1MinCol = minCol; l1MaxCol = maxCol;
        }
        if (l1MinRow !== Infinity) {
          const maxLevel = getMaxGridResolutionLevel(gridCols, gridRows);
          allLayerCaptures = {};
          for (let M = 1; M <= maxLevel; M++) {
            if (M === editingLevel) continue; // base layer captured separately
            const mInfo = getLevelGridInfo(gridCols, gridRows, M);
            if (!mInfo) continue;
            const mLevelCols = mInfo.levelCols;
            let mMinRow = Infinity, mMaxRow = -Infinity, mMinCol = Infinity, mMaxCol = -Infinity;
            mInfo.cells.forEach((cell, idx) => {
              if (
                cell.minRow >= l1MinRow && cell.maxRow <= l1MaxRow &&
                cell.minCol >= l1MinCol && cell.maxCol <= l1MaxCol
              ) {
                const mr = Math.floor(idx / mLevelCols);
                const mc = idx % mLevelCols;
                if (mr < mMinRow) mMinRow = mr;
                if (mr > mMaxRow) mMaxRow = mr;
                if (mc < mMinCol) mMinCol = mc;
                if (mc > mMaxCol) mMaxCol = mc;
              }
            });
            if (mMinRow === Infinity) continue;
            const mW = mMaxCol - mMinCol + 1;
            const mH = mMaxRow - mMinRow + 1;
            const sourceTiles = M === 1 ? (activeFile.tiles ?? []) : (activeFile.layers?.[M] ?? []);
            const mTiles: Tile[] = [];
            for (let mr = mMinRow; mr <= mMaxRow; mr++) {
              for (let mc = mMinCol; mc <= mMaxCol; mc++) {
                const src = sourceTiles[mr * mLevelCols + mc];
                mTiles.push(src ? { ...src } : { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false });
              }
            }
            allLayerCaptures[M] = { tiles: mTiles, width: mW, height: mH };
          }
          if (Object.keys(allLayerCaptures).length === 0) allLayerCaptures = undefined;
        }
      }
    }
    const patternId = createPattern({
      category: primaryCategory,
      width,
      height,
      tiles: nextTiles,
      createdAtLevel: editingLevel,
      ...(allLayerCaptures && { layerTiles: allLayerCaptures }),
      ...(saveTileSetIds.length > 0 && { tileSetIds: saveTileSetIds }),
    });
    setSelectedPatternId(patternId);
    setIsPatternCreationMode(false);
    setPatternSelection(null);
    setShowPatternSaveModal(false);
    setBrush({ mode: 'pattern' });
  };

  const handleCancelPattern = () => {
    setShowPatternSaveModal(false);
    setPatternSelection(null);
    setIsPatternCreationMode(false);
    setBrush({ mode: 'pattern' });
  };

  /**
   * Apply pattern data to finer layers (levels 1..editingLevel-1) for flood fill operations.
   * @param isFloodComplete - if true, only fill cells where imageIndex === -1 (flood complete mode).
   */
  const applyPatternFloodToFinerLayers = (isFloodComplete: boolean) => {
    if (!isEditingHigherLayer || !levelGridInfo || !selectedPattern || !activeFile) return;
    const patCreatedAtLevel = selectedPattern.createdAtLevel;
    // Check if any finer level has data in this pattern
    const hasFinerData = Array.from({ length: editingLevel - 1 }, (_, i) => i + 1).some(
      (M) => M === patCreatedAtLevel || !!(selectedPattern.layerTiles?.[M])
    );
    if (!hasFinerData) return;
    const gridCols = activeFile.grid.columns;
    const gridRows = activeFile.grid.rows;
    const patternRotation = patternRotations[selectedPattern.id] ?? 0;
    const patternMirrorX = patternMirrors[selectedPattern.id] ?? false;
    // Get selection bounds in level-N space (null = entire grid)
    let selMinRow_N: number, selMaxRow_N: number, selMinCol_N: number, selMaxCol_N: number;
    if (hookCanvasSelection) {
      const lc = levelGridInfo.levelCols;
      const sMinRow = Math.floor(hookCanvasSelection.start / lc);
      const sMinCol = hookCanvasSelection.start % lc;
      const sMaxRow = Math.floor(hookCanvasSelection.end / lc);
      const sMaxCol = hookCanvasSelection.end % lc;
      selMinRow_N = Math.min(sMinRow, sMaxRow);
      selMaxRow_N = Math.max(sMinRow, sMaxRow);
      selMinCol_N = Math.min(sMinCol, sMaxCol);
      selMaxCol_N = Math.max(sMinCol, sMaxCol);
    } else {
      selMinRow_N = 0; selMaxRow_N = levelGridInfo.levelRows - 1;
      selMinCol_N = 0; selMaxCol_N = levelGridInfo.levelCols - 1;
    }
    for (let M = 1; M < editingLevel; M++) {
      // Use base tiles when M matches the level the pattern was created at
      const patternDataM = M === patCreatedAtLevel
        ? { tiles: selectedPattern.tiles, width: selectedPattern.width, height: selectedPattern.height }
        : selectedPattern.layerTiles?.[M];
      if (!patternDataM) continue;
      const mInfo = getLevelGridInfo(gridCols, gridRows, M);
      if (!mInfo) continue;
      const offsets = getLevelNtoMOffsets(gridCols, gridRows, editingLevel, M);
      if (!offsets) continue;
      const { scale, C_row, C_col } = offsets;
      const mLevelCols = mInfo.levelCols;
      const mMinRow = Math.max(0, selMinRow_N * scale + C_row);
      const mMaxRow = Math.min(mInfo.levelRows - 1, (selMaxRow_N + 1) * scale + C_row - 1);
      const mMinCol = Math.max(0, selMinCol_N * scale + C_col);
      const mMaxCol = Math.min(mLevelCols - 1, (selMaxCol_N + 1) * scale + C_col - 1);
      if (mMinRow > mMaxRow || mMinCol > mMaxCol) continue;
      const sourceTiles = M === 1 ? (activeFile.tiles ?? []) : (activeFile.layers?.[M] ?? []);
      const newMTiles = [...sourceTiles];
      while (newMTiles.length < mInfo.cells.length) {
        newMTiles.push({ imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false });
      }
      for (let mr = mMinRow; mr <= mMaxRow; mr++) {
        for (let mc = mMinCol; mc <= mMaxCol; mc++) {
          const mIdx = mr * mLevelCols + mc;
          if (isFloodComplete && (newMTiles[mIdx]?.imageIndex ?? -1) !== -1) continue;
          const tile = computePatternTileFromData(
            mr - mMinRow, mc - mMinCol, patternDataM.tiles, patternDataM.width, patternDataM.height,
            patternRotation, patternMirrorX
          );
          if (tile) {
            newMTiles[mIdx] = { imageIndex: tile.imageIndex, rotation: tile.rotation, mirrorX: tile.mirrorX, mirrorY: tile.mirrorY, ...(tile.name !== undefined && { name: tile.name }) };
          }
        }
      }
      if (M === 1) {
        updateActiveFileTilesL1(newMTiles);
      } else {
        updateActiveFileLayer(M, newMTiles);
      }
    }
  };

  const pendingPatternPreview = useMemo(() => {
    if (!patternSelection || gridLayout.columns === 0) {
      return null;
    }
    // patternSelection is in layer-N space; use gridLayout.columns (not fullGridColumnsForMapping)
    const pCols = gridLayout.columns;
    const psStartRow = Math.floor(patternSelection.start / pCols);
    const psStartCol = patternSelection.start % pCols;
    const psEndRow = Math.floor(patternSelection.end / pCols);
    const psEndCol = patternSelection.end % pCols;
    const minRow = Math.min(psStartRow, psEndRow);
    const maxRow = Math.max(psStartRow, psEndRow);
    const minCol = Math.min(psStartCol, psEndCol);
    const maxCol = Math.max(psStartCol, psEndCol);
    const width = maxCol - minCol + 1;
    const height = maxRow - minRow + 1;
    if (width <= 0 || height <= 0) {
      return null;
    }
    const tileSize = Math.max(
      8,
      Math.floor(120 / Math.max(1, height))
    );
    // Base layer tiles (current editing layer)
    const baseTiles: Tile[] = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * gridLayout.columns + col;
        baseTiles.push(
          tiles[index] ?? { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false }
        );
      }
    }
    // Capture all other resolution levels (same logic as handleSavePattern)
    let layerTiles: Record<number, { tiles: Tile[]; width: number; height: number }> | undefined;
    if (activeFile) {
      const gridCols = activeFile.grid.columns;
      const gridRows = activeFile.grid.rows;
      if (gridCols > 0 && gridRows > 0) {
        let l1MinRow = Infinity, l1MaxRow = -Infinity, l1MinCol = Infinity, l1MaxCol = -Infinity;
        if (isEditingHigherLayer && levelGridInfo) {
          for (let j = minRow; j <= maxRow; j++) {
            for (let i = minCol; i <= maxCol; i++) {
              const cellIdx = j * levelGridInfo.levelCols + i;
              const cell = levelGridInfo.cells[cellIdx];
              if (!cell) continue;
              if (cell.minRow < l1MinRow) l1MinRow = cell.minRow;
              if (cell.maxRow > l1MaxRow) l1MaxRow = cell.maxRow;
              if (cell.minCol < l1MinCol) l1MinCol = cell.minCol;
              if (cell.maxCol > l1MaxCol) l1MaxCol = cell.maxCol;
            }
          }
        } else {
          l1MinRow = minRow; l1MaxRow = maxRow; l1MinCol = minCol; l1MaxCol = maxCol;
        }
        if (l1MinRow !== Infinity) {
          const maxLevel = getMaxGridResolutionLevel(gridCols, gridRows);
          layerTiles = {};
          for (let M = 1; M <= maxLevel; M++) {
            if (M === editingLevel) continue;
            const mInfo = getLevelGridInfo(gridCols, gridRows, M);
            if (!mInfo) continue;
            const mLevelCols = mInfo.levelCols;
            let mMinRow = Infinity, mMaxRow = -Infinity, mMinCol = Infinity, mMaxCol = -Infinity;
            mInfo.cells.forEach((cell, idx) => {
              if (
                cell.minRow >= l1MinRow && cell.maxRow <= l1MaxRow &&
                cell.minCol >= l1MinCol && cell.maxCol <= l1MaxCol
              ) {
                const mr = Math.floor(idx / mLevelCols);
                const mc = idx % mLevelCols;
                if (mr < mMinRow) mMinRow = mr;
                if (mr > mMaxRow) mMaxRow = mr;
                if (mc < mMinCol) mMinCol = mc;
                if (mc > mMaxCol) mMaxCol = mc;
              }
            });
            if (mMinRow === Infinity) continue;
            const mW = mMaxCol - mMinCol + 1;
            const mH = mMaxRow - mMinRow + 1;
            const sourceTiles = M === 1 ? (activeFile.tiles ?? []) : (activeFile.layers?.[M] ?? []);
            const mTiles: Tile[] = [];
            for (let mr = mMinRow; mr <= mMaxRow; mr++) {
              for (let mc = mMinCol; mc <= mMaxCol; mc++) {
                const src = sourceTiles[mr * mLevelCols + mc];
                mTiles.push(src ? { ...src } : { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false });
              }
            }
            layerTiles[M] = { tiles: mTiles, width: mW, height: mH };
          }
          if (Object.keys(layerTiles).length === 0) layerTiles = undefined;
        }
      }
    }
    return {
      tileSize,
      pattern: {
        tiles: baseTiles,
        width,
        height,
        createdAtLevel: editingLevel,
        ...(layerTiles && { layerTiles }),
      },
    };
  }, [patternSelection, gridLayout.columns, tiles, activeFile, isEditingHigherLayer, levelGridInfo, editingLevel]);

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
            gridLayoutForSaveImage.columns * gridLayoutForSaveImage.tileSize +
              GRID_GAP * Math.max(0, gridLayoutForSaveImage.columns - 1)
          )
        );
        const fullHeight = Math.max(
          1,
          Math.round(
            gridLayoutForSaveImage.rows * gridLayoutForSaveImage.tileSize +
              GRID_GAP * Math.max(0, gridLayoutForSaveImage.rows - 1)
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
        tiles: tilesForSaveImage,
        gridLayout: gridLayoutForSaveImage,
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
      tiles: baseTilesForComposite,
      gridLayout: gridLayoutForSaveImage,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: null,
      errorSource: ERROR_TILE,
      lineColor: activeLineColor,
      lineWidth: activeLineWidth,
      strokeScaleByName,
      overlayLayers: overlayLayersForThumbnail,
      maxDimension: 0,
      format: 'image/png',
      quality: 1,
    });
    const thumbnailUri = await renderTileCanvasToDataUrl({
      tiles: baseTilesForComposite,
      gridLayout: gridLayoutForSaveImage,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: null,
      errorSource: ERROR_TILE,
      lineColor: activeLineColor,
      lineWidth: activeLineWidth,
      strokeScaleByName,
      overlayLayers: overlayLayersForThumbnail,
      maxDimension: FILE_THUMB_SIZE,
    });
    upsertActiveFile({
      tiles: tilesForSaveImage,
      gridLayout: gridLayoutForSaveImage,
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

  const exportSelectedPatternsAsTile = useCallback(async () => {
    if (selectedPatternIdsForExport.length === 0) {
      setShowPatternExportMenu(false);
      return;
    }
    const selectedPatternsList = activePatterns.filter((p) =>
      selectedPatternIdsForExport.includes(p.id)
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
  }, [activePatterns, selectedPatternIdsForExport, patterns, userTileSets]);

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

  /** Base tiles for rendering a file (empty when layer 1 is hidden). Use when exporting or drawing. */
  const getBaseTilesForExportFile = useCallback((file: TileFile): Tile[] => {
    const n = (file.grid?.rows ?? 0) * (file.grid?.columns ?? 0);
    if (n <= 0) return file.tiles ?? [];
    if (file.layerVisibility?.[1] === false) {
      return Array.from({ length: n }, () => ({
        imageIndex: -1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
      }));
    }
    return file.tiles ?? [];
  }, []);

  /** Build overlay layers (L2, L3) for a file for export; only includes visible layers. */
  const getOverlayLayersForFile = useCallback(
    (file: TileFile): RenderSvgOverlayLayer[] | undefined => {
      const cols = file.grid?.columns ?? 0;
      const rows = file.grid?.rows ?? 0;
      const level1TileSize = file.preferredTileSize ?? 0;
      if (cols <= 0 || rows <= 0) return undefined;
      const layers: RenderSvgOverlayLayer[] = [];
      if (file.layerVisibility?.[2] !== false) {
        const level2Info = getLevelGridInfo(cols, rows, 2);
        const l2Tiles = file.layers?.[2] ?? [];
        if (level2Info && l2Tiles.length === level2Info.cells.length) {
          layers.push({
            tiles: l2Tiles,
            levelInfo: level2Info,
            level1TileSize,
            gridGap: GRID_GAP,
            lineColor: file.lineColor,
            lineWidth: file.lineWidth,
            strokeScaleByName,
          });
        }
      }
      if (file.layerVisibility?.[3] !== false) {
        const level3Info = getLevelGridInfo(cols, rows, 3);
        const l3Tiles = file.layers?.[3] ?? [];
        if (level3Info && l3Tiles.length === level3Info.cells.length) {
          layers.push({
            tiles: l3Tiles,
            levelInfo: level3Info,
            level1TileSize,
            gridGap: GRID_GAP,
            lineColor: file.lineColor,
            lineWidth: file.lineWidth,
            strokeScaleByName,
          });
        }
      }
      return layers.length > 0 ? layers : undefined;
    },
    [strokeScaleByName]
  );

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
          overlayLayers: getOverlayLayersForFile(file),
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
        tiles: getBaseTilesForExportFile(file),
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
        overlayLayers: getOverlayLayersForFile(file),
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
  }, [selectedFiles, getSourcesForFile, downloadFile, strokeScaleByName, settings.backgroundColor, getOverlayLayersForFile, getBaseTilesForExportFile]);

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
          tiles: getBaseTilesForExportFile(file),
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
          overlayLayers: getOverlayLayersForFile(file),
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
        tiles: getBaseTilesForExportFile(file),
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
        overlayLayers: getOverlayLayersForFile(file),
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
    getOverlayLayersForFile,
    getBaseTilesForExportFile,
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
        tiles: getBaseTilesForExportFile(downloadTargetFile),
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
        overlayLayers: getOverlayLayersForFile(downloadTargetFile),
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
              onPress={handleCreateNewFile}
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
          {userFiles.length === 0 && (
            <Pressable
              style={[styles.fileCard, { width: fileCardWidth }]}
              onPress={handleCreateNewFile}
              accessibilityRole="button"
              accessibilityLabel="Create new file"
            >
              <LinearGradient
                colors={['#172554', '#010409', '#000000']}
                locations={[0, 0.6, 0.95]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.fileThumb,
                  styles.newFileEmptyThumb,
                  {
                    width: fileCardWidth,
                    height: fileCardWidth,
                  },
                ]}
              >
                <View
                  style={[
                    styles.newFileEmptyIconCenter,
                    {
                      transform: [
                        { translateX: -((Platform.OS === 'web' ? 96 / PixelRatio.get() : 96) / 2) },
                        { translateY: -((Platform.OS === 'web' ? 96 / PixelRatio.get() : 96) / 2) },
                      ],
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="plus"
                    size={Platform.OS === 'web' ? 96 / PixelRatio.get() : 96}
                    color="#9ca3af"
                  />
                </View>
                <ThemedText type="defaultSemiBold" style={styles.newFileEmptyLabel}>
                  New
                </ThemedText>
              </LinearGradient>
            </Pressable>
          )}
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
                        overlayLayers: getOverlayLayersForFile(file),
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
                <ThemedText type="defaultSemiBold">Developer mode</ThemedText>
                <Switch
                  value={settings.developerMode}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, developerMode: value }))
                  }
                  accessibilityLabel="Toggle developer mode"
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
                  if (settings.mirrorHorizontal || settings.mirrorVertical) {
                    setShowZoomOutMirrorConfirm(true);
                  } else {
                    setZoomRegion(null);
                  }
                } else {
                  void (async () => {
                    await persistActiveFileNow();
                    setViewMode('file');
                  })();
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
                  setIsMoveMode(false);
                  setShowMoveConfirmDialog(false);
                  setPendingMoveOffset(null);
                  setMoveDragOffset(null);
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
                    // canvasSelection.start/end are always level-1 indices.
                    // For higher layers use selectionBoundsLayerGrid (layer-N row/col space).
                    const selectionIndices = (() => {
                      if (!canvasSelection) return [];
                      if (isEditingHigherLayer && levelGridInfo && selectionBoundsLayerGrid) {
                        const { minRow, maxRow, minCol, maxCol } = selectionBoundsLayerGrid;
                        const lCols = levelGridInfo.levelCols;
                        return getCellIndicesInRegion(
                          minRow * lCols + minCol,
                          maxRow * lCols + maxCol,
                          lCols
                        );
                      }
                      if (fullGridColumnsForMapping <= 0) return [];
                      return getCellIndicesInRegion(
                        canvasSelection.start,
                        canvasSelection.end,
                        fullGridColumnsForMapping
                      );
                    })();
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
                          if (selectionIndices.length === 0) return;
                          const currentLocked = isEditingHigherLayer
                            ? (activeFile?.lockedCellsPerLayer?.[editingLevel] ?? [])
                            : (activeFile?.lockedCells ?? []);
                          if (lockedCellIndicesSet && selectionIndices.every((i) => lockedCellIndicesSet.has(i))) {
                            const next = currentLocked.filter((i) => !selectionIndices.includes(i));
                            if (isEditingHigherLayer) {
                              updateActiveFileLockedCellsForLayer(editingLevel, next);
                            } else {
                              updateActiveFileLockedCells(next);
                            }
                          } else {
                            const next = [...new Set([...currentLocked, ...selectionIndices])];
                            if (isEditingHigherLayer) {
                              updateActiveFileLockedCellsForLayer(editingLevel, next);
                            } else {
                              updateActiveFileLockedCells(next);
                            }
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
                            hasZoomedInThisSessionRef.current = true;
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
                    active={isMoveMode}
                    onPress={() => {
                      dismissModifyBanner();
                      if (!canvasSelection || fullGridColumnsForMapping === 0) return;
                      setIsMoveMode((prev) => !prev);
                      setMoveDragOffset(null);
                      setShowMoveConfirmDialog(false);
                      setPendingMoveOffset(null);
                    }}
                  />
                  <ToolbarButton
                    label="Rotate region"
                    icon="rotate-right"
                    onPress={() => {
                      dismissModifyBanner();
                      if (!canvasSelection || fullGridColumnsForMapping === 0 || !selectionBoundsFullGrid) return;
                      const { minRow, maxRow, minCol, maxCol } = selectionBoundsFullGrid;
                      const height = maxRow - minRow + 1;
                      const width = maxCol - minCol + 1;
                      const centerRow = (minRow + maxRow) / 2;
                      const centerCol = (minCol + maxCol) / 2;
                      const newHeight = width;
                      const newWidth = height;
                      let newMinRow = Math.round(centerRow - (newHeight - 1) / 2);
                      let newMaxRow = newMinRow + newHeight - 1;
                      let newMinCol = Math.round(centerCol - (newWidth - 1) / 2);
                      let newMaxCol = newMinCol + newWidth - 1;
                      const cols = fullGridColumnsForMapping;
                      const rows = fullGridRows;
                      newMinRow = Math.max(0, Math.min(newMinRow, rows - 1));
                      newMaxRow = Math.max(0, Math.min(newMaxRow, rows - 1));
                      newMinCol = Math.max(0, Math.min(newMinCol, cols - 1));
                      newMaxCol = Math.max(0, Math.min(newMaxCol, cols - 1));
                      rotateRegion(minRow, maxRow, minCol, maxCol, cols);
                      const newStart = newMinRow * cols + newMinCol;
                      const newEnd = newMaxRow * cols + newMaxCol;
                      setCanvasSelection({ start: newStart, end: newEnd });
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
                if (!canEditCurrentLayer) return;
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
                  applyPatternFloodToFinerLayers(false);
                }, 0);
              }}
              onLongPress={() => {
                dismissModifyBanner();
                if (!canEditCurrentLayer) return;
                floodLongPressHandledRef.current = true;
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                floodComplete();
                applyPatternFloodToFinerLayers(true);
              }}
            />
            <ToolbarButton
              label="Reconcile"
              icon="puzzle"
              onPress={() => {
                dismissModifyBanner();
                if (!canEditCurrentLayer) return;
                if (pendingFloodCompleteRef.current) {
                  clearTimeout(pendingFloodCompleteRef.current);
                  pendingFloodCompleteRef.current = null;
                }
                reconcileTiles();
              }}
              onLongPress={() => {
                dismissModifyBanner();
                if (!canEditCurrentLayer) return;
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
            {settings.developerMode && (
              <ToolbarButton
                label="Debug"
                icon="bug"
                onPress={() => {
                  dismissModifyBanner();
                  setShowDebugModal(true);
                }}
              />
            )}
            </ThemedView>
          </ThemedView>
        </ThemedView>
        {(undoRedoBanner !== null || zoomRegion !== null || isEditingInvisibleLayer) && (
          <View style={styles.toolbarBannersOverlay} pointerEvents="box-none">
            {undoRedoBanner !== null && (
              <View style={styles.toolbarBannerRow} overflow="hidden">
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.undoRedoBanner,
                    styles.toolbarBannerBar,
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
              </View>
            )}
            {zoomRegion !== null && (
              <View pointerEvents="box-none" style={[styles.toolbarBannerRow, styles.zoomedBannerRow]}>
                <Text
                  style={styles.undoRedoBannerText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  Zoomed in
                </Text>
                <Pressable
                  onPress={() => {
                    if (settings.mirrorHorizontal || settings.mirrorVertical) {
                      setShowZoomOutMirrorConfirm(true);
                    } else {
                      setZoomRegion(null);
                    }
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.zoomedBannerBackLink, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Zoom out to full canvas"
                >
                  <Text style={styles.zoomedBannerBackLinkText}>Back</Text>
                </Pressable>
              </View>
            )}
            {isEditingInvisibleLayer && (
              <View pointerEvents="box-none" style={[styles.toolbarBannerRow, styles.zoomedBannerRow]}>
                <Text
                  style={styles.undoRedoBannerText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  Currently editing invisible layer
                </Text>
                <Pressable
                  onPress={() => updateActiveFileLayerVisibility(editingLevel, true)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.zoomedBannerBackLink, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Make current layer visible"
                >
                  <Text style={styles.zoomedBannerBackLinkText}>Make Visible</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
        <View
          style={[
            Platform.OS === 'web' && styles.gridCanvasWebCenter,
            viewMode === 'modify' && styles.gridCanvasAreaCentered,
          ]}
          onLayout={(e) => {
            setCanvasAreaWidth(e.nativeEvent.layout.width);
            setCanvasAreaHeight(e.nativeEvent.layout.height);
          }}
        >
          <View
            key={
              zoomRegion
                ? `zoomed-${gridLayout.rows}-${gridLayout.columns}`
                : `full-${level1DisplayLayout.rows}-${level1DisplayLayout.columns}`
            }
            style={[
              styles.gridWrapper,
              {
                height: actualGridHeight,
                width: actualGridWidth,
              },
            ]}
          >
          <GridBackground
            rows={effectiveRows}
            columns={effectiveCols}
            tileSize={effectiveTileSize}
            width={actualGridWidth}
            height={actualGridHeight}
            backgroundColor={settings.backgroundColor}
            lineColor={settings.backgroundLineColor}
            lineWidth={settings.backgroundLineWidth}
            gridGap={GRID_GAP}
            gridResolutionLevel={editingLevel}
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
            actualGridWidth > 0 &&
            actualGridHeight > 0 && (
              <View pointerEvents="none" style={styles.mirrorLines}>
                {settings.mirrorHorizontal && (
                  <View
                    style={[
                      styles.mirrorLineVertical,
                      {
                        left: actualGridWidth / 2 - 1,
                        height: actualGridHeight,
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
                        top: actualGridHeight / 2 - 1,
                        width: actualGridWidth,
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
              style={[
                styles.canvasSelectionBox,
                canvasSelectionRect,
                isMoveMode && moveDragOffset && styles.canvasSelectionBoxDimmed,
              ]}
            />
          )}
          {movePreviewRect && (
            <View pointerEvents="none" style={[styles.movePreviewBox, movePreviewRect]} />
          )}
          {stampPreviewRect && (
            <View pointerEvents="none" style={[styles.movePreviewBox, stampPreviewRect]} />
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
            <View
              ref={setGridNode}
              style={[styles.grid, { opacity: gridVisible ? 1 : 0 }]}
              pointerEvents="box-none"
            >
            <ThemedView
              style={styles.grid}
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
                  if (isStampDraggingRef.current) {
                    return;
                  }
                  canvasMouseDidMoveRef.current = false;
                  setInteracting(true);
                  markInteractionStart();
                  const point = getRelativePoint(event);
                if (point) {
                  if (isMoveMode && canvasSelection && selectionBoundsFullGrid) {
                    moveDragStartRef.current = { x: point.x, y: point.y };
                    setMoveDragOffset({ dRow: 0, dCol: 0 });
                    return;
                  }
                  const cellIndex = getCellIndexForPoint(point.x, point.y);
                  if (cellIndex === null) {
                    return;
                  }
                  if (isSelectionMode) {
                    const b = getLevel1BoundsForCanvasCell(cellIndex);
                    setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
                    return;
                  }
                  if (lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))) {
                    setIsSelectionMode(true);
                    const b = getLevel1BoundsForCanvasCell(cellIndex);
                    setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
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
                  if (isStampDraggingRef.current) {
                    return;
                  }
                  canvasMouseDidMoveRef.current = true;
                  const point = getRelativePoint(event);
                  if (point) {
                    if (isMoveMode && moveDragStartRef.current && selectionBoundsFullGrid) {
                      const tileStride = gridLayout.tileSize + GRID_GAP;
                      const fullCols = fullGridColumnsForMapping;
                      let dCol = Math.round((point.x - moveDragStartRef.current.x) / (tileStride || 1));
                      let dRow = Math.round((point.y - moveDragStartRef.current.y) / (tileStride || 1));
                      const clampBounds = isEditingHigherLayer && selectionBoundsLayerGrid ? selectionBoundsLayerGrid : selectionBoundsFullGrid;
                      const clampRows = isEditingHigherLayer && levelGridInfo ? levelGridInfo.levelRows : fullGridRows;
                      const clampCols = isEditingHigherLayer && levelGridInfo ? levelGridInfo.levelCols : fullCols;
                      const { minRow, maxRow, minCol, maxCol } = clampBounds;
                      dRow = Math.max(-minRow, Math.min(clampRows - 1 - maxRow, dRow));
                      dCol = Math.max(-minCol, Math.min(clampCols - 1 - maxCol, dCol));
                      setMoveDragOffset({ dRow, dCol });
                      return;
                    }
                    if (isSelectionMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        const b = getLevel1BoundsForCanvasCell(cellIndex);
                        setCanvasSelection((prev) =>
                          prev
                            ? {
                                start: Math.min(prev.start, b.minIdx),
                                end: Math.max(prev.end, b.maxIdx),
                              }
                            : prev
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
                if (isMoveMode) {
                  if (moveDragOffset && (moveDragOffset.dRow !== 0 || moveDragOffset.dCol !== 0)) {
                    setPendingMoveOffset(moveDragOffset);
                    setShowMoveConfirmDialog(true);
                  }
                  setMoveDragOffset(null);
                  moveDragStartRef.current = null;
                  setInteracting(false);
                  return;
                }
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
                setIsMoveMode(false);
                setShowMoveConfirmDialog(false);
                setPendingMoveOffset(null);
              }}
              onTouchStartCapture={(event: any) => {
                // Use capture phase so we receive touchstart even when the target is a child
                // (e.g. tile image). Otherwise on mobile web, starting a drag on an initialized
                // tile only fires tap and touchmove never runs.
                if (isStampDraggingRef.current) {
                  return;
                }
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
                        const b = getLevel1BoundsForCanvasCell(cellIndex);
                        setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
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
                  if (isMoveMode && canvasSelection && selectionBoundsFullGrid) {
                    moveDragStartRef.current = { x: point.x, y: point.y };
                    setMoveDragOffset({ dRow: 0, dCol: 0 });
                    return;
                  }
                  const cellIndex = getCellIndexForPoint(point.x, point.y);
                  if (cellIndex === null) {
                    return;
                  }
                  if (isSelectionMode) {
                    const b = getLevel1BoundsForCanvasCell(cellIndex);
                    setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
                    return;
                  }
                  if (isPatternCreationMode) {
                    setPatternSelection({ start: cellIndex, end: cellIndex });
                    return;
                  }
                  if (lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))) {
                    setIsSelectionMode(true);
                    const b = getLevel1BoundsForCanvasCell(cellIndex);
                    setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
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
                if (isStampDraggingRef.current) {
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
                  if (isMoveMode && moveDragStartRef.current && selectionBoundsFullGrid) {
                    const tileStride = gridLayout.tileSize + GRID_GAP;
                    const fullCols = fullGridColumnsForMapping;
                    let dCol = Math.round((point.x - moveDragStartRef.current.x) / (tileStride || 1));
                    let dRow = Math.round((point.y - moveDragStartRef.current.y) / (tileStride || 1));
                    const { minRow, maxRow, minCol, maxCol } = selectionBoundsFullGrid;
                    dRow = Math.max(-minRow, Math.min(fullGridRows - 1 - maxRow, dRow));
                    dCol = Math.max(-minCol, Math.min(fullCols - 1 - maxCol, dCol));
                    setMoveDragOffset({ dRow, dCol });
                    return;
                  }
                  if (isSelectionMode) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex !== null) {
                      const b = getLevel1BoundsForCanvasCell(cellIndex);
                      setCanvasSelection((prev) =>
                        prev
                          ? {
                              start: Math.min(prev.start, b.minIdx),
                              end: Math.max(prev.end, b.maxIdx),
                            }
                          : prev
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
                if (touchCount === 0 && isMoveMode) {
                  if (moveDragOffset && (moveDragOffset.dRow !== 0 || moveDragOffset.dCol !== 0)) {
                    setPendingMoveOffset(moveDragOffset);
                    setShowMoveConfirmDialog(true);
                  }
                  setMoveDragOffset(null);
                  moveDragStartRef.current = null;
                  return;
                }
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
              {effectiveRowIndices.map((rowIndex) => (
                <ThemedView key={`row-${rowIndex}`} style={styles.row}>
                  {effectiveColumnIndices.map((columnIndex) => {
                    const cellIndex = rowIndex * effectiveCols + columnIndex;
                    const item = effectiveTiles[cellIndex];
                    const safeTile =
                      item ?? {
                        imageIndex: -1,
                        rotation: 0,
                        mirrorX: false,
                        mirrorY: false,
                      };
                    return (
                      <TileCell
                        key={`cell-${cellIndex}`}
                        cellIndex={cellIndex}
                        tileSize={effectiveTileSize}
                        tile={safeTile}
                        tileSources={renderTileSources}
                        showDebug={settings.showDebug}
                        strokeColor={isLayerEmphasized(activeFile, 1) ? getEmphasizeStrokeColor(1) : activeLineColor}
                        strokeWidth={activeLineWidth}
                        strokeScaleByName={strokeScaleByName}
                        atlas={gridAtlas}
                        resolveSourceForName={resolveSourceForName}
                        resolveUgcSourceFromName={buildUserTileSourceFromName}
                        showOverlays={showOverlays}
                        isCloneSource={
                          editingLevel === 1 && brush.mode === 'clone' && cloneSourceIndex === cellIndex
                        }
                        isCloneSample={
                          editingLevel === 1 && brush.mode === 'clone' && cloneSampleIndex === cellIndex
                        }
                        isCloneTargetOrigin={
                          editingLevel === 1 && brush.mode === 'clone' && cloneAnchorIndex === cellIndex
                        }
                        isCloneCursor={
                          editingLevel === 1 && brush.mode === 'clone' && cloneCursorIndex === cellIndex
                        }
                        isLocked={lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))}
                      />
                    );
                  })}
                </ThemedView>
              ))}
            </ThemedView>
            {activeFile?.layerVisibility?.[2] !== false &&
              level2GridInfo &&
              level2GridInfo.cells.length > 0 && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]} pointerEvents="none">
                  {level2GridInfo.cells.map((cell, i) => {
                    if (zoomRegion && (
                      cell.minCol > zoomRegion.maxCol ||
                      cell.maxCol < zoomRegion.minCol ||
                      cell.minRow > zoomRegion.maxRow ||
                      cell.maxRow < zoomRegion.minRow
                    ))
                      return null;
                    const tile = level2TilesForDisplay[i];
                    if (!tile || tile.imageIndex < 0) return null;
                    const resolvedByName =
                      tile.name && resolveSourceForName
                        ? resolveSourceForName(tile.name)
                        : null;
                    const resolvedByUgc =
                      tile.name?.includes(':') && buildUserTileSourceFromName
                        ? buildUserTileSourceFromName(tile.name)
                        : null;
                    const resolvedByIndex =
                      tile.imageIndex >= 0
                        ? renderTileSources[tile.imageIndex] ?? null
                        : null;
                    const resolved =
                      tile.name != null && tile.name !== ''
                        ? resolvedByName ?? resolvedByUgc ?? null
                        : resolvedByIndex;
                    const tileName =
                      tile.name ?? resolvedByIndex?.name ?? '';
                    const source = resolved?.source ?? null;
                    if (!source) return null;
                    const stride = zoomRegion
                      ? effectiveTileSize + GRID_GAP
                      : level1DisplayLayout.tileSize + GRID_GAP;
                    const left = zoomRegion
                      ? (cell.minCol - zoomRegion.minCol) * stride
                      : cell.minCol * stride;
                    const top = zoomRegion
                      ? (cell.minRow - zoomRegion.minRow) * stride
                      : cell.minRow * stride;
                    const tileSizeForCell = zoomRegion ? effectiveTileSize : level1DisplayLayout.tileSize;
                    const w =
                      (cell.maxCol - cell.minCol + 1) * tileSizeForCell +
                      (cell.maxCol - cell.minCol) * GRID_GAP;
                    const h =
                      (cell.maxRow - cell.minRow + 1) * tileSizeForCell +
                      (cell.maxRow - cell.minRow) * GRID_GAP;
                    return (
                      <View
                        key={`l2-web-${i}`}
                        style={{
                          position: 'absolute',
                          left,
                          top,
                          width: w,
                          height: h,
                          overflow: 'hidden',
                        }}
                      >
                        <TileAtlasSprite
                          atlas={level2Atlas}
                          source={source}
                          name={tileName}
                          strokeColor={isLayerEmphasized(activeFile, 2) ? getEmphasizeStrokeColor(2) : activeLineColor}
                          strokeWidth={level2StrokeWidth}
                          style={[
                            styles.tileImage,
                            {
                              width: '100%',
                              height: '100%',
                              transform: [
                                { scaleX: tile.mirrorX ? -1 : 1 },
                                { scaleY: tile.mirrorY ? -1 : 1 },
                                { rotate: `${tile.rotation}deg` },
                              ],
                            },
                          ]}
                          displaySize={w}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            {activeFile?.layerVisibility?.[3] !== false &&
              level3GridInfo &&
              level3GridInfo.cells.length > 0 && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]} pointerEvents="none">
                  {level3GridInfo.cells.map((cell, i) => {
                    if (zoomRegion && (
                      cell.minCol > zoomRegion.maxCol ||
                      cell.maxCol < zoomRegion.minCol ||
                      cell.minRow > zoomRegion.maxRow ||
                      cell.maxRow < zoomRegion.minRow
                    ))
                      return null;
                    const tile = level3TilesForDisplay[i];
                    if (!tile || tile.imageIndex < 0) return null;
                    const resolvedByName =
                      tile.name && resolveSourceForName
                        ? resolveSourceForName(tile.name)
                        : null;
                    const resolvedByUgc =
                      tile.name?.includes(':') && buildUserTileSourceFromName
                        ? buildUserTileSourceFromName(tile.name)
                        : null;
                    const resolvedByIndex =
                      tile.imageIndex >= 0
                        ? renderTileSources[tile.imageIndex] ?? null
                        : null;
                    const resolved =
                      tile.name != null && tile.name !== ''
                        ? resolvedByName ?? resolvedByUgc ?? null
                        : resolvedByIndex;
                    const tileName =
                      tile.name ?? resolvedByIndex?.name ?? '';
                    const source = resolved?.source ?? null;
                    if (!source) return null;
                    const stride = zoomRegion
                      ? effectiveTileSize + GRID_GAP
                      : level1DisplayLayout.tileSize + GRID_GAP;
                    const left = zoomRegion
                      ? (cell.minCol - zoomRegion.minCol) * stride
                      : cell.minCol * stride;
                    const top = zoomRegion
                      ? (cell.minRow - zoomRegion.minRow) * stride
                      : cell.minRow * stride;
                    const tileSizeForCell = zoomRegion ? effectiveTileSize : level1DisplayLayout.tileSize;
                    const w =
                      (cell.maxCol - cell.minCol + 1) * tileSizeForCell +
                      (cell.maxCol - cell.minCol) * GRID_GAP;
                    const h =
                      (cell.maxRow - cell.minRow + 1) * tileSizeForCell +
                      (cell.maxRow - cell.minRow) * GRID_GAP;
                    return (
                      <View
                        key={`l3-web-${i}`}
                        style={{
                          position: 'absolute',
                          left,
                          top,
                          width: w,
                          height: h,
                          overflow: 'hidden',
                        }}
                      >
                        <TileAtlasSprite
                          atlas={level3Atlas}
                          source={source}
                          name={tileName}
                          strokeColor={isLayerEmphasized(activeFile, 3) ? getEmphasizeStrokeColor(3) : activeLineColor}
                          strokeWidth={level3StrokeWidth}
                          style={[
                            styles.tileImage,
                            {
                              width: '100%',
                              height: '100%',
                              transform: [
                                { scaleX: tile.mirrorX ? -1 : 1 },
                                { scaleY: tile.mirrorY ? -1 : 1 },
                                { rotate: `${tile.rotation}deg` },
                              ],
                            },
                          ]}
                          displaySize={w}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : (
            <>
            <ViewShot
              ref={setGridNode}
              style={[
                styles.grid,
                {
                  opacity: gridVisible || isCapturingPreview ? 1 : 0,
                  width: actualGridWidth,
                  height: actualGridHeight,
                },
              ]}
              pointerEvents="none"
            >
              {useSkiaGrid ? (
                <TileGridCanvas
                  width={actualGridWidth}
                  height={actualGridHeight}
                  tileSize={effectiveTileSize}
                  rows={effectiveRows}
                  columns={effectiveCols}
                  tiles={effectiveTiles}
                  tileSources={renderTileSources}
                  errorSource={ERROR_TILE}
                  strokeColor={isLayerEmphasized(activeFile, 1) ? getEmphasizeStrokeColor(1) : activeLineColor}
                  strokeWidth={activeLineWidth}
                  strokeScaleByName={strokeScaleByName}
                  showDebug={settings.showDebug}
                  showOverlays={showOverlays}
                  cloneSourceIndex={editingLevel === 1 && brush.mode === 'clone' ? cloneSourceIndex : null}
                  cloneSampleIndex={editingLevel === 1 && brush.mode === 'clone' ? cloneSampleIndex : null}
                  cloneAnchorIndex={editingLevel === 1 && brush.mode === 'clone' ? cloneAnchorIndex : null}
                  cloneCursorIndex={editingLevel === 1 && brush.mode === 'clone' ? cloneCursorIndex : null}
                  lockedCellIndices={lockedCellIndicesArray}
                  lockedBoundaryEdges={lockedBoundaryEdges}
                  onPaintReady={
                    Platform.OS !== 'web'
                      ? () => setNativeCanvasPaintReady(true)
                      : undefined
                  }
                />
              ) : (
                effectiveRowIndices.map((rowIndex) => (
                  <ThemedView key={`row-${rowIndex}`} style={styles.row}>
                    {effectiveColumnIndices.map((columnIndex) => {
                      const cellIndex = rowIndex * effectiveCols + columnIndex;
                      const item = effectiveTiles[cellIndex];
                      const safeTile =
                        item ?? {
                          imageIndex: -1,
                          rotation: 0,
                          mirrorX: false,
                          mirrorY: false,
                        };
                      return (
                        <TileCell
                          key={`cell-${cellIndex}`}
                          cellIndex={cellIndex}
                          tileSize={effectiveTileSize}
                          tile={safeTile}
                          tileSources={renderTileSources}
                          showDebug={settings.showDebug}
                          strokeColor={isLayerEmphasized(activeFile, 1) ? getEmphasizeStrokeColor(1) : activeLineColor}
                          strokeWidth={activeLineWidth}
                          strokeScaleByName={strokeScaleByName}
                          atlas={gridAtlas}
                          resolveSourceForName={resolveSourceForName}
                          resolveUgcSourceFromName={buildUserTileSourceFromName}
                          showOverlays={showOverlays}
                          isCloneSource={
                            editingLevel === 1 && brush.mode === 'clone' && cloneSourceIndex === cellIndex
                          }
                          isCloneSample={
                            editingLevel === 1 && brush.mode === 'clone' && cloneSampleIndex === cellIndex
                          }
                          isCloneTargetOrigin={
                            editingLevel === 1 && brush.mode === 'clone' && cloneAnchorIndex === cellIndex
                          }
                          isCloneCursor={
                            editingLevel === 1 && brush.mode === 'clone' && cloneCursorIndex === cellIndex
                          }
                          isLocked={lockedCellIndicesSet?.has(getFullIndexForCanvas(cellIndex))}
                        />
                      );
                    })}
                  </ThemedView>
                ))
              )}
            </ViewShot>
              {activeFile?.layerVisibility?.[2] !== false &&
                level2GridInfo &&
                level2GridInfo.cells.length > 0 && (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]} pointerEvents="none">
                    {level2GridInfo.cells.map((cell, i) => {
                      if (zoomRegion && (
                        cell.minCol > zoomRegion.maxCol ||
                        cell.maxCol < zoomRegion.minCol ||
                        cell.minRow > zoomRegion.maxRow ||
                        cell.maxRow < zoomRegion.minRow
                      ))
                        return null;
                      const tile = level2TilesForDisplay[i];
                      if (!tile || tile.imageIndex < 0) return null;
                      const resolvedByName =
                        tile.name && resolveSourceForName
                          ? resolveSourceForName(tile.name)
                          : null;
                      const resolvedByUgc =
                        tile.name?.includes(':') && buildUserTileSourceFromName
                          ? buildUserTileSourceFromName(tile.name)
                          : null;
                      const resolvedByIndex =
                        tile.imageIndex >= 0
                          ? renderTileSources[tile.imageIndex] ?? null
                          : null;
                      const resolved =
                        tile.name != null && tile.name !== ''
                          ? resolvedByName ?? resolvedByUgc ?? null
                          : resolvedByIndex;
                      const tileName =
                        tile.name ?? resolvedByIndex?.name ?? '';
                      const source = resolved?.source ?? null;
                      if (!source) return null;
                      const stride = zoomRegion
                        ? effectiveTileSize + GRID_GAP
                        : level1DisplayLayout.tileSize + GRID_GAP;
                      const left = zoomRegion
                        ? (cell.minCol - zoomRegion.minCol) * stride
                        : cell.minCol * stride;
                      const top = zoomRegion
                        ? (cell.minRow - zoomRegion.minRow) * stride
                        : cell.minRow * stride;
                      const tileSizeForCell = zoomRegion ? effectiveTileSize : level1DisplayLayout.tileSize;
                      const w =
                        (cell.maxCol - cell.minCol + 1) * tileSizeForCell +
                        (cell.maxCol - cell.minCol) * GRID_GAP;
                      const h =
                        (cell.maxRow - cell.minRow + 1) * tileSizeForCell +
                        (cell.maxRow - cell.minRow) * GRID_GAP;
                      return (
                        <View
                          key={`l2-${i}`}
                          style={{
                            position: 'absolute',
                            left,
                            top,
                            width: w,
                            height: h,
                            overflow: 'hidden',
                          }}
                        >
                          <TileAtlasSprite
                            atlas={level2Atlas}
                            source={source}
                            name={tileName}
                            strokeColor={isLayerEmphasized(activeFile, 2) ? getEmphasizeStrokeColor(2) : activeLineColor}
                            strokeWidth={level2StrokeWidth}
                            style={[
                              styles.tileImage,
                              {
                                width: '100%',
                                height: '100%',
                                transform: [
                                  { scaleX: tile.mirrorX ? -1 : 1 },
                                  { scaleY: tile.mirrorY ? -1 : 1 },
                                  { rotate: `${tile.rotation}deg` },
                                ],
                              },
                            ]}
                            displaySize={w}
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              {activeFile?.layerVisibility?.[3] !== false &&
                level3GridInfo &&
                level3GridInfo.cells.length > 0 && (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]} pointerEvents="none">
                    {level3GridInfo.cells.map((cell, i) => {
                      if (zoomRegion && (
                        cell.minCol > zoomRegion.maxCol ||
                        cell.maxCol < zoomRegion.minCol ||
                        cell.minRow > zoomRegion.maxRow ||
                        cell.maxRow < zoomRegion.minRow
                      ))
                        return null;
                      const tile = level3TilesForDisplay[i];
                      if (!tile || tile.imageIndex < 0) return null;
                      const resolvedByName =
                        tile.name && resolveSourceForName
                          ? resolveSourceForName(tile.name)
                          : null;
                      const resolvedByUgc =
                        tile.name?.includes(':') && buildUserTileSourceFromName
                          ? buildUserTileSourceFromName(tile.name)
                          : null;
                      const resolvedByIndex =
                        tile.imageIndex >= 0
                          ? renderTileSources[tile.imageIndex] ?? null
                          : null;
                      const resolved =
                        tile.name != null && tile.name !== ''
                          ? resolvedByName ?? resolvedByUgc ?? null
                          : resolvedByIndex;
                      const tileName =
                        tile.name ?? resolvedByIndex?.name ?? '';
                      const source = resolved?.source ?? null;
                      if (!source) return null;
                      const stride = zoomRegion
                        ? effectiveTileSize + GRID_GAP
                        : level1DisplayLayout.tileSize + GRID_GAP;
                      const left = zoomRegion
                        ? (cell.minCol - zoomRegion.minCol) * stride
                        : cell.minCol * stride;
                      const top = zoomRegion
                        ? (cell.minRow - zoomRegion.minRow) * stride
                        : cell.minRow * stride;
                      const tileSizeForCell = zoomRegion ? effectiveTileSize : level1DisplayLayout.tileSize;
                      const w =
                        (cell.maxCol - cell.minCol + 1) * tileSizeForCell +
                        (cell.maxCol - cell.minCol) * GRID_GAP;
                      const h =
                        (cell.maxRow - cell.minRow + 1) * tileSizeForCell +
                        (cell.maxRow - cell.minRow) * GRID_GAP;
                      return (
                        <View
                          key={`l3-${i}`}
                          style={{
                            position: 'absolute',
                            left,
                            top,
                            width: w,
                            height: h,
                            overflow: 'hidden',
                          }}
                        >
                          <TileAtlasSprite
                            atlas={level3Atlas}
                            source={source}
                            name={tileName}
                            strokeColor={isLayerEmphasized(activeFile, 3) ? getEmphasizeStrokeColor(3) : activeLineColor}
                            strokeWidth={level3StrokeWidth}
                            style={[
                              styles.tileImage,
                              {
                                width: '100%',
                                height: '100%',
                                transform: [
                                  { scaleX: tile.mirrorX ? -1 : 1 },
                                  { scaleY: tile.mirrorY ? -1 : 1 },
                                  { rotate: `${tile.rotation}deg` },
                                ],
                              },
                            ]}
                            displaySize={w}
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
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
                    if (isMoveMode && canvasSelection && selectionBoundsFullGrid) {
                      moveDragStartRef.current = { x: point.x, y: point.y };
                      setMoveDragOffset({ dRow: 0, dCol: 0 });
                      return;
                    }
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (isSelectionMode) {
                      const b = getLevel1BoundsForCanvasCell(cellIndex);
                      setCanvasSelection({ start: b.minIdx, end: b.maxIdx });
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
                    if (isMoveMode && moveDragStartRef.current && selectionBoundsFullGrid) {
                      const tileStride = gridLayout.tileSize + GRID_GAP;
                      const fullCols = fullGridColumnsForMapping;
                      let dCol = Math.round((point.x - moveDragStartRef.current.x) / (tileStride || 1));
                      let dRow = Math.round((point.y - moveDragStartRef.current.y) / (tileStride || 1));
                      const clampBounds = isEditingHigherLayer && selectionBoundsLayerGrid ? selectionBoundsLayerGrid : selectionBoundsFullGrid;
                      const clampRows = isEditingHigherLayer && levelGridInfo ? levelGridInfo.levelRows : fullGridRows;
                      const clampCols = isEditingHigherLayer && levelGridInfo ? levelGridInfo.levelCols : fullCols;
                      const { minRow, maxRow, minCol, maxCol } = clampBounds;
                      dRow = Math.max(-minRow, Math.min(clampRows - 1 - maxRow, dRow));
                      dCol = Math.max(-minCol, Math.min(clampCols - 1 - maxCol, dCol));
                      setMoveDragOffset({ dRow, dCol });
                      return;
                    }
                    if (isSelectionMode) {
                      const cellIndex = getCellIndexForPoint(point.x, point.y);
                      if (cellIndex !== null) {
                        const b = getLevel1BoundsForCanvasCell(cellIndex);
                        setCanvasSelection((prev) =>
                          prev
                            ? {
                                start: Math.min(prev.start, b.minIdx),
                                end: Math.max(prev.end, b.maxIdx),
                              }
                            : prev
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
                  if (isMoveMode) {
                    if (moveDragOffset && (moveDragOffset.dRow !== 0 || moveDragOffset.dCol !== 0)) {
                      setPendingMoveOffset(moveDragOffset);
                      setShowMoveConfirmDialog(true);
                    }
                    setMoveDragOffset(null);
                    moveDragStartRef.current = null;
                    setInteracting(false);
                    return;
                  }
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
          </View>
          {viewMode === 'modify' && maxDisplayLevel > 0 && canvasAreaWidth > 0 && (
            <LayerSidePanel
              maxDisplayLevel={maxDisplayLevel}
              displayResolutionLevel={displayResolutionLevel}
              activeFile={activeFile}
              containerWidth={canvasAreaWidth}
              containerHeight={canvasAreaHeight}
              gridWidth={actualGridWidth}
              zoomRegion={zoomRegion}
              onSelectLayer={(internalLevel) =>
                setSettings((prev) => ({ ...prev, gridResolutionLevel: internalLevel }))
              }
              onToggleVisibility={updateActiveFileLayerVisibility}
              onToggleLocked={updateActiveFileLayerLocked}
              onToggleEmphasized={updateActiveFileLayerEmphasized}
            />
          )}
          {showZoomOutMirrorConfirm && zoomRegion && (
            <>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setShowZoomOutMirrorConfirm(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              />
              <View style={styles.moveConfirmPanelWrap} pointerEvents="box-none">
                <ThemedView style={styles.moveConfirmPanel}>
                  <ThemedText type="defaultSemiBold" style={styles.moveConfirmTitle}>
                    Mirror changes?
                  </ThemedText>
                  <View style={styles.moveConfirmButtons}>
                    <Pressable
                      onPress={() => {
                        setShowZoomOutMirrorConfirm(false);
                        setZoomRegion(null);
                      }}
                      style={styles.moveConfirmButton}
                      accessibilityRole="button"
                      accessibilityLabel="Don't mirror"
                    >
                      <ThemedText type="defaultSemiBold">Don't mirror</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        mirrorZoomRegionToRestOfGrid();
                        setShowZoomOutMirrorConfirm(false);
                        setZoomRegion(null);
                      }}
                      style={[styles.moveConfirmButton, styles.moveConfirmButtonPrimary]}
                      accessibilityRole="button"
                      accessibilityLabel="Mirror"
                    >
                      <ThemedText type="defaultSemiBold" style={styles.moveConfirmButtonPrimaryText}>
                        Mirror
                      </ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
              </View>
            </>
          )}
          {showMoveConfirmDialog && pendingMoveOffset && canvasSelection && selectionBoundsFullGrid && (
            <>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  setShowMoveConfirmDialog(false);
                  setPendingMoveOffset(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel move"
              />
              <View style={styles.moveConfirmPanelWrap} pointerEvents="box-none">
                <ThemedView style={styles.moveConfirmPanel}>
                  <ThemedText type="defaultSemiBold" style={styles.moveConfirmTitle}>
                    Move tiles?
                  </ThemedText>
                  <View style={styles.moveConfirmButtons}>
                    <Pressable
                      onPress={() => {
                        setShowMoveConfirmDialog(false);
                        setPendingMoveOffset(null);
                      }}
                      style={styles.moveConfirmButton}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                    >
                      <ThemedText type="defaultSemiBold">Cancel</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (isEditingHigherLayer && levelGridInfo && selectionBoundsLayerGrid) {
                          // Higher layer (L2/L3): indices are layer-cell indices, not L1 indices.
                          const layerCols = levelGridInfo.levelCols;
                          const { minRow: lyrMinRow, maxRow: lyrMaxRow, minCol: lyrMinCol, maxCol: lyrMaxCol } = selectionBoundsLayerGrid;
                          const layerFromIndices: number[] = [];
                          for (let r = lyrMinRow; r <= lyrMaxRow; r += 1) {
                            for (let c = lyrMinCol; c <= lyrMaxCol; c += 1) {
                              layerFromIndices.push(r * layerCols + c);
                            }
                          }
                          const layerToIndices = layerFromIndices.map((i) => {
                            const r = Math.floor(i / layerCols);
                            const c = i % layerCols;
                            return (r + pendingMoveOffset.dRow) * layerCols + (c + pendingMoveOffset.dCol);
                          });
                          moveRegion(layerFromIndices, layerToIndices);
                          // Also move tiles on every higher-resolution layer (internal levels
                          // 1..editingLevel-1) whose L1 footprint is fully inside the selection.
                          const fullCols = activeFile!.grid.columns;
                          const fullRows = activeFile!.grid.rows;
                          const cellTilesN = Math.pow(2, editingLevel - 1);
                          const dRowL1 = pendingMoveOffset.dRow * cellTilesN;
                          const dColL1 = pendingMoveOffset.dCol * cellTilesN;
                          const { minRow: selMinRow, maxRow: selMaxRow, minCol: selMinCol, maxCol: selMaxCol } = selectionBoundsFullGrid;
                          const emptyTile = { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false };
                          // Level 1 (file.tiles)
                          if (fullCols > 0 && fullRows > 0) {
                            const l1Count = fullCols * fullRows;
                            const l1Src = normalizeTiles(activeFile!.tiles, l1Count, tileSources.length);
                            const l1Pairs: Array<{ fromIdx: number; tile: Tile }> = [];
                            for (let r = selMinRow; r <= selMaxRow; r += 1) {
                              for (let c = selMinCol; c <= selMaxCol; c += 1) {
                                const fromIdx = r * fullCols + c;
                                l1Pairs.push({ fromIdx, tile: l1Src[fromIdx] ?? { ...emptyTile } });
                              }
                            }
                            if (l1Pairs.length > 0) {
                              const nextL1 = [...l1Src];
                              l1Pairs.forEach(({ fromIdx }) => { nextL1[fromIdx] = { ...emptyTile }; });
                              l1Pairs.forEach(({ fromIdx, tile }) => {
                                const r = Math.floor(fromIdx / fullCols);
                                const c = fromIdx % fullCols;
                                const toR = r + dRowL1;
                                const toC = c + dColL1;
                                if (toR >= 0 && toR < fullRows && toC >= 0 && toC < fullCols) {
                                  nextL1[toR * fullCols + toC] = tile;
                                }
                              });
                              updateActiveFileTilesL1(nextL1);
                            }
                          }
                          // Intermediate layers (internal levels 2..editingLevel-1)
                          for (let M = 2; M < editingLevel; M += 1) {
                            const levelMInfo = getLevelGridInfo(fullCols, fullRows, M);
                            if (!levelMInfo) continue;
                            const mCols = levelMInfo.levelCols;
                            const mCount = levelMInfo.cells.length;
                            const mSrc = normalizeTiles(activeFile?.layers?.[M] ?? [], mCount, tileSources.length);
                            const dRowM = pendingMoveOffset.dRow * Math.pow(2, editingLevel - M);
                            const dColM = pendingMoveOffset.dCol * Math.pow(2, editingLevel - M);
                            const mPairs: Array<{ fromIdx: number; tile: Tile }> = [];
                            levelMInfo.cells.forEach((cell, idx) => {
                              if (
                                cell.minRow >= selMinRow && cell.maxRow <= selMaxRow &&
                                cell.minCol >= selMinCol && cell.maxCol <= selMaxCol
                              ) {
                                mPairs.push({ fromIdx: idx, tile: mSrc[idx] ?? { ...emptyTile } });
                              }
                            });
                            if (mPairs.length === 0) continue;
                            const nextM = [...mSrc];
                            mPairs.forEach(({ fromIdx }) => { nextM[fromIdx] = { ...emptyTile }; });
                            mPairs.forEach(({ fromIdx, tile }) => {
                              const r = Math.floor(fromIdx / mCols);
                              const c = fromIdx % mCols;
                              const toR = r + dRowM;
                              const toC = c + dColM;
                              if (toR >= 0 && toR < levelMInfo.levelRows && toC >= 0 && toC < mCols) {
                                nextM[toR * mCols + toC] = tile;
                              }
                            });
                            updateActiveFileLayer(M, nextM);
                          }
                          // Update selection in L1 coordinates (each layer cell spans cellTiles L1 cells).
                          const cellTiles = Math.pow(2, editingLevel - 1);
                          const { minRow, maxRow, minCol, maxCol } = selectionBoundsFullGrid;
                          const newMinRow = minRow + pendingMoveOffset.dRow * cellTiles;
                          const newMinCol = minCol + pendingMoveOffset.dCol * cellTiles;
                          const newMaxRow = maxRow + pendingMoveOffset.dRow * cellTiles;
                          const newMaxCol = maxCol + pendingMoveOffset.dCol * cellTiles;
                          const newStart = newMinRow * fullGridColumnsForMapping + newMinCol;
                          const newEnd = newMaxRow * fullGridColumnsForMapping + newMaxCol;
                          setCanvasSelection({ start: newStart, end: newEnd });
                        } else {
                          const cols = fullGridColumnsForMapping;
                          const fromIndices = getCellIndicesInRegion(
                            canvasSelection.start,
                            canvasSelection.end,
                            cols
                          );
                          const toIndices = fromIndices.map((i) => {
                            const r = Math.floor(i / cols);
                            const c = i % cols;
                            return (r + pendingMoveOffset.dRow) * cols + (c + pendingMoveOffset.dCol);
                          });
                          moveRegion(fromIndices, toIndices);
                          const { minRow, maxRow, minCol, maxCol } = selectionBoundsFullGrid;
                          const newMinRow = minRow + pendingMoveOffset.dRow;
                          const newMinCol = minCol + pendingMoveOffset.dCol;
                          const newMaxRow = maxRow + pendingMoveOffset.dRow;
                          const newMaxCol = maxCol + pendingMoveOffset.dCol;
                          const newStart = newMinRow * cols + newMinCol;
                          const newEnd = newMaxRow * cols + newMaxCol;
                          setCanvasSelection({ start: newStart, end: newEnd });
                        }
                        setShowMoveConfirmDialog(false);
                        setPendingMoveOffset(null);
                      }}
                      style={[styles.moveConfirmButton, styles.moveConfirmButtonPrimary]}
                      accessibilityRole="button"
                      accessibilityLabel="Move"
                    >
                      <ThemedText type="defaultSemiBold" style={styles.moveConfirmButtonPrimaryText}>
                        Move
                      </ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
              </View>
            </>
          )}
          {showStampConfirmDialog && pendingStampCell && pendingStampPatternId && (
            <>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => {
                  setShowStampConfirmDialog(false);
                  setPendingStampCell(null);
                  setPendingStampPatternId(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel stamp"
              />
              <View style={styles.moveConfirmPanelWrap} pointerEvents="box-none">
                <ThemedView style={styles.moveConfirmPanel}>
                  <ThemedText type="defaultSemiBold" style={styles.moveConfirmTitle}>
                    Place Stamp?
                  </ThemedText>
                  <View style={styles.moveConfirmButtons}>
                    <Pressable
                      onPress={() => {
                        setShowStampConfirmDialog(false);
                        setPendingStampCell(null);
                        setPendingStampPatternId(null);
                      }}
                      style={styles.moveConfirmButton}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                    >
                      <ThemedText type="defaultSemiBold">Cancel</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const p = patterns.find((x) => x.id === pendingStampPatternId);
                        const { rotation, mirrorX } = stampDragTransformRef.current;
                        if (p && pendingStampCell) {
                          // pendingStampCell is always in L1 (finest, internal level 1) coordinates.
                          const { row: anchorRow_L1, col: anchorCol_L1 } = pendingStampCell;
                          const mainLevel = p.createdAtLevel ?? 1;
                          const gridCols = activeFile?.grid.columns ?? 0;
                          const gridRows = activeFile?.grid.rows ?? 0;
                          if (mainLevel === 1) {
                            // L1 pattern: hook's placeStamp handles undo + live state update.
                            placeStamp(anchorRow_L1, anchorCol_L1, p.tiles, p.width, p.height, rotation, mirrorX);
                          } else if (mainLevel === editingLevel) {
                            // Coarser pattern at same level as editing: convert L1 anchor to editingLevel
                            // units and use hook's placeStamp for undo + live state update.
                            const offsets = getLevelNtoMOffsets(gridCols, gridRows, mainLevel, 1);
                            const aRow = offsets ? Math.floor((anchorRow_L1 - offsets.C_row) / offsets.scale) : anchorRow_L1;
                            const aCol = offsets ? Math.floor((anchorCol_L1 - offsets.C_col) / offsets.scale) : anchorCol_L1;
                            placeStamp(aRow, aCol, p.tiles, p.width, p.height, rotation, mirrorX);
                          } else {
                            // Different level: write directly to file state (L1 anchor).
                            applyStampToFileLevel(mainLevel, anchorRow_L1, anchorCol_L1, p.tiles, p.width, p.height, rotation, mirrorX);
                          }
                          // Apply any sub-layer (finer) tiles stored in the pattern (L1 anchor).
                          if (p.layerTiles) {
                            for (const [levelStr, layerData] of Object.entries(p.layerTiles)) {
                              const M = parseInt(levelStr, 10);
                              applyStampToFileLevel(M, anchorRow_L1, anchorCol_L1, layerData.tiles, layerData.width, layerData.height, rotation, mirrorX);
                            }
                          }
                        }
                        setShowStampConfirmDialog(false);
                        setPendingStampCell(null);
                        setPendingStampPatternId(null);
                      }}
                      style={[styles.moveConfirmButton, styles.moveConfirmButtonPrimary]}
                      accessibilityRole="button"
                      accessibilityLabel="Place"
                    >
                      <ThemedText type="defaultSemiBold" style={styles.moveConfirmButtonPrimaryText}>
                        Place
                      </ThemedText>
                    </Pressable>
                  </View>
                </ThemedView>
              </View>
            </>
          )}
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
                            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
                            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
                            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
                            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
        <ModifyPalette
          tileSources={paletteSources}
          selected={selectedPaletteBrush}
          strokeColor={activeLineColor}
          strokeWidth={activeLineWidth}
          strokeScaleByName={strokeScaleByName}
          atlas={brushAtlas}
          height={brushPanelHeight}
          itemSize={brushItemSize}
          rowGap={BRUSH_PANEL_ROW_GAP}
          rows={brushRows}
          activePatterns={activePatterns}
          createPattern={createPattern}
          deletePatterns={deletePatterns}
          resolvePatternTile={resolvePatternTile}
          resolveTileForPatternList={(tile, tileSetIds) =>
            resolveTileAssetForFile(
              tile,
              tileSources,
              tileSetIds && tileSetIds.length > 0
                ? tileSetIds
                : activeFileTileSetIds
            )
          }
          onCreatePatternPress={(closeChooser) => {
            setBrush({ mode: 'pattern' });
            setIsPatternCreationMode(true);
            setPatternSelection(null);
            closeChooser();
          }}
          hidePatternChooserWhen={isPatternCreationMode}
          showImportInChooser
          onImportPatternPress={handleImportPatternPress}
          showExportInChooser
          onExportPatternPress={(ids) => {
            setSelectedPatternIdsForExport(ids);
            setShowPatternExportMenu(true);
          }}
          dismissModifyBanner={dismissModifyBanner}
          selectedPatternId={selectedPatternId}
          patternRotations={patternRotations}
          patternMirrors={patternMirrors}
          onSelectedPatternIdChange={setSelectedPatternId}
          onPatternRotationsChange={setPatternRotations}
          onPatternMirrorsChange={setPatternMirrors}
          onSelect={(next) => {
            dismissModifyBanner();
            if (next.mode === 'clone') {
              clearCloneSource();
            }
            if (next.mode === 'pattern') {
              setIsPatternCreationMode(false);
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
          onSetOrientation={(index, orientation) => {
            dismissModifyBanner();
            setPaletteRotations((prev) => ({ ...prev, [index]: orientation.rotation }));
            setPaletteMirrors((prev) => ({ ...prev, [index]: orientation.mirrorX }));
            setPaletteMirrorsY((prev) => ({ ...prev, [index]: orientation.mirrorY }));
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
                rotation: orientation.rotation,
                mirrorX: orientation.mirrorX,
                mirrorY: orientation.mirrorY,
              });
            }
          }}
          onPatternPress={() => {
            dismissModifyBanner();
            if (brush.mode !== 'pattern') setBrush({ mode: 'pattern' });
            setIsPatternCreationMode(false);
          }}
          onPatternLongPress={() => {
            dismissModifyBanner();
            if (brush.mode !== 'pattern') setBrush({ mode: 'pattern' });
            setIsPatternCreationMode(false);
          }}
          onPatternDoubleTap={() => {
            dismissModifyBanner();
            if (brush.mode !== 'pattern') setBrush({ mode: 'pattern' });
            setIsPatternCreationMode(false);
          }}
          onRandomLongPress={() => {
            dismissModifyBanner();
            setShowTileSetChooser(true);
          }}
          onRandomDoubleTap={() => {
            dismissModifyBanner();
            setShowTileSetChooser(true);
          }}
          onPatternStampDragStart={handlePatternStampDragStart}
          onPatternStampDragMove={handlePatternStampDragMove}
          onPatternStampDragEnd={handlePatternStampDragEnd}
          onPatternStampDragCancel={handlePatternStampDragCancel}
        />
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
                <View style={styles.patternSavePreview}>
                  <PatternThumbnail
                    pattern={pendingPatternPreview.pattern}
                    rotationCW={0}
                    mirrorX={false}
                    tileSize={pendingPatternPreview.tileSize}
                    resolveTile={(t) =>
                      resolveTileAssetForFile(t, tileSources, activeFileTileSetIds)
                    }
                    strokeColor={activeLineColor}
                    strokeWidth={activeLineWidth}
                    strokeScaleByName={strokeScaleByName}
                  />
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
                <ThemedText type="defaultSemiBold">Developer mode</ThemedText>
                <Switch
                  value={settings.developerMode}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, developerMode: value }))
                  }
                  accessibilityLabel="Toggle developer mode"
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
              <ThemedView style={styles.settingsPlatformFooter}>
                <ThemedText style={styles.settingsPlatformLabel}>{platformLabel}</ThemedText>
              </ThemedView>
            </ScrollView>
          </ThemedView>
        )}
        {showDebugModal && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowDebugModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Close debug"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedView style={styles.settingsHeader}>
                <ThemedText type="title">Debug</ThemedText>
                <Pressable
                  onPress={() => setShowDebugModal(false)}
                  style={styles.settingsClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close debug"
                >
                  <ThemedText type="defaultSemiBold">X</ThemedText>
                </Pressable>
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
              <ThemedView style={styles.debugResolutionRow}>
                <ThemedText style={styles.debugResolutionText}>
                  Resolution: {gridLayout.rows} × {gridLayout.columns} tiles
                </ThemedText>
              </ThemedView>
            </ThemedView>
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
              <ThemedView style={styles.toggleRow}>
                <ThemedText type="defaultSemiBold">Cross-Layer Connectivity</ThemedText>
                <Switch
                  value={settings.crossLayerConnectivity}
                  onValueChange={(value) =>
                    setSettings((prev) => ({ ...prev, crossLayerConnectivity: value }))
                  }
                  accessibilityLabel="Toggle cross-layer connectivity"
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
                            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
                            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
                            tiles: editingLevel === 1 ? fullTilesForSave : (Array.isArray(activeFile?.tiles) ? activeFile.tiles : []),
                            gridLayout: editingLevel === 1 ? fullGridLayoutForSave : (level1LayoutForPersist ?? fullGridLayoutForSave),
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
  toolbarBannersOverlay: {
    position: 'absolute',
    top: HEADER_HEIGHT,
    left: 0,
    right: 0,
    zIndex: 9,
  },
  toolbarBannerRow: {
    width: '100%',
    height: UNDO_REDO_BANNER_HEIGHT,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbarBannerBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
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
  debugResolutionRow: {
    paddingVertical: 12,
  },
  debugResolutionText: {
    color: '#9ca3af',
    fontSize: 14,
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
    paddingTop: FILE_GRID_GAP + 8,
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
  newFileEmptyThumb: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  newFileEmptyIconCenter: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  newFileEmptyLabel: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
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
  patternNewCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternNewThumb: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
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
  patternPropertiesModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  patternPropertiesModalPanel: {
    alignSelf: 'center',
    maxWidth: 300,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  patternPropertiesModalScroll: {
    maxHeight: 380,
  },
  patternPropertiesModalScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  patternPropertiesModalTitle: {
    color: '#111',
  },
  patternPropertiesModalSection: {
    gap: 10,
  },
  patternPropertiesSectionLabel: {
    color: '#111',
    marginBottom: 6,
  },
  patternPropertiesColorOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  patternPropertiesColorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  patternPropertiesUnfavoriteSwatch: {
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternPropertiesColorSwatchSelected: {
    borderColor: '#111',
    borderWidth: 2,
  },
  patternPropertiesOrientationGrid: {
    gap: 6,
  },
  patternPropertiesOrientationRow: {
    flexDirection: 'row',
    gap: 6,
  },
  patternPropertiesOrientationThumb: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  patternPropertiesOrientationThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  patternPropertiesOrientationThumbWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternPropertiesModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  patternPropertiesModalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    alignItems: 'center',
  },
  patternPropertiesModalButtonGhost: {
    backgroundColor: '#fff',
  },
  patternPropertiesModalButtonPrimary: {
    backgroundColor: '#111',
  },
  patternPropertiesModalButtonText: {
    color: '#fff',
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
  moveConfirmPanelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moveConfirmPanel: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 8,
    padding: 20,
    gap: 16,
    minWidth: 240,
  },
  moveConfirmTitle: {
    textAlign: 'center',
  },
  moveConfirmButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  moveConfirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  moveConfirmButtonPrimary: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  moveConfirmButtonPrimaryText: {
    color: '#fff',
  },
  contentFrame: {
    alignSelf: 'center',
    position: 'relative',
    backgroundColor: '#3F3F3F',
    flexDirection: 'column',
  },
  /** Canvas area between header and brush panel: takes remaining space and centers the grid vertically. */
  gridCanvasAreaCentered: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  gridCanvasAreaAlignCenter: {
    alignItems: 'center',
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
  canvasSelectionBoxDimmed: {
    opacity: 0.5,
  },
  movePreviewBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#3b82f6',
    borderStyle: 'dashed',
    zIndex: 4,
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
