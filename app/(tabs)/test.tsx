import { useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
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
const BLANK_TILE = require('@/assets/images/tiles/tile_blank.png');
const ERROR_TILE = require('@/assets/images/tiles/tile_error.png');

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => TILE_CATEGORIES[0]
  );
  const [showDebug, setShowDebug] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const availableWidth = width - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    height - HEADER_HEIGHT - CONTENT_PADDING * 2 - TITLE_SPACING - titleHeight,
    0
  );

  const { gridLayout, tiles, handlePress, randomFill, resetTiles } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    eraseMode,
  });

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
          <Pressable
            onPress={resetTiles}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Reset tiles"
          >
            <ThemedText type="defaultSemiBold">Reset</ThemedText>
          </Pressable>
          <Pressable
            onPress={randomFill}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Random fill tiles"
          >
            <ThemedText type="defaultSemiBold">Random Fill</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => setEraseMode((prev) => !prev)}
            style={[styles.resetButton, eraseMode && styles.resetButtonActive]}
            accessibilityRole="button"
            accessibilityLabel="Toggle erase mode"
          >
            <ThemedText type="defaultSemiBold">
              {eraseMode ? 'Erase: On' : 'Erase: Off'}
            </ThemedText>
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
                  onPress={() => handlePress(cellIndex)}
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
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  resetButtonActive: {
    backgroundColor: '#1f1f1f',
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
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
});
