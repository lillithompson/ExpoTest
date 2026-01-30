import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { type TileSource } from '@/assets/images/tiles/manifest';

type Brush =
  | { mode: 'random' }
  | { mode: 'erase' }
  | { mode: 'fixed'; index: number; rotation: number };

type Props = {
  tileSources: TileSource[];
  selected: Brush;
  onSelect: (brush: Brush) => void;
  onRotate: (index: number) => void;
  getRotation: (index: number) => number;
  height: number;
};

export function TileBrushPanel({
  tileSources,
  selected,
  onSelect,
  onRotate,
  getRotation,
  height,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showIndicator = contentWidth > containerWidth;

  return (
    <ThemedView
      style={[styles.container, { height }]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={showIndicator}
        onContentSizeChange={(width) => setContentWidth(width)}
        contentContainerStyle={styles.content}
      >
        <ThemedView style={styles.column}>
          {[
            { type: 'random' as const },
            { type: 'erase' as const },
            ...tileSources.map((tile, index) => ({
              type: 'fixed' as const,
              tile,
              index,
            })),
          ].map((entry, idx) => {
            const isRandom = entry.type === 'random';
            const isErase = entry.type === 'erase';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isErase
                ? selected.mode === 'erase'
              : selected.mode === 'fixed' && selected.index === entry.index;
            const isTopRow = idx % 2 === 0;
            const rotation = !isRandom && !isErase ? getRotation(entry.index) : 0;
            return (
              <Pressable
                key={isRandom ? 'random' : isErase ? 'erase' : entry.tile.name}
                onPressIn={() =>
                  onSelect(
                    isRandom
                      ? { mode: 'random' }
                      : isErase
                        ? { mode: 'erase' }
                        : { mode: 'fixed', index: entry.index, rotation }
                  )
                }
                onLongPress={() => {
                  if (!isRandom && !isErase) {
                    onRotate(entry.index);
                  }
                }}
                style={[
                  styles.item,
                  !isSelected && styles.itemDimmed,
                  isSelected && styles.itemSelected,
                  isTopRow ? styles.itemTop : styles.itemBottom,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isRandom
                    ? 'Random brush'
                    : isErase
                      ? 'Erase brush'
                      : `Brush ${entry.tile.name}`
                }
              >
                {isRandom ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Random
                  </ThemedText>
                ) : isErase ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Erase
                  </ThemedText>
                ) : (
                  <ThemedView style={styles.imageBox}>
                    <Image
                      source={entry.tile.source}
                      style={[styles.image, { transform: [{ rotate: `${rotation}deg` }] }]}
                      resizeMode="cover"
                      fadeDuration={0}
                    />
                  </ThemedView>
                )}
              </Pressable>
            );
          })}
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderColor: '#1f1f1f',
    paddingHorizontal: 1,
    paddingVertical: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  column: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    height: 144,
    gap: 1,
  },
  item: {
    height: 64,
    width: 64,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  itemDimmed: {
    opacity: 0.75,
  },
  itemTop: {
    marginBottom: 1,
  },
  itemBottom: {
    marginTop: 0,
  },
  itemSelected: {
    borderColor: '#22c55e',
    borderWidth: 4,
    padding: 0,
  },
  imageBox: {
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  labelText: {
    color: '#fff',
  },
});
