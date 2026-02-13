import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
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
} from '@/assets/images/tiles/manifest';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TileAsset } from '@/components/tile-asset';
import { TileAtlasSprite } from '@/components/tile-atlas-sprite';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTileAtlas } from '@/hooks/use-tile-atlas';
import { useTileFiles } from '@/hooks/use-tile-files';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { useTilePatterns } from '@/hooks/use-tile-patterns';
import { useTileSets } from '@/hooks/use-tile-sets';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BRUSH_PANEL_ROW_GAP = 1;
/** Reserve space for horizontal scrollbar so the bottom row is not cut off on desktop web. */
const WEB_SCROLLBAR_HEIGHT = 17;
/** Min viewport width to treat as desktop web (scrollbar takes layout space). */
const DESKTOP_WEB_BREAKPOINT = 768;
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');

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
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={iconColor}
      />
    </Pressable>
  );
}

type TileCellProps = {
  cellIndex: number;
  tileSize: number;
  tile: Tile;
  tileSources: typeof TILE_MANIFEST[string];
  showDebug: boolean;
  strokeColor: string;
  strokeWidth: number;
  atlas?: ReturnType<typeof useTileAtlas> | null;
  isCloneSource: boolean;
  isCloneSample: boolean;
  isCloneTargetOrigin: boolean;
  isCloneCursor: boolean;
  showOverlays: boolean;
};

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    strokeColor,
    strokeWidth,
    atlas,
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
        style={[
          styles.tile,
          { width: tileSize, height: tileSize },
          showOverlays && isCloneSource && styles.cloneSource,
        ]}
      >
        {source && (
          <TileAtlasSprite
            atlas={atlas}
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
  }
);

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

