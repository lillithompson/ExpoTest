import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TileAsset } from '@/components/tile-asset';
import { type TileSource } from '@/assets/images/tiles/manifest';

type Brush =
  | { mode: 'random' }
  | { mode: 'erase' }
  | { mode: 'clone' }
  | { mode: 'pattern' }
  | { mode: 'fixed'; index: number; rotation: number; mirrorX: boolean };

type Props = {
  tileSources: TileSource[];
  selected: Brush;
  selectedPattern?: {
    tiles: { imageIndex: number; rotation: number; mirrorX: boolean; mirrorY: boolean }[];
    width: number;
    height: number;
    rotation: number;
    mirrorX: boolean;
  } | null;
  onSelect: (brush: Brush) => void;
  onRotate: (index: number) => void;
  onMirror: (index: number) => void;
  onPatternLongPress?: () => void;
  getRotation: (index: number) => number;
  getMirror: (index: number) => boolean;
  height: number;
  itemSize: number;
  rowGap: number;
  rows?: number;
  showPattern?: boolean;
};

export function TileBrushPanel({
  tileSources,
  selected,
  selectedPattern,
  onSelect,
  onRotate,
  onMirror,
  onPatternLongPress,
  getRotation,
  getMirror,
  height,
  itemSize,
  rowGap,
  rows = 2,
  showPattern = true,
}: Props) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const showIndicator = contentWidth > containerWidth;
  const rowCount = Math.max(1, rows);
  const columnHeight = itemSize * rowCount + rowGap * Math.max(0, rowCount - 1);
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
            { type: 'clone' as const },
            { type: 'erase' as const },
          ...(showPattern ? [{ type: 'pattern' as const }] : []),
            ...tileSources.map((tile, index) => ({
              type: 'fixed' as const,
              tile,
              index,
            })),
          ].map((entry, idx) => {
            const isRandom = entry.type === 'random';
            const isErase = entry.type === 'erase';
            const isClone = entry.type === 'clone';
            const isPattern = entry.type === 'pattern';
            const isSelected = isRandom
              ? selected.mode === 'random'
              : isErase
                ? selected.mode === 'erase'
                : isClone
                  ? selected.mode === 'clone'
                  : isPattern
                    ? selected.mode === 'pattern'
                    : selected.mode === 'fixed' && selected.index === entry.index;
            const rowIndex = idx % rowCount;
            const isLastRow = rowIndex === rowCount - 1;
            const rotation =
              !isRandom && !isErase && !isClone && !isPattern
                ? getRotation(entry.index)
                : 0;
            const mirrorX =
              !isRandom && !isErase && !isClone && !isPattern
                ? getMirror(entry.index)
                : false;
            const previewRotationCW = ((selectedPattern?.rotation ?? 0) + 360) % 360;
            const previewRotationCCW = (360 - previewRotationCW) % 360;
            const previewMirrorX = selectedPattern?.mirrorX ?? false;
            const previewWidth =
              previewRotationCW % 180 === 0
                ? selectedPattern?.width ?? 0
                : selectedPattern?.height ?? 0;
            const previewHeight =
              previewRotationCW % 180 === 0
                ? selectedPattern?.height ?? 0
                : selectedPattern?.width ?? 0;
            const previewMax = Math.max(10, Math.floor(itemSize * 0.6));
            const previewTileSize = Math.max(
              4,
              Math.floor(previewMax / Math.max(1, previewHeight))
            );
            return (
              <Pressable
                key={
                  isRandom
                    ? 'random'
                    : isErase
                      ? 'erase'
                      : isClone
                        ? 'clone'
                        : isPattern
                          ? 'pattern'
                          : `tile-${entry.index}`
                }
                onPressIn={() =>
                  onSelect(
                    isRandom
                      ? { mode: 'random' }
                      : isErase
                        ? { mode: 'erase' }
                        : isClone
                          ? { mode: 'clone' }
                          : isPattern
                            ? { mode: 'pattern' }
                            : { mode: 'fixed', index: entry.index, rotation, mirrorX }
                  )
                }
                onPress={() => {
                  if (isRandom || isErase || isClone || isPattern) {
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
                  if (isPattern) {
                    onPatternLongPress?.();
                    return;
                  }
                  if (!isRandom && !isErase && !isClone) {
                    onRotate(entry.index);
                  }
                }}
                style={[
                  styles.item,
                  { width: itemSize, height: itemSize },
                  !isSelected && styles.itemDimmed,
                  isSelected && styles.itemSelected,
                  !isLastRow ? { marginBottom: rowGap } : styles.itemBottom,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isRandom
                    ? 'Random brush'
                    : isErase
                      ? 'Erase brush'
                      : isClone
                        ? 'Clone brush'
                        : isPattern
                          ? 'Pattern brush'
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
                ) : isPattern ? (
                  <View style={styles.patternButton}>
                    <ThemedText type="defaultSemiBold" style={styles.labelText}>
                      Pattern
                    </ThemedText>
                    {selectedPattern && previewWidth > 0 && previewHeight > 0 && (
                      <View
                        style={{
                          width: previewWidth * previewTileSize,
                          height: previewHeight * previewTileSize,
                          flexDirection: 'column',
                        }}
                      >
                        {Array.from({ length: previewHeight }, (_, rowIndex) => (
                          <View
                            key={`pattern-preview-row-${rowIndex}`}
                            style={{ flexDirection: 'row' }}
                          >
                            {Array.from({ length: previewWidth }, (_, colIndex) => {
                              let mappedRow = rowIndex;
                              let mappedCol = colIndex;
                              if (previewMirrorX) {
                                mappedCol = previewWidth - 1 - mappedCol;
                              }
                              let sourceRow = mappedRow;
                              let sourceCol = mappedCol;
                              if (previewRotationCCW === 90) {
                                sourceRow = mappedCol;
                                sourceCol =
                                  (selectedPattern?.width ?? 0) - 1 - mappedRow;
                              } else if (previewRotationCCW === 180) {
                                sourceRow =
                                  (selectedPattern?.height ?? 0) - 1 - mappedRow;
                                sourceCol =
                                  (selectedPattern?.width ?? 0) - 1 - mappedCol;
                              } else if (previewRotationCCW === 270) {
                                sourceRow =
                                  (selectedPattern?.height ?? 0) - 1 - mappedCol;
                                sourceCol = mappedRow;
                              }
                              const index =
                                sourceRow * (selectedPattern?.width ?? 0) + sourceCol;
                              const tile = selectedPattern?.tiles[index];
                              const tileName =
                                tile && tile.imageIndex >= 0
                                  ? tileSources[tile.imageIndex]?.name ?? ''
                                  : '';
                              const source =
                                tile && tile.imageIndex >= 0
                                  ? tileSources[tile.imageIndex]?.source ?? null
                                  : null;
                              return (
                                <View
                                  key={`pattern-preview-cell-${rowIndex}-${colIndex}`}
                                  style={{
                                    width: previewTileSize,
                                    height: previewTileSize,
                                    backgroundColor: 'transparent',
                                  }}
                                >
                                  {source && tile && (
                                    <TileAsset
                                      source={source}
                                      name={tileName}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        transform: [
                                          { scaleX: tile.mirrorX ? -1 : 1 },
                                          { scaleY: tile.mirrorY ? -1 : 1 },
                                          { rotate: `${(tile.rotation + previewRotationCW) % 360}deg` },
                                        ],
                                      }}
                                      resizeMode="cover"
                                    />
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
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
  patternButton: {
    alignItems: 'center',
    gap: 4,
  },
});
