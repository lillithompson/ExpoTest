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
import { usePersistedSettings } from '@/hooks/use-persisted-settings';
import { exportTileCanvasAsPng } from '@/utils/tile-export';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';

const GRID_GAP = 0;
const CONTENT_PADDING = 0;
const HEADER_HEIGHT = 50;
const TOOLBAR_BUTTON_SIZE = 40;
const TITLE_SPACING = 0;
const BRUSH_PANEL_HEIGHT = 160;
const BRUSH_PANEL_ROW_GAP = 1;
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
      style={styles.toolbarButton}
      accessibilityRole="button"
      accessibilityLabel={label}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      <MaterialCommunityIcons
        name={icon}
        size={28}
        color={active ? '#22c55e' : 'rgba(42, 42, 42, 0.8)'}
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
  isCloneSample: boolean;
  isCloneTargetOrigin: boolean;
  isCloneCursor: boolean;
};

const TileCell = memo(
  ({
    cellIndex,
    tileSize,
    tile,
    tileSources,
    showDebug,
    isCloneSource,
    isCloneSample,
    isCloneTargetOrigin,
    isCloneCursor,
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
        {isCloneTargetOrigin && (
          <View pointerEvents="none" style={styles.cloneTargetOrigin} />
        )}
        {isCloneCursor && <View pointerEvents="none" style={styles.cloneCursor} />}
        {isCloneSample && <View pointerEvents="none" style={styles.cloneSample} />}
        {showDebug && <TileDebugOverlay connections={connections} />}
      </View>
    );
  },
  (prev, next) =>
    prev.tile === next.tile &&
    prev.tileSize === next.tileSize &&
    prev.showDebug === next.showDebug &&
    prev.tileSources === next.tileSources &&
    prev.isCloneSource === next.isCloneSource &&
    prev.isCloneSample === next.isCloneSample &&
    prev.isCloneTargetOrigin === next.isCloneTargetOrigin &&
    prev.isCloneCursor === next.isCloneCursor
);

