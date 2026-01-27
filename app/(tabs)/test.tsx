import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';

import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';

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

  const gridLayout = useMemo(() => {
    const totalTiles = tileSources.length;
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
  }, [availableHeight, availableWidth, tileSources.length]);

  const pickNewIndex = (currentIndex: number, sourcesLength: number) => {
    if (sourcesLength <= 1) {
      return currentIndex;
    }

    let nextIndex = currentIndex;
    while (nextIndex === currentIndex) {
      nextIndex = Math.floor(Math.random() * sourcesLength);
    }
    return nextIndex;
  };

  const pickRotation = () => {
    const options = [0, 90, 180, 270];
    return options[Math.floor(Math.random() * options.length)];
  };

  const buildInitialTiles = (count: number, sourcesLength: number) => {
    if (count <= 0) {
      return [];
    }
    const base = Array.from({ length: sourcesLength }, (_, index) => index);
    const filled =
      count <= base.length
        ? base.slice(0, count)
        : [
            ...base,
            ...Array.from({ length: count - base.length }, () =>
              Math.floor(Math.random() * sourcesLength)
            ),
          ];
    return filled.map((imageIndex) => ({
      imageIndex,
      rotation: pickRotation(),
    }));
  };

  const normalizeTiles = (
    currentTiles: Array<{ imageIndex: number; rotation: number }>,
    cellCount: number,
    sourcesLength: number
  ) => {
    if (cellCount <= 0) {
      return [];
    }
    if (currentTiles.length === 0) {
      return buildInitialTiles(cellCount, sourcesLength);
    }
    if (currentTiles.length === cellCount) {
      return currentTiles;
    }
    if (currentTiles.length < cellCount) {
      const next = [...currentTiles];
      for (let i = currentTiles.length; i < cellCount; i += 1) {
        const source = currentTiles[i % currentTiles.length];
        next.push({ imageIndex: source.imageIndex, rotation: source.rotation });
      }
      return next;
    }
    return currentTiles.slice(0, cellCount);
  };

  const totalCells = gridLayout.rows * gridLayout.columns;
  const [tiles, setTiles] = useState<Array<{ imageIndex: number; rotation: number }>>(() =>
    buildInitialTiles(Math.max(totalCells, tileSources.length), tileSources.length)
  );
  const lastCategoryRef = useRef<TileCategory>(selectedCategory);
  const lastPressRef = useRef<{
    cellIndex: number;
    imageIndex: number;
    rotation: number;
    time: number;
  } | null>(null);
  const renderTiles = useMemo(
    () => normalizeTiles(tiles, totalCells, tileSources.length),
    [tiles, totalCells, tileSources.length]
  );

  useEffect(() => {
    if (lastCategoryRef.current !== selectedCategory) {
      lastCategoryRef.current = selectedCategory;
      setTiles(
        buildInitialTiles(
          Math.max(totalCells, tileSources.length),
          tileSources.length
        )
      );
    }
  }, [selectedCategory, tileSources.length, totalCells]);

  useEffect(() => {
    setTiles((prev) => normalizeTiles(prev, totalCells, tileSources.length));
  }, [totalCells]);

  const handlePress = (cellIndex: number) => {
    const current = renderTiles[cellIndex];
    if (current === undefined) {
      return;
    }
    const now = Date.now();
    const cached =
      lastPressRef.current &&
      lastPressRef.current.cellIndex === cellIndex &&
      now - lastPressRef.current.time < 150
        ? lastPressRef.current
        : null;

    const nextImageIndex = cached
      ? cached.imageIndex
      : pickNewIndex(current.imageIndex, tileSources.length);
    const nextRotation = cached ? cached.rotation : pickRotation();

    lastPressRef.current = {
      cellIndex,
      imageIndex: nextImageIndex,
      rotation: nextRotation,
      time: now,
    };
    setTiles((prev) =>
      normalizeTiles(prev, totalCells, tileSources.length).map((tile, index) =>
        index === cellIndex
          ? { imageIndex: nextImageIndex, rotation: nextRotation }
          : tile
      )
    );
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <ExpoImage
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
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
              const item = renderTiles[cellIndex];
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
    </ParallaxScrollView>
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
    backgroundColor: '#000',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
});
