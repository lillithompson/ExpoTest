import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  TILE_CATEGORIES,
  TILE_MANIFEST,
  type TileCategory,
} from '@/assets/images/tiles/manifest';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import { TileDebugOverlay } from '@/components/tile-debug-overlay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTileGrid } from '@/hooks/use-tile-grid';
import { exportTileCanvasAsPng } from '@/utils/tile-export';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 40;
const TOOLBAR_BUTTON_SIZE = 32;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BLANK_TILE = require('@/assets/images/tiles/tile_blank.png');
const ERROR_TILE = require('@/assets/images/tiles/tile_error.png');

type ToolbarButtonProps = {
  label: string;
  onPress: () => void;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  active?: boolean;
};

function ToolbarButton({ label, onPress, icon, active }: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.resetButton, active && styles.toolbarActive]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={active ? '#22c55e' : '#111'}
      />
      {Platform.OS === 'web' && hovered && (
        <Text style={styles.tooltip} accessibilityElementsHidden>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

type TileCellProps = {
  cellIndex: number;
  tileSize: number;
  tile: Tile;
  tileSources: typeof TILE_MANIFEST[TileCategory];
  showDebug: boolean;
  isCloneSource: boolean;
};

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    isCloneSource,
  }: TileCellProps) => {
    const tileName = tileSources[tile.imageIndex]?.name ?? '';
    const connections = useMemo(
      () =>
        showDebug && tile.imageIndex >= 0
          ? getTransformedConnectionsForName(
              tileName,
              tile.rotation,
              tile.mirrorX,
              tile.mirrorY
            )
          : null,
      [showDebug, tile.imageIndex, tile.mirrorX, tile.mirrorY, tile.rotation, tileName]
    );
    const source =
      tile.imageIndex < 0
        ? tile.imageIndex === -2
          ? ERROR_TILE
          : BLANK_TILE
        : tileSources[tile.imageIndex]?.source ?? ERROR_TILE;

    return (
      <View
        key={`cell-${cellIndex}`}
        accessibilityRole="button"
        accessibilityLabel={`Tile ${cellIndex + 1}`}
        style={[
          styles.tile,
          { width: tileSize, height: tileSize },
          isCloneSource && styles.cloneSource,
        ]}
      >
        <Image
          source={source}
          style={[
            styles.tileImage,
            {
              transform: [
                { scaleX: tile.mirrorX ? -1 : 1 },
                { scaleY: tile.mirrorY ? -1 : 1 },
                { rotate: `${tile.rotation}deg` },
              ],
            },
          ]}
          resizeMode="cover"
          fadeDuration={0}
        />
        {showDebug && <TileDebugOverlay connections={connections} />}
      </View>
    );
  },
  (prev, next) =>
    prev.tile === next.tile &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.tileSources === next.tileSources &&
    prev.isCloneSource === next.isCloneSource
);

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight?.() ?? 0;
  const gridRef = useRef<View>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(
    () => TILE_CATEGORIES[0]
  );
  const [showTileSetOverlay, setShowTileSetOverlay] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [preferredTileSizeInput, setPreferredTileSizeInput] = useState('45');
  const [preferredTileSizeValue, setPreferredTileSizeValue] = useState(45);
  const [aspectPreset, setAspectPreset] = useState<'web' | 'iphone15' | 'ipadpro'>(
    Platform.OS === 'web' ? 'web' : 'iphone15'
  );
  const [mirrorHorizontal, setMirrorHorizontal] = useState(false);
  const [mirrorVertical, setMirrorVertical] = useState(false);
  const [brush, setBrush] = useState<
    | { mode: 'random' }
    | { mode: 'erase' }
    | { mode: 'clone' }
    | { mode: 'fixed'; index: number; rotation: number }
  >({
    mode: 'random',
  });
  const [paletteRotations, setPaletteRotations] = useState<Record<number, number>>(
    {}
  );
  const preferredTileSize = preferredTileSizeValue;
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const isWeb = Platform.OS === 'web';
  const aspectRatio =
    aspectPreset === 'iphone15' ? 2556 / 1179 : aspectPreset === 'ipadpro' ? 2732 / 2048 : null;
  const safeWidth = Math.max(0, width - insets.left - insets.right);
  const safeHeight = Math.max(0, height - insets.top - insets.bottom);
  const contentWidth = aspectRatio
    ? Math.min(safeWidth, safeHeight / aspectRatio)
    : safeWidth;
  const rawContentHeight = aspectRatio ? contentWidth * aspectRatio : safeHeight;
  const contentHeight = Math.max(0, rawContentHeight - tabBarHeight);

  const availableWidth = contentWidth - CONTENT_PADDING * 2;
  const availableHeight = Math.max(
    contentHeight -
      HEADER_HEIGHT -
      CONTENT_PADDING * 2 -
      TITLE_SPACING -
      BRUSH_PANEL_HEIGHT,
    0
  );

  const {
    gridLayout,
    tiles,
    handlePress,
    randomFill,
    floodFill,
    floodComplete,
    resetTiles,
    setCloneSource,
    cloneSourceIndex,
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    preferredTileSize,
    brush,
    mirrorHorizontal,
    mirrorVertical,
  });
  const lastPaintedRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; cellIndex: number } | null>(null);
  const cloneTapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloneTapPendingRef = useRef<{ time: number; cellIndex: number } | null>(
    null
  );
  const preferredSizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowIndices = useMemo(
    () => Array.from({ length: gridLayout.rows }, (_, index) => index),
    [gridLayout.rows]
  );
  const columnIndices = useMemo(
    () => Array.from({ length: gridLayout.columns }, (_, index) => index),
    [gridLayout.columns]
  );

  useEffect(() => {
    if (preferredSizeTimeoutRef.current) {
      clearTimeout(preferredSizeTimeoutRef.current);
    }
    preferredSizeTimeoutRef.current = setTimeout(() => {
      const parsed = Math.floor(Number(preferredTileSizeInput));
      if (!Number.isNaN(parsed)) {
        const clamped = Math.min(512, Math.max(20, parsed));
        if (clamped !== preferredTileSizeValue) {
          setPreferredTileSizeValue(clamped);
        }
        if (String(clamped) !== preferredTileSizeInput) {
          setPreferredTileSizeInput(String(clamped));
        }
      }
    }, 250);

    return () => {
      if (preferredSizeTimeoutRef.current) {
        clearTimeout(preferredSizeTimeoutRef.current);
      }
    };
  }, [preferredTileSizeInput, preferredTileSizeValue]);

  const handleDownload = async () => {
    const result = await exportTileCanvasAsPng({
      tiles,
      gridLayout,
      tileSources,
      gridGap: GRID_GAP,
      blankSource: BLANK_TILE,
      errorSource: ERROR_TILE,
    });
    if (!result.ok) {
      Alert.alert('Download unavailable', result.error);
    }
  };

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
      typeof nativeEvent.pageX === 'number' &&
      typeof nativeEvent.pageY === 'number'
    ) {
      const offset = gridOffsetRef.current;
      return {
        x: nativeEvent.pageX - offset.x,
        y: nativeEvent.pageY - offset.y,
      };
    }
    if (
      typeof nativeEvent.locationX === 'number' &&
      typeof nativeEvent.locationY === 'number'
    ) {
      return { x: nativeEvent.locationX, y: nativeEvent.locationY };
    }
    return null;
  };

  const getCellIndexForPoint = (x: number, y: number) => {
    if (gridLayout.columns === 0 || gridLayout.rows === 0) {
      return null;
    }
    const tileStride = gridLayout.tileSize + GRID_GAP;
    const col = Math.floor(x / (tileStride || 1));
    const row = Math.floor(y / (tileStride || 1));
    if (col < 0 || row < 0 || col >= gridLayout.columns || row >= gridLayout.rows) {
      return null;
    }
    return row * gridLayout.columns + col;
  };

  const paintCellIndex = (cellIndex: number) => {
    if (lastPaintedRef.current === cellIndex) {
      return;
    }
    lastPaintedRef.current = cellIndex;
    handlePress(cellIndex);
  };

  const handleCloneTap = (cellIndex: number) => {
    const now = Date.now();
    const pending = cloneTapPendingRef.current;
    if (
      pending &&
      pending.cellIndex === cellIndex &&
      now - pending.time < 250
    ) {
      if (cloneTapTimeoutRef.current) {
        clearTimeout(cloneTapTimeoutRef.current);
        cloneTapTimeoutRef.current = null;
      }
      cloneTapPendingRef.current = null;
      setCloneSource(cellIndex);
      lastPaintedRef.current = null;
      return;
    }

    if (cloneTapTimeoutRef.current) {
      clearTimeout(cloneTapTimeoutRef.current);
      cloneTapTimeoutRef.current = null;
    }

    cloneTapPendingRef.current = { time: now, cellIndex };
    cloneTapTimeoutRef.current = setTimeout(() => {
      cloneTapTimeoutRef.current = null;
      cloneTapPendingRef.current = null;
      paintCellIndex(cellIndex);
    }, 220);
  };

  const handlePaintAt = (x: number, y: number, options?: { isDoubleTap?: boolean }) => {
    const cellIndex = getCellIndexForPoint(x, y);
    if (cellIndex === null) {
      return;
    }
    if (options?.isDoubleTap && brush.mode === 'clone') {
      setCloneSource(cellIndex);
      lastPaintedRef.current = null;
      return;
    }
    if (brush.mode === 'clone' && cloneTapTimeoutRef.current) {
      clearTimeout(cloneTapTimeoutRef.current);
      cloneTapTimeoutRef.current = null;
      cloneTapPendingRef.current = null;
    }
    paintCellIndex(cellIndex);
  };

  return (
    <ThemedView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
        <ThemedView
          style={[
            styles.contentFrame,
            { width: contentWidth, height: contentHeight },
            aspectPreset !== 'web' && styles.contentFrameBorder,
          ]}
        >
        <ThemedView style={styles.titleContainer}>
          <ThemedView style={styles.controls}>
            <ToolbarButton
              label="Tile Set"
              icon="grid"
              onPress={() => setShowTileSetOverlay(true)}
            />
            <ToolbarButton label="Reset" icon="refresh" onPress={resetTiles} />
            <ToolbarButton
              label="Flood Fill"
              icon="format-color-fill"
              onPress={floodFill}
            />
            <ToolbarButton
              label="Flood Complete"
              icon="checkbox-multiple-marked"
              onPress={floodComplete}
            />
            <ToolbarButton
              label="Settings"
              icon="cog"
              onPress={() => setShowSettingsOverlay(true)}
            />
            <ToolbarButton
              label="Mirror Horizontal"
              icon="flip-horizontal"
              active={mirrorHorizontal}
              onPress={() => setMirrorHorizontal((prev) => !prev)}
            />
            <ToolbarButton
              label="Mirror Vertical"
              icon="flip-vertical"
              active={mirrorVertical}
              onPress={() => setMirrorVertical((prev) => !prev)}
            />
          </ThemedView>
        </ThemedView>
        <ThemedView
          ref={gridRef}
          style={[
            styles.grid,
            {
              height: availableHeight,
              width:
                gridLayout.columns * gridLayout.tileSize +
                GRID_GAP * Math.max(0, gridLayout.columns - 1),
            },
          ]}
          accessibilityRole="grid"
          onLayout={() => {
            gridRef.current?.measureInWindow((x: number, y: number) => {
              gridOffsetRef.current = { x, y };
            });
          }}
          {...(!isWeb
            ? {
                onStartShouldSetResponderCapture: () => true,
                onMoveShouldSetResponderCapture: () => true,
                onResponderGrant: (event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    const now = Date.now();
                    const lastTap = lastTapRef.current;
                    const isDoubleTap =
                      brush.mode === 'clone' &&
                      lastTap &&
                      lastTap.cellIndex === cellIndex &&
                      now - lastTap.time < 350;
                    lastTapRef.current = { time: now, cellIndex };
                    if (isDoubleTap) {
                      handleCloneTap(cellIndex);
                      return;
                    }
                    if (brush.mode === 'clone') {
                      handleCloneTap(cellIndex);
                      return;
                    }
                    paintCellIndex(cellIndex);
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
                    const cellIndex = getCellIndexForPoint(point.x, point.y);
                    if (cellIndex === null) {
                      return;
                    }
                    if (brush.mode === 'clone') {
                      handleCloneTap(cellIndex);
                      return;
                    }
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
          {rowIndices.map((rowIndex) => (
            <ThemedView key={`row-${rowIndex}`} style={styles.row}>
              {columnIndices.map((columnIndex) => {
                const cellIndex = rowIndex * gridLayout.columns + columnIndex;
                const item = tiles[cellIndex];
                return (
                  <TileCell
                    key={`cell-${cellIndex}`}
                    cellIndex={cellIndex}
                    tileSize={gridLayout.tileSize}
                    tile={item}
                    tileSources={tileSources}
                    showDebug={showDebug}
                    isCloneSource={brush.mode === 'clone' && cloneSourceIndex === cellIndex}
                  />
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
        {showTileSetOverlay && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowTileSetOverlay(false)}
              accessibilityRole="button"
              accessibilityLabel="Close tile set chooser"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">Choose Tile Set</ThemedText>
              <ThemedView style={styles.overlayList}>
                {TILE_CATEGORIES.map((category) => (
                  <Pressable
                    key={category}
                    onPress={() => {
                      setSelectedCategory(category);
                      setShowTileSetOverlay(false);
                    }}
                    style={[
                      styles.overlayItem,
                      category === selectedCategory && styles.overlayItemSelected,
                    ]}
                  >
                    <ThemedText type="defaultSemiBold">{category}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            </ThemedView>
          </ThemedView>
        )}
        {showSettingsOverlay && (
          <ThemedView style={styles.overlay} accessibilityRole="dialog">
            <Pressable
              style={styles.overlayBackdrop}
              onPress={() => setShowSettingsOverlay(false)}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            />
            <ThemedView style={styles.overlayPanel}>
              <ThemedText type="title">Settings</ThemedText>
              <ThemedView style={styles.inputGroup}>
                <ThemedText type="defaultSemiBold">Preferred Tile Size</ThemedText>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  value={preferredTileSizeInput}
                  onChangeText={setPreferredTileSizeInput}
                  onEndEditing={() => {
                    const parsed = Math.floor(Number(preferredTileSizeInput));
                    if (!Number.isNaN(parsed)) {
                      const clamped = Math.min(512, Math.max(20, parsed));
                      setPreferredTileSizeValue(clamped);
                      if (String(clamped) !== preferredTileSizeInput) {
                        setPreferredTileSizeInput(String(clamped));
                      }
                    }
                  }}
                  accessibilityLabel="Preferred tile size"
                />
              </ThemedView>
              <ThemedView style={styles.presetGroup}>
                <ThemedText type="defaultSemiBold">Aspect Ratio</ThemedText>
                <ThemedView style={styles.presetButtons}>
                  {[
                    { key: 'iphone15' as const, label: 'iPhone 15' },
                    { key: 'ipadpro' as const, label: 'iPad Pro' },
                    { key: 'web' as const, label: 'Web' },
                  ].map((preset) => (
                    <Pressable
                      key={preset.key}
                      onPress={() => setAspectPreset(preset.key)}
                      style={[
                        styles.resetButton,
                        aspectPreset === preset.key && styles.overlayItemSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set aspect ratio to ${preset.label}`}
                    >
                      <ThemedText type="defaultSemiBold">{preset.label}</ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>
              </ThemedView>
              <Pressable
                onPress={handleDownload}
                style={styles.resetButton}
                accessibilityRole="button"
                accessibilityLabel="Download tile canvas"
              >
                <ThemedText type="defaultSemiBold">Download PNG</ThemedText>
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
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: HEADER_HEIGHT,
    zIndex: 10,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    width: '100%',
    overflow: 'visible',
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
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    position: 'relative',
  },
  toolbarActive: {
    borderColor: '#22c55e',
  },
  tooltip: {
    position: 'absolute',
    bottom: -22,
    right: 0,
    backgroundColor: '#111',
    color: '#fff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontSize: 11,
    zIndex: 50,
    pointerEvents: 'none',
    whiteSpace: 'nowrap' as never,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  overlayPanel: {
    width: '85%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  overlayList: {
    gap: 8,
  },
  overlayItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  overlayItemSelected: {
    borderColor: '#22c55e',
  },
  screen: {
    flex: 1,
  },
  contentFrame: {
    alignSelf: 'center',
    position: 'relative',
  },
  contentFrameBorder: {
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  presetGroup: {
    gap: 8,
  },
  presetButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  cloneSource: {
    borderColor: '#3b82f6',
    borderWidth: 2,
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
