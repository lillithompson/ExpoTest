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
  const [brush, setBrush] = useState<
    { mode: 'random' } | { mode: 'erase' } | { mode: 'fixed'; index: number }
  >({
    mode: 'random',
  });
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
                          { rotate: `${item.rotation}deg` },
                          { scaleX: item.mirrorX ? -1 : 1 },
                          { scaleY: item.mirrorY ? -1 : 1 },
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
        onSelect={setBrush}
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
});
