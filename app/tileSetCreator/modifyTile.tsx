import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TILE_MANIFEST } from '@/assets/images/tiles/manifest';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { TileAsset } from '@/components/tile-asset';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { useTilePatterns } from '@/hooks/use-tile-patterns';
import { useTileSets } from '@/hooks/use-tile-sets';
import { renderTileCanvasToDataUrl } from '@/utils/tile-export';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BRUSH_PANEL_ROW_GAP = 1;
const ERROR_TILE = require('@/assets/images/tiles/tile_error.svg');

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
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.toolbarButton}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={color ?? (active ? '#22c55e' : 'rgba(42, 42, 42, 0.8)')}
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

export default function ModifyTileScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ setId?: string; tileId?: string }>();
  const setId = params.setId ?? '';
  const tileId = params.tileId ?? '';
  const { settings, setSettings } = usePersistedSettings();
  const { tileSets, updateTileInSet } = useTileSets();
  const { patternsByCategory } = useTilePatterns();

  const tileSet = tileSets.find((set) => set.id === setId) ?? null;
  const tileEntry = tileSet?.tiles.find((tile) => tile.id === tileId) ?? null;
  const tileSources = tileSet ? TILE_MANIFEST[tileSet.category] ?? [] : [];
  const activePatterns = tileSet ? patternsByCategory.get(tileSet.category) ?? [] : [];
  const selectedPattern = activePatterns[0] ?? null;

  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'pattern' }
    | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean }
  >({ mode: 'random' });
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>({});
  const [paletteMirrors, setPaletteMirrors] = useState<Record<number, boolean>>({});

  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height - insets.top);
  const contentWidth = safeWidth;
  const contentHeight = safeHeight;
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
    gridLayout,
    tiles,
    handlePress,
    floodFill,
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
    preferredTileSize: tileEntry?.preferredTileSize ?? 45,
    allowEdgeConnections: settings.allowEdgeConnections,
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
  });

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

  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const lastPaintedRef = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const thumbnailShotRef = useRef<ViewShot>(null);
  const thumbnailSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const getRelativePoint = (event: any) => {
    const nativeEvent = event?.nativeEvent ?? event;
    if (nativeEvent?.locationX !== undefined && nativeEvent?.locationY !== undefined) {
      return { x: nativeEvent.locationX, y: nativeEvent.locationY };
    }
    if (nativeEvent?.pageX !== undefined && nativeEvent?.pageY !== undefined) {
      return {
        x: nativeEvent.pageX - gridOffsetRef.current.x,
        y: nativeEvent.pageY - gridOffsetRef.current.y,
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

  if (!tileSet || !tileEntry) {
    return (
      <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
        <ThemedText type="title" style={styles.emptyText}>
          Tile not found
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
      <ThemedView style={styles.titleContainer}>
        <ThemedView style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Back to tile set editor"
          >
            <ThemedText type="defaultSemiBold" style={styles.navButtonText}>
              &lt; Modify Tile
            </ThemedText>
          </Pressable>
          <ThemedView style={styles.controls}>
            <ToolbarButton label="Clear" icon="trash-can-outline" onPress={resetTiles} />
            <ToolbarButton
              label="Fill"
              icon="format-color-fill"
              onPress={floodComplete}
              onLongPress={floodFill}
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
      <View style={[styles.gridWrapper, { height: gridHeight, width: gridWidth }]}>
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
        <ViewShot ref={thumbnailShotRef} style={{ width: gridWidth, height: gridHeight }}>
          <ThemedView
            style={[styles.grid, { width: gridWidth, height: gridHeight }]}
            onLayout={(event: any) => {
              const layout = event?.nativeEvent?.layout;
              if (layout) {
                gridOffsetRef.current = { x: layout.x ?? 0, y: layout.y ?? 0 };
              }
            }}
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
        </ViewShot>
      </View>
      <TileBrushPanel
        tileSources={tileSources}
        selected={brush}
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#3f3f3f',
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
  navButtonText: {
    color: '#2a2a2a',
    fontSize: 14,
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
  emptyText: {
    color: '#fff',
    padding: 16,
  },
});
