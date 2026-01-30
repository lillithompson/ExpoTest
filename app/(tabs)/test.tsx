import { useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
} from 'react-native';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { TileSetDropdown } from '@/components/tile-set-dropdown';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 250;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BLANK_TILE = require('@/assets/images/tiles/tile_blank.png');
const ERROR_TILE = require('@/assets/images/tiles/tile_error.png');

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => TILE_CATEGORIES[0]
  );
  const [showDebug, setShowDebug] = useState(false);
  const [minTilesInput, setMinTilesInput] = useState('25');
  const [mirrorHorizontal, setMirrorHorizontal] = useState(false);
  const [mirrorVertical, setMirrorVertical] = useState(false);
  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
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

  const { gridLayout, tiles, handlePress, randomFill, floodFill, floodComplete, resetTiles } = useTileGrid({
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

  const handlePaintAt = (x: number, y: number) => {
    if (gridLayout.columns === 0 || gridLayout.rows === 0) {
      return;
    }
    const tileStride = gridLayout.tileSize + GRID_GAP;
    const col = Math.floor(x / (tileStride || 1));
    const row = Math.floor(y / (tileStride || 1));
    if (col < 0 || row < 0 || col >= gridLayout.columns || row >= gridLayout.rows) {
      return;
    }
    const index = row * gridLayout.columns + col;
    if (lastPaintedRef.current === index) {
      return;
    }
    lastPaintedRef.current = index;
    handlePress(index);
  };

  return (
    <ThemedView style={styles.screen}>
      <ThemedView
        style={styles.titleContainer}
        onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}
      >
        <ThemedText type="title">Tile Grid</ThemedText>
        <ThemedView style={styles.controls}>
          <TileSetDropdown
            categories={TILE_CATEGORIES}
            selected={selectedCategory}
            onSelect={(category) => setSelectedCategory(category as TileCategory)}
          />
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
                  handlePaintAt(point.x, point.y);
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
        {Array.from({ length: gridLayout.rows }).map((_, rowIndex) => (
          <ThemedView key={`row-${rowIndex}`} style={styles.row}>
            {Array.from({ length: gridLayout.columns }).map((_, columnIndex) => {
              const cellIndex = rowIndex * gridLayout.columns + columnIndex;
              const item = tiles[cellIndex];
              const tileName = tileSources[item.imageIndex]?.name ?? '';
              const connections =
                showDebug && item.imageIndex >= 0
                  ? getTransformedConnectionsForName(
                      tileName,
                      item.rotation,
                      item.mirrorX,
                      item.mirrorY
                    )
                  : null;
              return (
                <Pressable
                  key={`cell-${cellIndex}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Tile ${cellIndex + 1}`}
                  style={[
                    styles.tile,
                    { width: gridLayout.tileSize, height: gridLayout.tileSize },
                  ]}
                >
                  <Image
                    source={
                      item.imageIndex < 0
                        ? item.imageIndex === -2
                          ? ERROR_TILE
                          : BLANK_TILE
                        : tileSources[item.imageIndex]?.source
                    }
                    style={[
                      styles.tileImage,
                      {
                        transform: [
                          { scaleX: item.mirrorX ? -1 : 1 },
                          { scaleY: item.mirrorY ? -1 : 1 },
                          { rotate: `${item.rotation}deg` },
                        ],
                      },
                    ]}
                    resizeMode="cover"
                    fadeDuration={0}
                  />
                  {showDebug && <TileDebugOverlay connections={connections} />}
                </Pressable>
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