export default function TestScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 0;
  const gridRef = useRef<View>(null);
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const { settings, setSettings } = usePersistedSettings();
  const [selectedCategory, setSelectedCategory] = useState<TileCategory>(() => {
    const defaultCategory = TILE_CATEGORIES[0];
    if (!settings.selectedTileCategory) {
      return defaultCategory;
    }
    return TILE_CATEGORIES.includes(settings.selectedTileCategory as TileCategory)
      ? (settings.selectedTileCategory as TileCategory)
      : defaultCategory;
  });
  const [showTileSetOverlay, setShowTileSetOverlay] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [preferredTileSizeInput, setPreferredTileSizeInput] = useState(
    String(settings.preferredTileSize)
  );
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
  const preferredTileSize = settings.preferredTileSize;
  const tileSources = TILE_MANIFEST[selectedCategory] ?? [];
  const isWeb = Platform.OS === 'web';
  const shouldUseAspectRatio = isWeb;
  const aspectRatio = shouldUseAspectRatio
    ? settings.aspectPreset === 'iphone15'
      ? 2556 / 1179
      : settings.aspectPreset === 'ipadpro'
        ? 2732 / 2048
        : null
    : null;
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height - insets.top);
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
    clearCloneSource,
    setCloneSource,
    cloneSourceIndex,
    cloneSampleIndex,
    cloneAnchorIndex,
    cloneCursorIndex,
  } = useTileGrid({
    tileSources,
    availableWidth,
    availableHeight,
    gridGap: GRID_GAP,
    preferredTileSize,
    allowEdgeConnections: settings.allowEdgeConnections,
    brush,
    mirrorHorizontal: settings.mirrorHorizontal,
    mirrorVertical: settings.mirrorVertical,
  });
  const gridHeight =
    gridLayout.rows * gridLayout.tileSize +
    GRID_GAP * Math.max(0, gridLayout.rows - 1);
  const brushPanelHeight = Math.max(
    0,
    contentHeight - HEADER_HEIGHT - CONTENT_PADDING * 2 - TITLE_SPACING - gridHeight
  );
  const brushItemSize = Math.max(
    0,
    Math.floor((brushPanelHeight - BRUSH_PANEL_ROW_GAP) / 2)
  );
  const lastPaintedRef = useRef<number | null>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
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
    if (
      settings.selectedTileCategory &&
      settings.selectedTileCategory !== selectedCategory &&
      TILE_CATEGORIES.includes(settings.selectedTileCategory as TileCategory)
    ) {
      setSelectedCategory(settings.selectedTileCategory as TileCategory);
    }
  }, [selectedCategory, settings.selectedTileCategory]);

  useEffect(() => {
    setPreferredTileSizeInput(String(settings.preferredTileSize));
  }, [settings.preferredTileSize]);

  useEffect(() => {
    if (brush.mode !== 'clone') {
      clearCloneSource();
    }
  }, [brush.mode, clearCloneSource]);

  useEffect(() => {
    if (preferredSizeTimeoutRef.current) {
      clearTimeout(preferredSizeTimeoutRef.current);
    }
    preferredSizeTimeoutRef.current = setTimeout(() => {
      const parsed = Math.floor(Number(preferredTileSizeInput));
      if (!Number.isNaN(parsed)) {
        const clamped = Math.min(512, Math.max(20, parsed));
        if (clamped !== settings.preferredTileSize) {
          setSettings((prev) => ({ ...prev, preferredTileSize: clamped }));
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
  }, [preferredTileSizeInput, settings.preferredTileSize, setSettings]);

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

  const handlePaintAt = (x: number, y: number) => {
    const cellIndex = getCellIndexForPoint(x, y);
    if (cellIndex === null) {
      return;
    }
    paintCellIndex(cellIndex);
  };

  return (
    <ThemedView
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingBottom: 0,
          paddingLeft: 0,
          paddingRight: 0,
        },
      ]}
    >
      {insets.top > 0 && (
        <View
          pointerEvents="none"
          style={[styles.statusBarBackground, { height: insets.top }]}
        />
      )}
        <ThemedView
          style={[
            styles.contentFrame,
            { width: contentWidth, height: contentHeight },
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
              label="Flood Complete"
              icon="format-color-fill"
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
              active={settings.mirrorHorizontal}
              onPress={() =>
                setSettings((prev) => ({
                  ...prev,
                  mirrorHorizontal: !prev.mirrorHorizontal,
                }))
              }
            />
            <ToolbarButton
              label="Mirror Vertical"
              icon="flip-vertical"
              active={settings.mirrorVertical}
              onPress={() =>
                setSettings((prev) => ({
                  ...prev,
                  mirrorVertical: !prev.mirrorVertical,
                }))
              }
            />
          </ThemedView>
        </ThemedView>
        <ThemedView
          ref={gridRef}
          style={[
            styles.grid,
            {
              height: gridHeight,
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
                    if (longPressTimeoutRef.current) {
                      clearTimeout(longPressTimeoutRef.current);
                    }
                    longPressTriggeredRef.current = false;
                    longPressTimeoutRef.current = setTimeout(() => {
                      longPressTriggeredRef.current = true;
                      if (brush.mode === 'clone') {
                        setCloneSource(cellIndex);
                        lastPaintedRef.current = null;
                      }
                    }, 420);
                    if (brush.mode !== 'clone') {
                      paintCellIndex(cellIndex);
                    } else if (cloneSourceIndex === null) {
                      setCloneSource(cellIndex);
                      lastPaintedRef.current = null;
                    }
                  }
                },
                onResponderMove: (event: any) => {
                  const point = getRelativePoint(event);
                  if (point) {
                    if (longPressTimeoutRef.current) {
                      clearTimeout(longPressTimeoutRef.current);
                      longPressTimeoutRef.current = null;
                    }
                    handlePaintAt(point.x, point.y);
                  }
                },
                onResponderRelease: () => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  if (brush.mode === 'clone' && !longPressTriggeredRef.current) {
                    lastPaintedRef.current = null;
                  }
                  lastPaintedRef.current = null;
                },
                onResponderTerminate: () => {
                  if (longPressTimeoutRef.current) {
                    clearTimeout(longPressTimeoutRef.current);
                    longPressTimeoutRef.current = null;
                  }
                  longPressTriggeredRef.current = false;
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
                    if (brush.mode === 'clone' && cloneSourceIndex === null) {
                      setCloneSource(cellIndex);
                      lastPaintedRef.current = null;
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
          {(settings.mirrorHorizontal || settings.mirrorVertical) && (
            <ThemedView pointerEvents="none" style={styles.mirrorLines}>
              {settings.mirrorVertical && (
                <ThemedView
                  style={[
                    styles.mirrorLineHorizontal,
                    { top: gridLayout.tileSize * (gridLayout.rows / 2) },
                  ]}
                />
              )}
              {settings.mirrorHorizontal && (
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
                    showDebug={settings.showDebug}
                    isCloneSource={brush.mode === 'clone' && cloneSourceIndex === cellIndex}
                    isCloneSample={brush.mode === 'clone' && cloneSampleIndex === cellIndex}
                    isCloneTargetOrigin={
                      brush.mode === 'clone' && cloneAnchorIndex === cellIndex
                    }
                    isCloneCursor={
                      brush.mode === 'clone' && cloneCursorIndex === cellIndex
                    }
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
            if (next.mode === 'clone') {
              clearCloneSource();
            }
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
          height={brushPanelHeight}
          itemSize={brushItemSize}
          rowGap={BRUSH_PANEL_ROW_GAP}
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
                      setSettings((prev) => ({
                        ...prev,
                        selectedTileCategory: category,
                      }));
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
                      setSettings((prev) => ({ ...prev, preferredTileSize: clamped }));
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
                      onPress={() =>
                        setSettings((prev) => ({ ...prev, aspectPreset: preset.key }))
                      }
                      style={[
                        styles.resetButton,
                        settings.aspectPreset === preset.key && styles.overlayItemSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set aspect ratio to ${preset.label}`}
                    >
                      <ThemedText type="defaultSemiBold">{preset.label}</ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>
              </ThemedView>
              <ThemedView style={styles.inputGroup}>
                <ThemedText type="defaultSemiBold">AllowEdgeConections</ThemedText>
                <Pressable
                  onPress={() =>
                    setSettings((prev) => ({
                      ...prev,
                      allowEdgeConnections: !prev.allowEdgeConnections,
                    }))
                  }
                  style={styles.resetButton}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle edge connections"
                >
                  <ThemedText type="defaultSemiBold">
                    {settings.allowEdgeConnections ? 'On' : 'Off'}
                  </ThemedText>
                </Pressable>
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
                onPress={() =>
                  setSettings((prev) => ({ ...prev, showDebug: !prev.showDebug }))
                }
                style={styles.resetButton}
                accessibilityRole="button"
                accessibilityLabel="Toggle debug overlay"
              >
                <ThemedText type="defaultSemiBold">
                  {settings.showDebug ? 'Hide Debug' : 'Show Debug'}
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
    gap: 2,
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
  toolbarButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
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
    backgroundColor: '#3F3F3F',
  },
  statusBarBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    zIndex: 5,
  },
  contentFrame: {
    alignSelf: 'center',
    position: 'relative',
    backgroundColor: '#3F3F3F',
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
    backgroundColor: '#3F3F3F',
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
  cloneSample: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  cloneTargetOrigin: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  cloneCursor: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
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
