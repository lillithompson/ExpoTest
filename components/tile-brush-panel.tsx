import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { type TileSource } from '@/assets/images/tiles/manifest';

type Brush =
  | { mode: 'random' }
  | { mode: 'erase' }
  | { mode: 'clone' }
  | { mode: 'fixed'; index: number; rotation: number };

type Props = {
  tileSources: TileSource[];
  selected: Brush;
  onSelect: (brush: Brush) => void;
  onRotate: (index: number) => void;
  getRotation: (index: number) => number;
  height: number;
  itemSize: number;
  rowGap: number;
};

export function TileBrushPanel({
  tileSources,
  selected,
  onSelect,
  onRotate,
  getRotation,
  height,
  itemSize,
  rowGap,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showIndicator = contentWidth > containerWidth;
  const columnHeight = itemSize * 2 + rowGap;

  return (
    <ThemedView
      style={[styles.container, { height }]}
      onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={showIndicator}
        onContentSizeChange={(width) => setContentWidth(width)}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInset={{ top: 0, left: 0, bottom: 0, right: 0 }}
        scrollIndicatorInsets={{ top: 0, left: 0, bottom: 0, right: 0 }}
      >
        <ThemedView style={[styles.column, { height: columnHeight }]}>
          {[
            { type: 'random' as const },
            { type: 'erase' as const },
            { type: 'clone' as const },
            ...tileSources.map((tile, index) => ({
              type: 'fixed' as const,
              tile,
              index,
            })),
          ].map((entry, idx) => {
            const isRandom = entry.type === 'random';
            const isErase = entry.type === 'erase';
            const isClone = entry.type === 'clone';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isErase
                ? selected.mode === 'erase'
                : isClone
                  ? selected.mode === 'clone'
                : selected.mode === 'fixed' && selected.index === entry.index;
            const isTopRow = idx % 2 === 0;
            const rotation =
              !isRandom && !isErase && !isClone ? getRotation(entry.index) : 0;
            return (
              <Pressable
                key={
                  isRandom ? 'random' : isErase ? 'erase' : isClone ? 'clone' : entry.tile.name
                }
                onPressIn={() =>
                  onSelect(
                    isRandom
                      ? { mode: 'random' }
                      : isErase
                        ? { mode: 'erase' }
                        : isClone
                          ? { mode: 'clone' }
                        : { mode: 'fixed', index: entry.index, rotation }
                  )
                }
                onLongPress={() => {
                  if (!isRandom && !isErase && !isClone) {
                    onRotate(entry.index);
                  }
                }}
                style={[
                  styles.item,
                  { width: itemSize, height: itemSize },
                  !isSelected && styles.itemDimmed,
                  isSelected && styles.itemSelected,
                  isTopRow ? { marginBottom: rowGap } : styles.itemBottom,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isRandom
                    ? 'Random brush'
                    : isErase
                      ? 'Erase brush'
                      : isClone
                        ? 'Clone brush'
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
                ) : isClone ? (
                  <ThemedText type="defaultSemiBold" style={styles.labelText}>
                    Clone
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
    paddingVertical: 0,
    backgroundColor: '#2a2a2a',
  },
  scroll: {
    backgroundColor: '#2a2a2a',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 0,
    backgroundColor: '#2a2a2a',
  },
  column: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: 0,
    backgroundColor: '#2a2a2a',
  },
  item: {
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
