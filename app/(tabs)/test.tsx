import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

const TILE_IMAGES = [
  require('@/assets/images/tiles/lines/line_00.png'),
  require('@/assets/images/tiles/lines/line_01.png'),
  require('@/assets/images/tiles/lines/line_02.png'),
  require('@/assets/images/tiles/lines/line_03.png'),
  require('@/assets/images/tiles/lines/line_04.png'),
  require('@/assets/images/tiles/lines/line_05.png'),
  require('@/assets/images/tiles/lines/line_06.png'),
  require('@/assets/images/tiles/lines/line_07.png'),
  require('@/assets/images/tiles/lines/line_08.png'),
  require('@/assets/images/tiles/lines/line_09.png'),
  require('@/assets/images/tiles/lines/line_10.png'),
  require('@/assets/images/tiles/lines/line_11.png'),
  require('@/assets/images/tiles/lines/line_12.png'),
  require('@/assets/images/tiles/lines/line_13.png'),
  require('@/assets/images/tiles/lines/line_14.png'),
  require('@/assets/images/tiles/lines/line_15.png'),
];

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 250;
const TITLE_SPACING = 0;

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(0);
  const availableWidth = width - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    height - HEADER_HEIGHT - CONTENT_PADDING * 2 - TITLE_SPACING - titleHeight,
    0
  );

  const gridLayout = useMemo(() => {
    const totalTiles = TILE_IMAGES.length;
    let best = { columns: 1, rows: totalTiles, tileSize: 0 };

    for (let columns = 1; columns <= totalTiles; columns += 1) {
      const rows = Math.ceil(totalTiles / columns);
      const widthPerTile =
        (availableWidth - GRID_GAP * (columns - 1)) / columns;
      const heightPerTile =
        (availableHeight - GRID_GAP * (rows - 1)) / rows;
      const tileSize = Math.floor(Math.min(widthPerTile, heightPerTile));

      if (tileSize > best.tileSize) {
        best = { columns, rows, tileSize };
      }
    }

    return best;
  }, [availableHeight, availableWidth]);

  const buildInitialTiles = (count: number) => {
    if (count <= 0) {
      return [];
    }
    const base = TILE_IMAGES.map((_, index) => index);
    if (count <= base.length) {
      return base.slice(0, count);
    }
    const extra = Array.from({ length: count - base.length }, () =>
      Math.floor(Math.random() * TILE_IMAGES.length)
    );
    return [...base, ...extra];
  };

  const [tileIndexes, setTileIndexes] = useState(() =>
    buildInitialTiles(TILE_IMAGES.length)
  );

  const totalCells = gridLayout.rows * gridLayout.columns;
  const normalizedTiles = useMemo(() => {
    if (tileIndexes.length === totalCells) {
      return tileIndexes;
    }
    return buildInitialTiles(totalCells);
  }, [tileIndexes, totalCells]);

  useEffect(() => {
    if (tileIndexes.length !== totalCells) {
      setTileIndexes(normalizedTiles);
    }
  }, [normalizedTiles, tileIndexes.length, totalCells]);

  const gridData = useMemo(
    () =>
      normalizedTiles.map((imageIndex, index) => ({
        id: String(index),
        imageIndex,
      })),
    [normalizedTiles]
  );

  const pickNewIndex = (currentIndex: number) => {
    if (TILE_IMAGES.length <= 1) {
      return currentIndex;
    }

    let nextIndex = currentIndex;
    while (nextIndex === currentIndex) {
      nextIndex = Math.floor(Math.random() * TILE_IMAGES.length);
    }
    return nextIndex;
  };

  const handlePress = (cellIndex: number) => {
    setTileIndexes(
      normalizedTiles.map((value, index) =>
        index === cellIndex ? pickNewIndex(value) : value
      )
    );
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView
        style={styles.titleContainer}
        onLayout={(event) => setTitleHeight(event.nativeEvent.layout.height)}
      >
        <ThemedText type="title">Tile Grid</ThemedText>
      </ThemedView>
      <ThemedView
        style={[styles.grid, { height: availableHeight }]}
        accessibilityRole="grid"
      >
        {Array.from({ length: gridLayout.rows }).map((_, rowIndex) => (
          <ThemedView key={`row-${rowIndex}`} style={styles.row}>
            {Array.from({ length: gridLayout.columns }).map((_, columnIndex) => {
              const cellIndex = rowIndex * gridLayout.columns + columnIndex;
              const item = gridData[cellIndex];
              return (
                <Pressable
                  key={item.id}
                  onPress={() => handlePress(cellIndex)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tile ${cellIndex + 1}`}
                  style={[
                    styles.tile,
                    { width: gridLayout.tileSize, height: gridLayout.tileSize },
                  ]}
                >
                  <Image
                    source={TILE_IMAGES[item.imageIndex]}
                    style={styles.tileImage}
                    contentFit="cover"
                  />
                </Pressable>
              );
            })}
          </ThemedView>
        ))}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
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
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
});
