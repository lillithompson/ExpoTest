import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TileAsset } from '@/components/tile-asset';
import { type TileSource } from '@/assets/images/tiles/manifest';

type Brush =
  | { mode: 'random' }
  | { mode: 'erase' }
  | { mode: 'clone' }
  | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean };

type Props = {
  tileSources: TileSource[];
  selected: Brush;
  onSelect: (brush: Brush) => void;
  onRotate: (index: number) => void;
  onMirror: (index: number) => void;
  getRotation: (index: number) => number;
  getMirror: (index: number) => boolean;
  height: number;
  itemSize: number;
  rowGap: number;
};

export function TileBrushPanel({
  tileSources,
  selected,
  onSelect,
  onRotate,
  onMirror,
  getRotation,
  getMirror,
  height,
  itemSize,
  rowGap,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showIndicator = contentWidth > containerWidth;
  const columnHeight = itemSize * 2 + rowGap;
  const lastTapRef = useRef<{ time: number; index: number } | null>(null);

  return (
    <View
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
        <View style={[styles.column, { height: columnHeight }]}>
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
            const mirrorX =
              !isRandom && !isErase && !isClone ? getMirror(entry.index) : false;
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
                          : { mode: 'fixed', index: entry.index, rotation, mirrorX }
                  )
                }
                onPress={() => {
                  if (isRandom || isErase || isClone) {
                    return;
                  }
                  const now = Date.now();
                  const lastTap = lastTapRef.current;
                  if (lastTap && lastTap.index === entry.index && now - lastTap.time < 260) {
                    onMirror(entry.index);
                    lastTapRef.current = null;
                  } else {
                    lastTapRef.current = { time: now, index: entry.index };
                  }
                }}
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
                  <View style={styles.imageBox}>
                    <TileAsset
                      source={entry.tile.source}
                      name={entry.tile.name}
                      style={[
                        styles.image,
                        {
                          transform: [
                            { scaleX: mirrorX ? -1 : 1 },
                            { rotate: `${rotation}deg` },
                          ],
                        },
                      ]}
                      resizeMode="cover"
                    />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderColor: '#1f1f1f',
    paddingHorizontal: 1,
    paddingVertical: 0,
    backgroundColor: '#3f3f3f',
  },
  scroll: {
    backgroundColor: '#3f3f3f',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 0,
    backgroundColor: '#3f3f3f',
  },
  column: {
    flexDirection: 'column',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: 0,
    backgroundColor: '#3f3f3f',
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
