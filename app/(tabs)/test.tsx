import { memo, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

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
import { exportTileCanvasAsPng } from '@/utils/tile-export';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 250;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BLANK_TILE = require('@/assets/images/tiles/tile_blank.png');
const ERROR_TILE = require('@/assets/images/tiles/tile_error.png');

type TileCellProps = {
  cellIndex: number;
  tileSize: number;
  tile: Tile;
  tileSources: typeof TILE_MANIFEST[TileCategory];
  showDebug: boolean;
  isCloneSource: boolean;
};

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    isCloneSource,
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
        {showDebug && <TileDebugOverlay connections={connections} />}
      </View>
    );
  },
  (prev, next) =>
    prev.tile === next.tile &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.tileSources === next.tileSources &&
    prev.isCloneSource === next.isCloneSource
);

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => TILE_CATEGORIES[0]
  );
  const [showTileSetOverlay, setShowTileSetOverlay] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [minTilesInput, setMinTilesInput] = useState('25');
  const [mirrorHorizontal, setMirrorHorizontal] = useState(false);
  const [mirrorVertical, setMirrorVertical] = useState(false);
  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'fixed'; index: number; rotation: number }
  >({
    mode: 'random',
  });
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>(
    {}
  );
  const minTiles = Number.isNaN(Number(minTilesInput))
    ? 0
    : Math.max(0, Math.floor(Number(minTilesInput)));
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const isWeb = Platform.OS === 'web';
  const availableWidth = width - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    height -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      titleHeight -
      BRUSH_PANEL_HEIGHT,
    0
  );

  const {
    gridLayout,
    tiles,
    handlePress,
    randomFill,
    floodFill,
    floodComplete,
    resetTiles,
    setCloneSource,
    cloneSourceIndex,
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    minTiles,
    brush,
    mirrorHorizontal,
    mirrorVertical,
  });
  const lastPaintedRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; cellIndex: number } | null>(null);
  const cloneTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloneTapPendingRef = useRef<{ time: number; cellIndex: number } | null>(
    null
  );
  const rowIndices = useMemo(
    () => Array.from({ length: gridLayout.rows }, (_, index) => index),
    [gridLayout.rows]
  );
  const columnIndices = useMemo(
    () => Array.from({ length: gridLayout.columns }, (_, index) => index),
    [gridLayout.columns]
  );

  const handleDownload = async () => {
    const result = await exportTileCanvasAsPng({
      tiles,
      gridLayout,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: BLANK_TILE,
      errorSource: ERROR_TILE,
    });
    if (!result.ok) {
      Alert.alert('Download unavailable', result.error);
    }
  };

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
    if (
      typeof nativeEvent.pageX === 'number' &&
      typeof nativeEvent.pageY === 'number' &&
      event?.currentTarget?.measureInWindow
    ) {
      let point: { x: number; y: number } | null = null;
      event.currentTarget.measureInWindow((x: number, y: number) => {
        point = {
          x: nativeEvent.pageX - x,
          y: nativeEvent.pageY - y,
        };
      });
      return point;
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

  const handleCloneTap = (cellIndex: number) => {
    const now = Date.now();
    const pending = cloneTapPendingRef.current;
    if (
      pending &&
      pending.cellIndex === cellIndex &&
      now - pending.time < 250
    ) {
      if (cloneTapTimeoutRef.current) {
        clearTimeout(cloneTapTimeoutRef.current);
        cloneTapTimeoutRef.current = null;
      }
      cloneTapPendingRef.current = null;
      setCloneSource(cellIndex);
      lastPaintedRef.current = null;
      return;
    }

    if (cloneTapTimeoutRef.current) {
      clearTimeout(cloneTapTimeoutRef.current);
      cloneTapTimeoutRef.current = null;
    }

    cloneTapPendingRef.current = { time: now, cellIndex };
    cloneTapTimeoutRef.current = setTimeout(() => {
      cloneTapTimeoutRef.current = null;
      cloneTapPendingRef.current = null;
      paintCellIndex(cellIndex);
    }, 220);
  };

  const handlePaintAt = (x: number, y: number, options?: { isDoubleTap?: boolean }) => {
    const cellIndex = getCellIndexForPoint(x, y);
    if (cellIndex === null) {
      return;
    }
    if (options?.isDoubleTap && brush.mode === 'clone') {
      setCloneSource(cellIndex);
      lastPaintedRef.current = null;
      return;
    }
    if (brush.mode === 'clone' && cloneTapTimeoutRef.current) {
      clearTimeout(cloneTapTimeoutRef.current);
      cloneTapTimeoutRef.current = null;
      cloneTapPendingRef.current = null;
    }
    paintCellIndex(cellIndex);
  };

  return (
    <ThemedView style={styles.screen}>
      <ThemedView
        style={styles.titleContainer}
        onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}
      >
        <ThemedText type="title">Tile Grid</ThemedText>
        <ThemedView style={styles.controls}>
          <Pressable
            onPress={() => setShowTileSetOverlay(true)}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Choose tile set"
          >
            <ThemedText type="defaultSemiBold">{selectedCategory}</ThemedText>
          </Pressable>
          <ThemedView style={styles.inputGroup}>
            <ThemedText type="defaultSemiBold">Min Tiles</ThemedText>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={minTilesInput}
              onChangeText={setMinTilesInput}
              accessibilityLabel="Minimum tiles"
            />
          </ThemedView>
          <Pressable
            onPress={resetTiles}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Reset tiles"
          >
            <ThemedText type="defaultSemiBold">Reset</ThemedText>
          </Pressable>
          <Pressable
            onPress={floodFill}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Flood fill tiles"
          >
            <ThemedText type="defaultSemiBold">Flood Fill</ThemedText>
          </Pressable>
          <Pressable
            onPress={floodComplete}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Flood complete tiles"
          >
            <ThemedText type="defaultSemiBold">Flood Complete</ThemedText>
          </Pressable>
          <Pressable
            onPress={handleDownload}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Download tile canvas"
          >
            <ThemedText type="defaultSemiBold">Download PNG</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setShowDebug((prev) => !prev)}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Toggle debug overlay"
          >
            <ThemedText type="defaultSemiBold">
              {showDebug ? 'Hide Debug' : 'Show Debug'}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setMirrorHorizontal((prev) => !prev)}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Toggle horizontal mirror"
          >
            <ThemedText type="defaultSemiBold">
              {mirrorHorizontal ? 'Mirror H: On' : 'Mirror H: Off'}
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setMirrorVertical((prev) => !prev)}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Toggle vertical mirror"
          >
            <ThemedText type="defaultSemiBold">
              {mirrorVertical ? 'Mirror V: On' : 'Mirror V: Off'}
            </ThemedText>
          </Pressable>
        </ThemedView>
      </ThemedView>
      <ThemedView
        style={[styles.grid, { height: availableHeight }]}
        accessibilityRole="grid"
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
                  const now = Date.now();
                  const lastTap = lastTapRef.current;
                  const isDoubleTap =
                    brush.mode === 'clone' &&
                    lastTap &&
                    lastTap.cellIndex === cellIndex &&
                    now - lastTap.time < 350;
                  lastTapRef.current = { time: now, cellIndex };
                  if (isDoubleTap) {
                    handleCloneTap(cellIndex);
                    return;
                  }
                  if (brush.mode === 'clone') {
                    handleCloneTap(cellIndex);
                    return;
                  }
                  paintCellIndex(cellIndex);
                }
              },
              onResponderMove: (event: any) => {
                const point = getRelativePoint(event);
                if (point) {
                  handlePaintAt(point.x, point.y);
                }
              },
              onResponderRelease: () => {
                lastPaintedRef.current = null;
              },
              onResponderTerminate: () => {
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
                  if (brush.mode === 'clone') {
                    handleCloneTap(cellIndex);
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
        {(mirrorHorizontal || mirrorVertical) && (
          <ThemedView pointerEvents="none" style={styles.mirrorLines}>
            {mirrorVertical && (
              <ThemedView
                style={[
                  styles.mirrorLineHorizontal,
                  { top: gridLayout.tileSize * (gridLayout.rows / 2) },
                ]}
              />
            )}
            {mirrorHorizontal && (
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
                  showDebug={showDebug}
                  isCloneSource={brush.mode === 'clone' && cloneSourceIndex === cellIndex}
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
          if (next.mode === 'fixed') {
            const rotation = paletteRotations[next.index] ?? next.rotation ?? 0;
            setBrush({ mode: 'fixed', index: next.index, rotation });
          } else {
            setBrush(next);
          }
        }}
        onRotate={(index) =>
          setPaletteRotations((prev) => {
            const nextRotation = ((prev[index] ?? 0) + 90) % 360;
            if (brush.mode === 'fixed' && brush.index === index) {
              setBrush({ mode: 'fixed', index, rotation: nextRotation });
            }
            return {
              ...prev,
              [index]: nextRotation,
            };
          })
        }
        getRotation={(index) => paletteRotations[index] ?? 0}
        height={BRUSH_PANEL_HEIGHT}
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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
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
  },
  grid: {
    alignContent: 'flex-start',
    gap: GRID_GAP,
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
