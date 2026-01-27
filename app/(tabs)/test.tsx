import { useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 250;
const TITLE_SPACING = 0;

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => TILE_CATEGORIES[0]
  );
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const availableWidth = width - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    height - HEADER_HEIGHT - CONTENT_PADDING * 2 - TITLE_SPACING - titleHeight,
    0
  );

  const { gridLayout, tiles, handlePress } = useTileGrid({
    tileSourcesLength: tileSources.length,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
  });

  return (
    <ThemedView style={styles.screen}>
      <ThemedView
        style={styles.titleContainer}
        onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}
      >
        <ThemedText type="title">Tile Grid</ThemedText>
        <Pressable
          onPress={() => setShowMenu((prev) => !prev)}
          style={styles.dropdown}
          accessibilityRole="button"
          accessibilityLabel="Select tile set"
        >
          <ThemedText type="defaultSemiBold">{selectedCategory}</ThemedText>
        </Pressable>
      </ThemedView>
      {showMenu && (
        <ThemedView style={styles.menu}>
          {TILE_CATEGORIES.map((category) => (
            <Pressable
              key={category}
              onPress={() => {
                setSelectedCategory(category);
                setShowMenu(false);
              }}
              style={styles.menuItem}
            >
              <ThemedText type="defaultSemiBold">{category}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>
      )}
      <ThemedView
        style={[styles.grid, { height: availableHeight }]}
        accessibilityRole="grid"
      >
        {Array.from({ length: gridLayout.rows }).map((_, rowIndex) => (
          <ThemedView key={`row-${rowIndex}`} style={styles.row}>
            {Array.from({ length: gridLayout.columns }).map((_, columnIndex) => {
              const cellIndex = rowIndex * gridLayout.columns + columnIndex;
              const item = tiles[cellIndex];
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
                    source={tileSources[item.imageIndex]}
                    style={[
                      styles.tileImage,
                      { transform: [{ rotate: `${item.rotation}deg` }] },
                    ]}
                    resizeMode="cover"
                    fadeDuration={0}
                  />
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
  dropdown: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  menu: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    marginBottom: 8,
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
});