type GridLinesOverlayProps = {
  rows: number;
  columns: number;
  tileSize: number;
  width: number;
  height: number;
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
    <View style={[styles.gridBackground, { width, height, backgroundColor }]} pointerEvents="none">
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

function GridLinesOverlay({
  rows,
  columns,
  tileSize,
  width,
  height,
  lineColor,
  lineWidth,
}: GridLinesOverlayProps) {
  if (rows <= 0 || columns <= 0 || tileSize <= 0) {
    return null;
  }
  const verticalLines = Array.from({ length: Math.max(0, columns - 1) }, (_, i) => i + 1);
  const horizontalLines = Array.from({ length: Math.max(0, rows - 1) }, (_, i) => i + 1);
  const strokeWidth = Math.max(1, lineWidth);
  return (
    <View pointerEvents="none" style={styles.gridLinesOverlay}>
      {verticalLines.map((col) => (
        <View
          key={`grid-overlay-v-${col}`}
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
      {horizontalLines.map((row) => (
        <View
          key={`grid-overlay-h-${row}`}
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

export default function ModifyTileScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ setId?: string; tileId?: string }>();
  const setId = params.setId ?? '';
  const tileId = params.tileId ?? '';
  const { settings, setSettings } = usePersistedSettings();
  const { replaceTileSourceNames, replaceTileSourceNamesWithError } = useTileFiles(
    TILE_CATEGORIES[0] as TileCategory
  );
  const { tileSets, updateTileInSet, updateTileSet } = useTileSets({
    onBakedNamesReplaced: replaceTileSourceNames,
    onTileSourceNamesRemoved: replaceTileSourceNamesWithError,
  });
  const { patternsByCategory } = useTilePatterns();
  const [showTileSetChooser, setShowTileSetChooser] = useState(false);
  const [showModifyTileSetBanner, setShowModifyTileSetBanner] = useState(false);
  const dismissModifyBanner = useCallback(() => setShowModifyTileSetBanner(false), []);
  const [tileSetSelectionError, setTileSetSelectionError] = useState<string | null>(
    null
  );

  const tileSet = tileSets.find((set) => set.id === setId) ?? null;
  const tileEntry = tileSet?.tiles.find((tile) => tile.id === tileId) ?? null;
  const normalizeCategories = (value: TileCategory[] | null | undefined) => {
    if (!value || value.length === 0) {
      return [TILE_CATEGORIES[0]];
    }
    const valid = value.filter((entry) =>
      (TILE_CATEGORIES as string[]).includes(entry)
    );
    return valid.length > 0 ? valid : [TILE_CATEGORIES[0]];
  };
  const selectedCategories = normalizeCategories(
    tileSet?.categories && tileSet.categories.length > 0
      ? tileSet.categories
      : Array.isArray(settings.tileModifyCategories)
        ? (settings.tileModifyCategories as TileCategory[])
        : []
  );
  const tileSources = useMemo(() => {
    const categorySources = selectedCategories.flatMap(
      (category) => TILE_MANIFEST[category] ?? []
    );
    return [...categorySources];
  }, [selectedCategories]);
  const primaryCategory = selectedCategories[0] ?? TILE_CATEGORIES[0];
  const activePatterns = primaryCategory
    ? patternsByCategory.get(primaryCategory) ?? []
    : [];
  const selectedPattern = activePatterns[0] ?? null;

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
  >({ mode: 'random' });
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>({});
  const [paletteMirrors, setPaletteMirrors] = useState<Record<number, boolean>>({});
  const [paletteMirrorsY, setPaletteMirrorsY] = useState<Record<number, boolean>>({});

  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height - insets.top);
  const contentWidth = safeWidth;
  const contentHeight = safeHeight;
  const availableWidth = contentWidth - CONTENT_PADDING * 2;
  const reservedForBrushPanel =
    Platform.OS === 'web'
      ? Math.max(BRUSH_PANEL_HEIGHT, Math.floor(contentHeight * 0.32))
      : BRUSH_PANEL_HEIGHT;
  const availableHeight = Math.max(
    contentHeight -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      reservedForBrushPanel,
    0
  );

  const isPartOfDragRef = useRef(false);

  const {
    gridLayout,
    tiles,
    handlePress,
    floodFill,
    floodComplete,
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
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    preferredTileSize: tileEntry?.preferredTileSize ?? 45,
    allowEdgeConnections: true,
    randomRequiresLegal: true,
    fixedRows: tileSet?.resolution ?? 0,
    fixedColumns: tileSet?.resolution ?? 0,
    brush,
    mirrorHorizontal: settings.mirrorHorizontal,
    mirrorVertical: settings.mirrorVertical,
    pattern: selectedPattern
      ? {
          tiles: selectedPattern.tiles,
          width: selectedPattern.width,
          height: selectedPattern.height,
          rotation: 0,
          mirrorX: false,
        }
      : null,
    patternAnchorKey: selectedPattern?.id ?? null,
    isPartOfDragRef: isPartOfDragRef,
  });

  useEffect(() => {
    if (!showTileSetChooser && tileSetSelectionError) {
      setTileSetSelectionError(null);
    }
  }, [showTileSetChooser, tileSetSelectionError]);

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
  const isDesktopWeb =
    Platform.OS === 'web' && width >= DESKTOP_WEB_BREAKPOINT;
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
    tileSources,
    tileSize: gridLayout.tileSize,
    strokeColor: tileSet?.lineColor,
    strokeWidth: tileSet?.lineWidth,
  });
  const brushAtlas = useTileAtlas({
    tileSources,
    tileSize: brushItemSize,
    strokeColor: tileSet?.lineColor,
    strokeWidth: tileSet?.lineWidth,
  });
  const strokeScaleByName = useMemo(() => {
    const map = new Map<string, number>();
    if (!tileSet) return map;
    const scale = Math.max(1, tileSet.resolution ?? 1);
    tileSources.forEach((source) => map.set(source.name, scale));
    return map;
  }, [tileSet?.resolution, tileSources]);

  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const lastPaintedRef = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const thumbnailShotRef = useRef<ViewShot>(null);
  const thumbnailSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridMeasureRef = useRef<View | null>(null);

  useEffect(() => {
    if (!tileEntry) {
      return;
    }
    loadTiles(tileEntry.tiles ?? []);
  }, [tileEntry?.id]);

  useEffect(() => {
    if (!tileSet || !tileEntry) {
      return;
    }
    updateTileInSet(tileSet.id, tileEntry.id, (tile) => ({
      ...tile,
      tiles,
      grid: { rows: gridLayout.rows, columns: gridLayout.columns },
      preferredTileSize: gridLayout.tileSize,
      updatedAt: Date.now(),
    }));
  }, [tiles, gridLayout.rows, gridLayout.columns, gridLayout.tileSize]);

  useEffect(() => {
    if (!tileSet || !tileEntry) {
      return;
    }
    if (gridLayout.rows <= 0 || gridLayout.columns <= 0 || gridLayout.tileSize <= 0) {
      return;
    }
    if (thumbnailSaveTimeoutRef.current) {
      clearTimeout(thumbnailSaveTimeoutRef.current);
    }
    thumbnailSaveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        let thumbnailUri: string | null = null;
        if (Platform.OS === 'web') {
          thumbnailUri = await renderTileCanvasToDataUrl({
            tiles,
            gridLayout,
            tileSources,
            gridGap: GRID_GAP,
            blankSource: null,
            errorSource: ERROR_TILE,
            lineColor: tileSet.lineColor,
            lineWidth: tileSet.lineWidth,
            backgroundColor: tileCanvasBackground,
            strokeScaleByName,
            maxDimension: 192,
          });
        } else {
          try {
            const uri = await thumbnailShotRef.current?.capture?.({
              format: 'png',
              quality: 1,
              result: 'tmpfile',
            });
            if (uri) {
              thumbnailUri = uri;
            }
          } catch {
            // ignore capture errors
          }
        }
        if (!thumbnailUri) {
          return;
        }
        updateTileInSet(tileSet.id, tileEntry.id, (tile) => ({
          ...tile,
          thumbnailUri,
          updatedAt: Date.now(),
        }));
      })();
    }, 200);
    return () => {
      if (thumbnailSaveTimeoutRef.current) {
        clearTimeout(thumbnailSaveTimeoutRef.current);
        thumbnailSaveTimeoutRef.current = null;
      }
    };
  }, [
    tiles,
    gridLayout.rows,
    gridLayout.columns,
    gridLayout.tileSize,
    tileSources,
    tileSet?.lineColor,
    tileSet?.lineWidth,
    tileEntry?.id,
  ]);

  const updateGridOffset = useCallback(() => {
    const node = gridMeasureRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number) => {
        gridOffsetRef.current = { x, y };
      });
      return;
    }
  }, []);

  useEffect(() => {
    updateGridOffset();
  }, [gridWidth, gridHeight, updateGridOffset]);

  const getRelativePoint = (event: any) => {
    const nativeEvent = event?.nativeEvent ?? event;
    if (nativeEvent?.pageX !== undefined && nativeEvent?.pageY !== undefined) {
      return {
        x: nativeEvent.pageX - gridOffsetRef.current.x,
        y: nativeEvent.pageY - gridOffsetRef.current.y,
      };
    }
    if (nativeEvent?.locationX !== undefined && nativeEvent?.locationY !== undefined) {
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

  const rowIndices = useMemo(
    () => Array.from({ length: gridLayout.rows }, (_, index) => index),
    [gridLayout.rows]
  );
  const columnIndices = useMemo(
    () => Array.from({ length: gridLayout.columns }, (_, index) => index),
    [gridLayout.columns]
  );
  const borderConnectionStatus = useMemo(() => {
    if (gridLayout.rows <= 0 || gridLayout.columns <= 0) {
      return null;
    }
    const totalCells = gridLayout.rows * gridLayout.columns;
    const rendered = tiles.map((tile) => {
      if (!tile || tile.imageIndex < 0) {
        return null;
      }
      const name = tileSources[tile.imageIndex]?.name ?? '';
      return getTransformedConnectionsForName(
        name,
        tile.rotation,
        tile.mirrorX,
        tile.mirrorY
      );
    });
    const indexAt = (row: number, col: number) => row * gridLayout.columns + col;
    const pick = (row: number, col: number, dirIndex: number) => {
      const index = indexAt(row, col);
      if (index < 0 || index >= totalCells) {
        return false;
      }
      const current = rendered[index];
      return Boolean(current?.[dirIndex]);
    };
    const topRow = 0;
    const bottomRow = gridLayout.rows - 1;
    const leftCol = 0;
    const rightCol = gridLayout.columns - 1;
    const midCol = Math.floor(gridLayout.columns / 2);
    const midRow = Math.floor(gridLayout.rows / 2);
    const hasEvenCols = gridLayout.columns % 2 === 0;
    const hasEvenRows = gridLayout.rows % 2 === 0;
    const leftMidCol = hasEvenCols ? gridLayout.columns / 2 - 1 : midCol;
    const rightMidCol = hasEvenCols ? gridLayout.columns / 2 : midCol;
    const topMidRow = hasEvenRows ? gridLayout.rows / 2 - 1 : midRow;
    const bottomMidRow = hasEvenRows ? gridLayout.rows / 2 : midRow;

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

    return [
      north, // N
      pick(topRow, rightCol, 1), // NE
      east, // E
      pick(bottomRow, rightCol, 3), // SE
      south, // S
      pick(bottomRow, leftCol, 5), // SW
      west, // W
      pick(topRow, leftCol, 7), // NW
    ];
  }, [tiles, tileSources, gridLayout.columns, gridLayout.rows]);
  const tileCanvasBackground = '#0F1430';
  const tileCanvasLineColor = 'rgba(203, 213, 245, 0.25)';
  const tileCanvasLineWidth = 0.5;

  if (!tileSet || !tileEntry) {
    return (
      <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
        <ThemedText type="title" style={styles.emptyText}>
          Tile not found
        </ThemedText>
      </ThemedView>
    );
  }

  const showOverlays = true;

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
      {insets.top > 0 && (
        <View
          pointerEvents="none"
          style={[styles.statusBarBackground, { height: insets.top }]}
        />
      )}
      <ThemedView
        style={[
          styles.titleContainer,
        ]}
      >
        <ThemedView style={styles.headerRow}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace({
                pathname: '/tileSetCreator/editor',
                params: { setId },
              });
            }}
            style={styles.navBackSquare}
            accessibilityRole="button"
            accessibilityLabel="Back to tile set editor"
          >
            <ThemedText type="defaultSemiBold" style={styles.navButtonText}>
              &lt;
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setShowModifyTileSetBanner((prev) => !prev)}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Toggle tile set banner"
          >
            <ThemedText type="defaultSemiBold" style={styles.navButtonText}>
              Modify
            </ThemedText>
          </Pressable>
          <ThemedView style={styles.controls}>
            <ToolbarButton
              label="Undo"
              icon="undo"
              disabled={!canUndo}
              onPress={() => {
                dismissModifyBanner();
                undo();
              }}
            />
            <ToolbarButton
              label="Redo"
              icon="redo"
              disabled={!canRedo}
              onPress={() => {
                dismissModifyBanner();
                redo();
              }}
            />
            <ToolbarButton
              label="Clear"
              icon="refresh"
              onPress={() => {
                dismissModifyBanner();
                resetTiles();
              }}
            />
            <ToolbarButton
              label="Fill"
              icon="format-color-fill"
              onPress={() => {
                dismissModifyBanner();
                floodComplete();
              }}
              onLongPress={() => {
                dismissModifyBanner();
                floodFill();
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
      <View style={[Platform.OS === 'web' && styles.gridCanvasWebCenter]}>
        <View style={[styles.gridWrapper, { height: gridHeight, width: gridWidth }]}>
        <GridBackground
          rows={gridLayout.rows}
          columns={gridLayout.columns}
          tileSize={gridLayout.tileSize}
          width={gridWidth}
          height={gridHeight}
          backgroundColor={tileCanvasBackground}
          lineColor={tileCanvasLineColor}
          lineWidth={tileCanvasLineWidth}
        />
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
        {borderConnectionStatus && gridWidth > 0 && gridHeight > 0 && (
          <View pointerEvents="none" style={styles.borderExpectedLines}>
            {borderConnectionStatus.map((isConnected, index) => {
              const dotSize = Math.max(6, Math.round(gridLayout.tileSize * 0.2));
              const dotOffset = dotSize / 2;
              const positions = [
                { left: gridWidth / 2 - dotOffset, top: -dotOffset }, // N
                { left: gridWidth - dotOffset, top: -dotOffset }, // NE
                { left: gridWidth - dotOffset, top: gridHeight / 2 - dotOffset }, // E
                { left: gridWidth - dotOffset, top: gridHeight - dotOffset }, // SE
                { left: gridWidth / 2 - dotOffset, top: gridHeight - dotOffset }, // S
                { left: -dotOffset, top: gridHeight - dotOffset }, // SW
                { left: -dotOffset, top: gridHeight / 2 - dotOffset }, // W
                { left: -dotOffset, top: -dotOffset }, // NW
              ];
              return (
                <View
                  key={`border-current-${index}`}
                  style={[
                    styles.currentConnectionDot,
                    isConnected
                      ? styles.currentConnectionDotOn
                      : styles.currentConnectionDotOff,
                    {
                      width: dotSize,
                      height: dotSize,
                      borderRadius: dotSize / 2,
                      left: positions[index].left,
                      top: positions[index].top,
                    },
                  ]}
                />
              );
            })}
          </View>
        )}
        <View
          ref={gridMeasureRef}
          onLayout={updateGridOffset}
          style={{ width: gridWidth, height: gridHeight }}
        >
          <ThemedView
            style={[styles.grid, { width: gridWidth, height: gridHeight }]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
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
              isPartOfDragRef.current = false;
              clearDrawStroke();
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
              if (longPressTimeoutRef.current) {
                clearTimeout(longPressTimeoutRef.current);
                longPressTimeoutRef.current = null;
              }
              longPressTriggeredRef.current = false;
              lastPaintedRef.current = null;
            }}
          >
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
                      strokeColor={tileSet.lineColor}
                      strokeWidth={tileSet.lineWidth}
                      atlas={gridAtlas}
                      showOverlays
                      isCloneSource={brush.mode === 'clone' && cloneSourceIndex === cellIndex}
                      isCloneSample={brush.mode === 'clone' && cloneSampleIndex === cellIndex}
                      isCloneTargetOrigin={brush.mode === 'clone' && cloneAnchorIndex === cellIndex}
                      isCloneCursor={brush.mode === 'clone' && cloneCursorIndex === cellIndex}
                    />
                  );
                })}
              </ThemedView>
            ))}
          </ThemedView>
        </View>
        <ViewShot
          ref={thumbnailShotRef}
          style={[styles.captureSurface, { width: gridWidth, height: gridHeight }]}
          options={{ format: 'png', quality: 1, result: 'tmpfile' }}
          pointerEvents="none"
        >
          <ThemedView
            style={[
              styles.grid,
              { width: gridWidth, height: gridHeight, backgroundColor: tileCanvasBackground },
            ]}
          >
            {rowIndices.map((rowIndex) => (
              <ThemedView key={`capture-row-${rowIndex}`} style={styles.row}>
                {columnIndices.map((columnIndex) => {
                  const cellIndex = rowIndex * gridLayout.columns + columnIndex;
                  const item = tiles[cellIndex];
                  return (
                    <TileCell
                      key={`capture-cell-${cellIndex}`}
                      cellIndex={cellIndex}
                      tileSize={gridLayout.tileSize}
                      tile={item}
                      tileSources={tileSources}
                      showDebug={false}
                      strokeColor={tileSet.lineColor}
                      strokeWidth={tileSet.lineWidth}
                      atlas={gridAtlas}
                      showOverlays={false}
                      isCloneSource={false}
                      isCloneSample={false}
                      isCloneTargetOrigin={false}
                      isCloneCursor={false}
                    />
                  );
                })}
              </ThemedView>
            ))}
          </ThemedView>
        </ViewShot>
        {gridWidth > 0 && gridHeight > 0 && (
          <GridLinesOverlay
            rows={gridLayout.rows}
            columns={gridLayout.columns}
            tileSize={gridLayout.tileSize}
            width={gridWidth}
            height={gridHeight}
            lineColor={tileCanvasLineColor}
            lineWidth={tileCanvasLineWidth}
          />
        )}
        </View>
        {showModifyTileSetBanner && (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowModifyTileSetBanner(false)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss tile set banner"
            />
            <View
              style={styles.modifyTileSetBanner}
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
                    TILE_CATEGORY_THUMBNAILS[category] ?? TILE_MANIFEST[category]?.[0];
                  return (
                    <Pressable
                      key={category}
                      onPress={() => {
                        if (isSelected && selectedCategories.length === 1) {
                          return;
                        }
                        const nextCategories = isSelected
                          ? selectedCategories.filter((entry) => entry !== category)
                          : [...selectedCategories, category];
                        setTileSetSelectionError(null);
                        setSettings((prev) => ({
                          ...prev,
                          tileModifyCategories: nextCategories,
                        }));
                        if (tileSet) {
                          updateTileSet(tileSet.id, (set) => ({
                            ...set,
                            categories: nextCategories,
                            updatedAt: Date.now(),
                          }));
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
              </ScrollView>
              <Pressable
                onPress={() => setShowModifyTileSetBanner(false)}
                style={styles.modifyTileSetBannerClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Dismiss tile set banner"
              >
                <MaterialCommunityIcons name="close" size={24} color="#fff" />
              </Pressable>
            </View>
          </>
        )}
      </View>
      <View style={styles.brushPanelWrap}>
        <TileBrushPanel
          tileSources={tileSources}
          selected={brush}
          strokeColor={tileSet.lineColor}
          strokeWidth={tileSet.lineWidth}
          atlas={brushAtlas}
          showPattern={false}
          rows={brushRows}
          selectedPattern={
            selectedPattern
              ? {
                  tiles: selectedPattern.tiles,
                  width: selectedPattern.width,
                  height: selectedPattern.height,
                  rotation: 0,
                  mirrorX: false,
                }
              : null
          }
          onSelect={(next) => {
            dismissModifyBanner();
            if (next.mode === 'clone') {
              clearCloneSource();
            }
            if (next.mode === 'fixed') {
              const rotation = paletteRotations[next.index] ?? next.rotation ?? 0;
              const mirrorX = paletteMirrors[next.index] ?? next.mirrorX ?? false;
              const mirrorY = paletteMirrorsY[next.index] ?? next.mirrorY ?? false;
              const source = tileSources[next.index];
              setBrush({
                mode: 'fixed',
                index: next.index,
                sourceName: source?.name,
                rotation,
                mirrorX,
                mirrorY,
              });
            } else {
              setBrush(next);
            }
          }}
          onRotate={(index) => {
            dismissModifyBanner();
            setPaletteRotations((prev) => {
              const nextRotation = ((prev[index] ?? 0) + 90) % 360;
              if (brush.mode === 'fixed' && brush.index === index) {
                const src = tileSources[index];
                setBrush({
                  mode: 'fixed',
                  index,
                  sourceName: src?.name,
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
            if (brush.mode === 'fixed' && brush.index === index) {
              const src = tileSources[index];
              setBrush({
                mode: 'fixed',
                index,
                sourceName: src?.name,
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
            if (brush.mode === 'fixed' && brush.index === index) {
              const src = tileSources[index];
              setBrush({
                mode: 'fixed',
                index,
                sourceName: src?.name,
                rotation: brush.rotation,
                mirrorX: newMirrorX,
                mirrorY: newMirrorY,
              });
            }
          }}
          getRotation={(index) => paletteRotations[index] ?? 0}
          getMirror={(index) => paletteMirrors[index] ?? false}
          getMirrorVertical={(index) => paletteMirrorsY[index] ?? false}
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
      </View>
      {showTileSetChooser && (
        <View style={styles.overlay} accessibilityRole="dialog">
            <Pressable
            style={styles.overlayBackdrop}
            onPress={() => {
              if (selectedCategories.length === 0) {
                setTileSetSelectionError('Select at least one tile set.');
                return;
              }
              setShowTileSetChooser(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Close tile set chooser"
          />
          <View style={styles.overlayPanel}>
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
                    const firstTile =
                      TILE_CATEGORY_THUMBNAILS[category] ?? TILE_MANIFEST[category]?.[0];
                    return (
                      <Pressable
                        key={category}
                        onPress={() => {
                          if (isSelected && selectedCategories.length === 1) {
                            setTileSetSelectionError('Select at least one tile set.');
                            return;
                          }
                          const nextCategories = isSelected
                            ? selectedCategories.filter((entry) => entry !== category)
                            : [...selectedCategories, category];
                          setTileSetSelectionError(null);
                          setSettings((prev) => ({
                            ...prev,
                            tileModifyCategories: nextCategories,
                          }));
                          if (tileSet) {
                            updateTileSet(tileSet.id, (set) => ({
                              ...set,
                              categories: nextCategories,
                              updatedAt: Date.now(),
                            }));
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
            </ScrollView>
            {tileSetSelectionError && (
              <ThemedText type="defaultSemiBold" style={styles.errorText}>
                {tileSetSelectionError}
              </ThemedText>
            )}
          </View>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0F1430',
  },
  statusBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#e5e5e5',
    zIndex: 5,
  },
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
  modifyTileSetBannerClose: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridCanvasWebCenter: {
    width: '100%',
    alignItems: 'center',
  },
  gridWrapper: {
    position: 'relative',
    backgroundColor: 'transparent',
  },
  gridBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLinesOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  captureSurface: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    opacity: 1,
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
  },
  grid: {
    alignContent: 'flex-start',
    gap: GRID_GAP,
    backgroundColor: 'transparent',
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
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
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
  },
  tileSetChooserScroll: {
    maxHeight: 320,
  },
  tileSetChooserScrollContent: {
    paddingVertical: 8,
    gap: 16,
  },
  tileSetChooserSection: {},
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
  tileSetChooserLabel: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 12,
  },
  overlayList: {
    gap: 8,
    marginTop: 10,
  },
  overlayItem: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  overlayItemSelected: {
    borderColor: '#60a5fa',
    backgroundColor: 'rgba(96, 165, 250, 0.15)',
  },
  sectionGroup: {
    marginTop: 12,
  },
  emptyText: {
    color: '#9ca3af',
    marginTop: 8,
  },
  errorText: {
    color: '#fca5a5',
    marginTop: 8,
  },
  borderConnectionLines: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
    backgroundColor: 'transparent',
  },
  borderExpectedLines: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  brushPanelWrap: {
    zIndex: 10,
    backgroundColor: '#3f3f3f',
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
  connectionDot: {
    position: 'absolute',
    zIndex: 3,
  },
  connectionDotOn: {
    backgroundColor: 'rgba(34, 197, 94, 0.5)',
  },
  connectionDotNeutral: {
    backgroundColor: 'rgba(148, 163, 184, 0.6)',
  },
  currentConnectionDot: {
    position: 'absolute',
  },
  currentConnectionDotOn: {
    backgroundColor: 'rgba(34, 197, 94, 0.75)',
  },
  currentConnectionDotOff: {
    backgroundColor: 'rgba(239, 68, 68, 0.75)',
  },
  tileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },
  emptyText: {
    color: '#fff',
    padding: 16,
  },
});
