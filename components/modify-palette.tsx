/**
 * Single shared palette control for both File Modify and Tile Modify views.
 * Renders TileBrushPanel plus pattern chooser and pattern properties modals.
 * Section expand/collapse state is persisted in TileBrushPanel so it stays the same in both views.
 */

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PALETTE_FLICKER_DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { type TileCategory, type TileSource } from '@/assets/images/tiles/manifest';
import { PatternThumbnail } from '@/components/pattern-thumbnail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TileBrushPanel } from '@/components/tile-brush-panel';
import type { TilePattern } from '@/hooks/use-tile-patterns';
import { type Tile } from '@/utils/tile-grid';
import { type TileAtlas } from '@/utils/tile-atlas';

const PATTERN_THUMB_HEIGHT = 70;
const PATTERN_THUMB_PADDING = 4;
const PATTERN_ORIENTATION_VARIANTS: Array<{
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
}> = [
  { rotation: 0, mirrorX: false, mirrorY: false },
  { rotation: 90, mirrorX: false, mirrorY: false },
  { rotation: 180, mirrorX: false, mirrorY: false },
  { rotation: 270, mirrorX: false, mirrorY: false },
  { rotation: 0, mirrorX: true, mirrorY: false },
  { rotation: 90, mirrorX: true, mirrorY: false },
  { rotation: 180, mirrorX: true, mirrorY: false },
  { rotation: 270, mirrorX: true, mirrorY: false },
];

export type ModifyPaletteProps = {
  tileSources: TileSource[];
  selected: Parameters<typeof TileBrushPanel>[0]['selected'];
  strokeColor?: string;
  strokeWidth?: number;
  strokeScaleByName?: Map<string, number>;
  atlas?: TileAtlas | null;
  height: number;
  itemSize: number;
  rowGap: number;
  rows?: number;
  onSelect: (brush: Parameters<typeof TileBrushPanel>[0]['selected']) => void;
  onRotate: (index: number) => void;
  onMirror: (index: number) => void;
  onMirrorVertical: (index: number) => void;
  getRotation: (index: number) => number;
  getMirror: (index: number) => boolean;
  getMirrorVertical: (index: number) => boolean;
  onSetOrientation?: (index: number, orientation: { rotation: number; mirrorX: boolean; mirrorY: boolean }) => void;
  onPatternPress?: () => void;
  onPatternLongPress?: () => void;
  onPatternDoubleTap?: () => void;
  onRandomLongPress?: () => void;
  onRandomDoubleTap?: () => void;
  /** Pattern data and API (same hook in both File and Tile Modify) */
  activePatterns: TilePattern[];
  createPattern: (payload: {
    name?: string;
    category: TileCategory;
    width: number;
    height: number;
    tiles: Tile[];
    tileSetIds?: string[];
  }) => string;
  deletePatterns: (ids: string[]) => void;
  resolvePatternTile: (tile: Tile) => { source: unknown | null; name: string };
  resolveTileForPatternList: (
    tile: Tile,
    tileSetIds: string[] | undefined
  ) => { source: unknown | null; name: string };
  /** Called when user taps Create in pattern chooser. Call closeChooser() to close; return new pattern id to select it (e.g. Tile Modify). */
  onCreatePatternPress: (closeChooser: () => void) => string | void;
  /** When true, pattern chooser modal is not shown (e.g. File Modify during pattern creation mode). */
  hidePatternChooserWhen?: boolean;
  showImportInChooser?: boolean;
  onImportPatternPress?: () => void;
  showExportInChooser?: boolean;
  /** Called with currently selected pattern ids when user taps Export in select bar. */
  onExportPatternPress?: (selectedIds: string[]) => void;
  onDismissPatternChooser?: () => void;
  dismissModifyBanner?: () => void;
  /** Controlled pattern state (for grid sync). When provided, palette uses these and calls the change handlers. */
  selectedPatternId?: string | null;
  patternRotations?: Record<string, number>;
  patternMirrors?: Record<string, boolean>;
  onSelectedPatternIdChange?: (id: string | null) => void;
  onPatternRotationsChange?: (r: Record<string, number>) => void;
  onPatternMirrorsChange?: (m: Record<string, boolean>) => void;
  /** Called when pattern selection or orientation changes (uncontrolled mode). Parent can sync grid state. */
  onPatternChange?: (data: {
    selectedPatternId: string | null;
    patternRotations: Record<string, number>;
    patternMirrors: Record<string, boolean>;
  }) => void;
  onPatternStampDragStart?: (patternId: string, rotation: number, mirrorX: boolean) => void;
  onPatternStampDragMove?: (screenX: number, screenY: number) => void;
  onPatternStampDragEnd?: (screenX: number, screenY: number) => void;
  onPatternStampDragCancel?: () => void;
};

function ModifyPaletteInner({
  tileSources,
  selected,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
  atlas,
  height,
  itemSize,
  rowGap,
  rows = 2,
  onSelect,
  onRotate,
  onMirror,
  onMirrorVertical,
  getRotation,
  getMirror,
  getMirrorVertical,
  onSetOrientation,
  onPatternPress,
  onPatternLongPress,
  onPatternDoubleTap,
  onRandomLongPress,
  onRandomDoubleTap,
  activePatterns,
  createPattern,
  deletePatterns,
  resolvePatternTile,
  resolveTileForPatternList,
  onCreatePatternPress,
  hidePatternChooserWhen = false,
  showImportInChooser = false,
  onImportPatternPress,
  showExportInChooser = false,
  onExportPatternPress,
  onDismissPatternChooser,
  dismissModifyBanner,
  selectedPatternId: controlledSelectedPatternId,
  patternRotations: controlledPatternRotations,
  patternMirrors: controlledPatternMirrors,
  onSelectedPatternIdChange,
  onPatternRotationsChange,
  onPatternMirrorsChange,
  onPatternChange,
  onPatternStampDragStart,
  onPatternStampDragMove,
  onPatternStampDragEnd,
  onPatternStampDragCancel,
}: ModifyPaletteProps) {
  const modifyPaletteRenderCountRef = useRef(0);
  const lastModifyPaletteLogRef = useRef(0);
  modifyPaletteRenderCountRef.current += 1;
  if (PALETTE_FLICKER_DEBUG) {
    const now = Date.now();
    if (now - lastModifyPaletteLogRef.current > 2000) {
      lastModifyPaletteLogRef.current = now;
      console.warn('[ModifyPalette] render', { renderCount: modifyPaletteRenderCountRef.current });
    }
  }
  const [internalSelectedPatternId, setInternalSelectedPatternId] = useState<string | null>(null);
  const [internalPatternRotations, setInternalPatternRotations] = useState<Record<string, number>>({});
  const [internalPatternMirrors, setInternalPatternMirrors] = useState<Record<string, boolean>>({});
  const isControlled =
    controlledSelectedPatternId !== undefined &&
    controlledPatternRotations !== undefined &&
    controlledPatternMirrors !== undefined;
  const selectedPatternId = isControlled ? controlledSelectedPatternId ?? null : internalSelectedPatternId;
  const patternRotations = isControlled ? controlledPatternRotations ?? {} : internalPatternRotations;
  const patternMirrors = isControlled ? controlledPatternMirrors ?? {} : internalPatternMirrors;
  const setSelectedPatternId = isControlled
    ? (id: string | null) => onSelectedPatternIdChange?.(id)
    : setInternalSelectedPatternId;
  const setPatternRotations = isControlled
    ? (r: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) =>
        onPatternRotationsChange?.(typeof r === 'function' ? r(patternRotations) : r)
    : setInternalPatternRotations;
  const setPatternMirrors = isControlled
    ? (m: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) =>
        onPatternMirrorsChange?.(typeof m === 'function' ? m(patternMirrors) : m)
    : setInternalPatternMirrors;
  const [showPatternChooser, setShowPatternChooser] = useState(false);
  const [isPatternSelectMode, setIsPatternSelectMode] = useState(false);
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(new Set());
  const [patternPropertiesDialogPatternId, setPatternPropertiesDialogPatternId] =
    useState<string | null>(null);
  const patternSelectAnim = useRef(new Animated.Value(0)).current;
  const patternLastTapRef = useRef<{ id: string; time: number } | null>(null);

  const selectedPattern = useMemo(() => {
    if (!selectedPatternId) return activePatterns[0] ?? null;
    return activePatterns.find((p) => p.id === selectedPatternId) ?? activePatterns[0] ?? null;
  }, [activePatterns, selectedPatternId]);

  const patternListForPalette = useMemo(
    () =>
      activePatterns.map((p) => ({
        id: p.id,
        pattern: { tiles: p.tiles, width: p.width, height: p.height },
        rotation: patternRotations[p.id] ?? 0,
        mirrorX: patternMirrors[p.id] ?? false,
        tileSetIds: p.tileSetIds,
      })),
    [activePatterns, patternRotations, patternMirrors]
  );

  const patternThumbnailNode: ReactNode = useMemo(() => {
    if (!selectedPattern || !strokeColor || strokeWidth == null) return undefined;
    const rotationCW = ((patternRotations[selectedPattern.id] ?? 0) + 360) % 360;
    const mirrorX = patternMirrors[selectedPattern.id] ?? false;
    const rotatedW = rotationCW % 180 === 0 ? selectedPattern.width : selectedPattern.height;
    const rotatedH = rotationCW % 180 === 0 ? selectedPattern.height : selectedPattern.width;
    return (
      <PatternThumbnail
        pattern={selectedPattern}
        rotationCW={rotationCW}
        mirrorX={mirrorX}
        tileSize={Math.max(4, Math.floor(60 / Math.max(1, Math.max(rotatedW, rotatedH))))}
        resolveTile={resolvePatternTile}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        strokeScaleByName={strokeScaleByName}
      />
    );
  }, [
    selectedPattern,
    patternRotations,
    patternMirrors,
    resolvePatternTile,
    strokeColor,
    strokeWidth,
    strokeScaleByName,
  ]);

  useEffect(() => {
    if (activePatterns.length === 0) {
      if (selectedPatternId !== null) setSelectedPatternId(null);
      return;
    }
    const cur = activePatterns.find((p) => p.id === selectedPatternId);
    if (!cur && selected.mode === 'pattern') {
      setSelectedPatternId(activePatterns[0].id);
    }
  }, [activePatterns, selectedPatternId, selected.mode]);

  useEffect(() => {
    if (selected.mode === 'pattern' && activePatterns.length === 0) {
      setShowPatternChooser(true);
    }
  }, [selected.mode, activePatterns.length]);

  useEffect(() => {
    Animated.timing(patternSelectAnim, {
      toValue: isPatternSelectMode ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [isPatternSelectMode, patternSelectAnim]);

  useEffect(() => {
    if (!isControlled) {
      onPatternChange?.({
        selectedPatternId,
        patternRotations,
        patternMirrors,
      });
    }
  }, [
    isControlled,
    selectedPatternId,
    patternRotations,
    patternMirrors,
    onPatternChange,
  ]);

  const toggleSelectPattern = useCallback((patternId: string) => {
    setSelectedPatternIds((prev) => {
      const next = new Set(prev);
      if (next.has(patternId)) next.delete(patternId);
      else next.add(patternId);
      return next;
    });
  }, []);

  const clearPatternSelection = useCallback(() => {
    setSelectedPatternIds(new Set());
    setIsPatternSelectMode(false);
  }, []);

  const deleteSelectedPatterns = useCallback(() => {
    if (selectedPatternIds.size === 0) {
      clearPatternSelection();
      return;
    }
    deletePatterns(Array.from(selectedPatternIds));
    clearPatternSelection();
  }, [selectedPatternIds, deletePatterns, clearPatternSelection]);

  const closeChooser = useCallback(() => {
    setShowPatternChooser(false);
    clearPatternSelection();
    onDismissPatternChooser?.();
  }, [onDismissPatternChooser]);

  const showPatternModal =
    showPatternChooser && selected.mode === 'pattern' && !hidePatternChooserWhen;

  return (
    <>
      <TileBrushPanel
        tileSources={tileSources}
        selected={selected}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        strokeScaleByName={strokeScaleByName}
        atlas={atlas}
        showPattern={true}
        rows={rows}
        height={height}
        itemSize={itemSize}
        rowGap={rowGap}
        selectedPattern={
          selectedPattern
            ? {
                tiles: selectedPattern.tiles,
                width: selectedPattern.width,
                height: selectedPattern.height,
                rotation: patternRotations[selectedPattern.id] ?? 0,
                mirrorX: patternMirrors[selectedPattern.id] ?? false,
              }
            : null
        }
        resolvePatternTile={resolvePatternTile}
        patternThumbnailNode={patternThumbnailNode}
        patternList={patternListForPalette}
        resolveTileForPatternList={resolveTileForPatternList}
        selectedPatternId={selectedPatternId}
        onSelectPattern={(id) => {
          dismissModifyBanner?.();
          setSelectedPatternId(id);
          onSelect({ mode: 'pattern' });
        }}
        onPatternThumbLongPress={(id) => {
          dismissModifyBanner?.();
          setPatternPropertiesDialogPatternId(id);
        }}
        onPatternThumbDoubleTap={(id) => {
          dismissModifyBanner?.();
          setPatternRotations((prev) => ({
            ...prev,
            [id]: ((prev[id] ?? 0) + 90) % 360,
          }));
        }}
        onPatternSeparatorIconPress={() => {
          dismissModifyBanner?.();
          if (selected.mode !== 'pattern') onSelect({ mode: 'pattern' });
          setShowPatternChooser(true);
        }}
        onPatternCreatePress={() => {
          dismissModifyBanner?.();
          onSelect({ mode: 'pattern' });
          const id = onCreatePatternPress(closeChooser);
          if (typeof id === 'string') setSelectedPatternId(id);
        }}
        onSelect={onSelect}
        onRotate={onRotate}
        onMirror={onMirror}
        onMirrorVertical={onMirrorVertical}
        getRotation={getRotation}
        getMirror={getMirror}
        getMirrorVertical={getMirrorVertical}
        onSetOrientation={onSetOrientation}
        onPatternPress={() => {
          dismissModifyBanner?.();
          if (selected.mode !== 'pattern') onSelect({ mode: 'pattern' });
          setShowPatternChooser(true);
        }}
        onPatternLongPress={() => {
          dismissModifyBanner?.();
          if (selected.mode !== 'pattern') onSelect({ mode: 'pattern' });
          setShowPatternChooser(true);
        }}
        onPatternDoubleTap={() => {
          dismissModifyBanner?.();
          if (selected.mode !== 'pattern') onSelect({ mode: 'pattern' });
          setShowPatternChooser(true);
        }}
        onRandomLongPress={onRandomLongPress}
        onRandomDoubleTap={onRandomDoubleTap}
        onPatternStampDragStart={onPatternStampDragStart}
        onPatternStampDragMove={onPatternStampDragMove}
        onPatternStampDragEnd={onPatternStampDragEnd}
        onPatternStampDragCancel={onPatternStampDragCancel}
      />
      {showPatternModal && (
        <View style={styles.patternModal} accessibilityRole="dialog">
          <Pressable
            style={styles.patternModalBackdrop}
            onPress={() => {
              onSelect({ mode: 'pattern' });
              closeChooser();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close Patterns"
          />
          <ThemedView style={styles.patternModalPanel}>
            <ThemedView style={styles.patternModalHeader}>
              <ThemedText type="title" style={styles.patternModalTitle}>
                Patterns
              </ThemedText>
              <View style={styles.patternModalActions}>
                {showImportInChooser && (
                  <Pressable
                    onPress={onImportPatternPress}
                    style={styles.patternHeaderIcon}
                    accessibilityRole="button"
                    accessibilityLabel="Import .tilepattern file"
                  >
                    <MaterialCommunityIcons name="upload" size={24} color="#fff" />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => {
                    onSelect({ mode: 'pattern' });
                    const id = onCreatePatternPress(closeChooser);
                    if (typeof id === 'string') setSelectedPatternId(id);
                  }}
                  style={styles.patternHeaderIcon}
                  accessibilityRole="button"
                  accessibilityLabel="Create new pattern"
                >
                  <MaterialCommunityIcons name="plus" size={24} color="#fff" />
                </Pressable>
                <Pressable
                  onPress={() => setIsPatternSelectMode(true)}
                  style={styles.patternHeaderIcon}
                  accessibilityRole="button"
                  accessibilityLabel="Select patterns"
                >
                  <MaterialCommunityIcons
                    name="checkbox-marked-outline"
                    size={22}
                    color="#fff"
                  />
                </Pressable>
              </View>
            </ThemedView>
            <Animated.View
              style={[
                styles.patternSelectBar,
                {
                  height: patternSelectAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 44],
                  }),
                  opacity: patternSelectAnim,
                },
              ]}
              pointerEvents={isPatternSelectMode ? 'auto' : 'none'}
            >
              <View style={styles.patternSelectDeleteExportRow}>
                <Pressable
                  onPress={() =>
                    selectedPatternIds.size > 0 && deleteSelectedPatterns()
                  }
                  style={[
                    styles.patternSelectDelete,
                    selectedPatternIds.size === 0 && styles.patternSelectDeleteDisabled,
                  ]}
                  disabled={selectedPatternIds.size === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Delete selected patterns"
                >
                  <ThemedText
                    type="defaultSemiBold"
                    style={[
                      styles.patternSelectDeleteText,
                      selectedPatternIds.size === 0 &&
                        styles.patternSelectDeleteTextDisabled,
                    ]}
                  >
                    Delete
                  </ThemedText>
                </Pressable>
                {showExportInChooser && (
                  <>
                    <ThemedText type="defaultSemiBold" style={styles.patternSelectPipe}>
                      {' | '}
                    </ThemedText>
                    <Pressable
                      onPress={() =>
                        selectedPatternIds.size > 0 &&
                        onExportPatternPress?.(Array.from(selectedPatternIds))
                      }
                      style={[
                        styles.patternSelectExport,
                        selectedPatternIds.size === 0 && styles.patternSelectExportDisabled,
                      ]}
                      disabled={selectedPatternIds.size === 0}
                      accessibilityRole="button"
                      accessibilityLabel="Export selected patterns"
                    >
                      <ThemedText
                        type="defaultSemiBold"
                        style={[
                          styles.patternSelectExportText,
                          selectedPatternIds.size === 0 &&
                            styles.patternSelectExportTextDisabled,
                        ]}
                      >
                        Export
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
              <ThemedText type="defaultSemiBold" style={styles.patternSelectCount}>
                {selectedPatternIds.size > 0
                  ? `${selectedPatternIds.size} selected`
                  : ''}
              </ThemedText>
              <Pressable
                onPress={clearPatternSelection}
                style={styles.patternSelectButton}
                accessibilityRole="button"
                accessibilityLabel="Exit selection mode"
              >
                <ThemedText type="defaultSemiBold" style={styles.patternSelectExitText}>
                  X
                </ThemedText>
              </Pressable>
            </Animated.View>
            <ScrollView
              style={styles.patternModalScroll}
              contentContainerStyle={styles.patternModalContent}
              showsVerticalScrollIndicator
            >
              {activePatterns.length === 0 ? (
                <Pressable
                  style={[styles.patternNewCard, { width: 70, height: 70 }]}
                  onPress={() => {
                    onSelect({ mode: 'pattern' });
                    const id = onCreatePatternPress(closeChooser);
                    if (typeof id === 'string') setSelectedPatternId(id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Create new pattern"
                >
                  <LinearGradient
                    colors={['#172554', '#010409', '#000000']}
                    locations={[0, 0.6, 0.95]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.patternNewThumb, { width: 70, height: 70 }]}
                  >
                    <View
                      style={[
                        styles.patternNewIconCenter,
                        { transform: [{ translateX: -16 }, { translateY: -16 }] },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="plus"
                        size={32}
                        color="#9ca3af"
                      />
                    </View>
                  </LinearGradient>
                </Pressable>
              ) : (
                <>
                  {activePatterns.map((pattern) => {
                    const rotationCW =
                      ((patternRotations[pattern.id] ?? 0) + 360) % 360;
                    const mirrorX = patternMirrors[pattern.id] ?? false;
                    const rotatedWidth =
                      rotationCW % 180 === 0 ? pattern.width : pattern.height;
                    const rotatedHeight =
                      rotationCW % 180 === 0 ? pattern.height : pattern.width;
                    const tileSize = Math.max(
                      8,
                      Math.floor(
                        (PATTERN_THUMB_HEIGHT - PATTERN_THUMB_PADDING * 2) /
                          Math.max(1, rotatedHeight)
                      )
                    );
                    const thumbWidth =
                      Math.max(1, rotatedWidth) * tileSize +
                      PATTERN_THUMB_PADDING * 2;
                    const thumbHeight =
                      Math.max(1, rotatedHeight) * tileSize +
                      PATTERN_THUMB_PADDING * 2;
                    return (
                      <Pressable
                        key={pattern.id}
                        onPress={() => {
                          if (isPatternSelectMode) {
                            toggleSelectPattern(pattern.id);
                            return;
                          }
                          const now = Date.now();
                          const lastTap = patternLastTapRef.current;
                          if (
                            lastTap &&
                            lastTap.id === pattern.id &&
                            now - lastTap.time < 260
                          ) {
                            patternLastTapRef.current = null;
                            setPatternPropertiesDialogPatternId(pattern.id);
                            return;
                          }
                          patternLastTapRef.current = {
                            id: pattern.id,
                            time: now,
                          };
                          setSelectedPatternId(pattern.id);
                          onSelect({ mode: 'pattern' });
                          setShowPatternChooser(false);
                        }}
                        onLongPress={() => {
                          if (isPatternSelectMode) return;
                          setPatternPropertiesDialogPatternId(pattern.id);
                        }}
                        style={[
                          styles.patternThumb,
                          { width: thumbWidth, height: thumbHeight },
                          (isPatternSelectMode
                            ? selectedPatternIds.has(pattern.id)
                            : selectedPattern?.id === pattern.id) &&
                            styles.patternThumbSelected,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Pattern ${pattern.name}`}
                      >
                        <PatternThumbnail
                          pattern={pattern}
                          rotationCW={rotationCW}
                          mirrorX={mirrorX}
                          tileSize={tileSize}
                          resolveTile={(t) =>
                            resolveTileForPatternList(
                              t,
                              pattern.tileSetIds && pattern.tileSetIds.length > 0
                                ? pattern.tileSetIds
                                : undefined
                            )
                          }
                          strokeColor={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeScaleByName={strokeScaleByName}
                        />
                      </Pressable>
                    );
                  })}
                </>
              )}
            </ScrollView>
          </ThemedView>
        </View>
      )}
      <Modal
        visible={patternPropertiesDialogPatternId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPatternPropertiesDialogPatternId(null)}
      >
        <View style={styles.patternPropertiesModalOverlay}>
          <View style={styles.patternPropertiesModalPanel}>
            {(() => {
              const patternId = patternPropertiesDialogPatternId;
              const pattern = patternId
                ? activePatterns.find((p) => p.id === patternId) ?? null
                : null;
              if (!pattern) return null;
              const curRotation =
                ((patternRotations[pattern.id] ?? 0) + 360) % 360;
              const curMirrorX = patternMirrors[pattern.id] ?? false;
              const resolveForPattern = (t: Tile) => resolvePatternTile(t);
              const orientMaxDim = 64;
              return (
                <>
                  <ScrollView
                    style={styles.patternPropertiesModalScroll}
                    contentContainerStyle={
                      styles.patternPropertiesModalScrollContent
                    }
                    showsVerticalScrollIndicator
                    keyboardShouldPersistTaps="handled"
                  >
                    <ThemedText
                      type="title"
                      style={styles.patternPropertiesModalTitle}
                    >
                      Properties
                    </ThemedText>
                    <View style={styles.patternPropertiesModalSection}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.patternPropertiesSectionLabel}
                      >
                        Orientation
                      </ThemedText>
                      <View style={styles.patternPropertiesOrientationGrid}>
                        {[0, 1].map((row) => (
                          <View
                            key={row}
                            style={styles.patternPropertiesOrientationRow}
                          >
                            {PATTERN_ORIENTATION_VARIANTS.slice(
                              row * 4,
                              row * 4 + 4
                            ).map((orient, i) => {
                              const idx = row * 4 + i;
                              const isActive =
                                curRotation === orient.rotation &&
                                curMirrorX === orient.mirrorX;
                              const rotatedW =
                                orient.rotation % 180 === 0
                                  ? pattern.width
                                  : pattern.height;
                              const rotatedH =
                                orient.rotation % 180 === 0
                                  ? pattern.height
                                  : pattern.width;
                              const maxSide = Math.max(rotatedW, rotatedH);
                              const thumbWidth =
                                (orientMaxDim * rotatedW) / maxSide;
                              const thumbHeight =
                                (orientMaxDim * rotatedH) / maxSide;
                              const ts = Math.max(
                                4,
                                Math.floor(orientMaxDim / maxSide)
                              );
                              return (
                                <Pressable
                                  key={idx}
                                  onPress={() => {
                                    setPatternRotations((prev) => ({
                                      ...prev,
                                      [pattern.id]: orient.rotation,
                                    }));
                                    setPatternMirrors((prev) => ({
                                      ...prev,
                                      [pattern.id]: orient.mirrorX,
                                    }));
                                  }}
                                  style={[
                                    styles.patternPropertiesOrientationThumb,
                                    {
                                      width: thumbWidth,
                                      height: thumbHeight,
                                    },
                                    isActive &&
                                      styles.patternPropertiesOrientationThumbSelected,
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Orientation ${idx + 1}`}
                                >
                                  <View
                                    style={
                                      styles.patternPropertiesOrientationThumbWrap
                                    }
                                  >
                                    <PatternThumbnail
                                      pattern={pattern}
                                      rotationCW={orient.rotation}
                                      mirrorX={orient.mirrorX}
                                      tileSize={ts}
                                      resolveTile={(t) =>
                                        resolveForPattern(t)
                                      }
                                      strokeColor={strokeColor}
                                      strokeWidth={strokeWidth}
                                      strokeScaleByName={strokeScaleByName}
                                    />
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        ))}
                      </View>
                    </View>
                  </ScrollView>
                  <View style={styles.patternPropertiesModalActions}>
                    <Pressable
                      onPress={() =>
                        setPatternPropertiesDialogPatternId(null)
                      }
                      style={[
                        styles.patternPropertiesModalButton,
                        styles.patternPropertiesModalButtonGhost,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel"
                    >
                      <ThemedText type="defaultSemiBold">Cancel</ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        setPatternPropertiesDialogPatternId(null)
                      }
                      style={[
                        styles.patternPropertiesModalButton,
                        styles.patternPropertiesModalButtonPrimary,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Done"
                    >
                      <ThemedText
                        type="defaultSemiBold"
                        style={styles.patternPropertiesModalButtonText}
                      >
                        Done
                      </ThemedText>
                    </Pressable>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </>
  );
}

export const ModifyPalette = memo(ModifyPaletteInner);

const styles = StyleSheet.create({
  patternModal: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  patternModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  patternModalPanel: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 12,
    backgroundColor: '#3f3f3f',
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 0,
    overflow: 'hidden',
  },
  patternModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 0,
  },
  patternModalTitle: {
    color: '#fff',
  },
  patternModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'transparent',
  },
  patternHeaderIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  patternSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#1f1f1f',
    overflow: 'hidden',
    marginBottom: 10,
    borderRadius: 0,
  },
  patternSelectButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectDelete: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectDeleteText: {
    color: '#dc2626',
  },
  patternSelectDeleteDisabled: {
    opacity: 0.5,
  },
  patternSelectDeleteTextDisabled: {
    color: '#b91c1c',
  },
  patternSelectDeleteExportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  patternSelectCount: {
    color: '#9ca3af',
  },
  patternSelectExitText: {
    color: '#fff',
  },
  patternSelectPipe: {
    color: '#9ca3af',
  },
  patternSelectExport: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  patternSelectExportText: {
    color: '#9ca3af',
  },
  patternSelectExportDisabled: {
    opacity: 0.5,
  },
  patternSelectExportTextDisabled: {
    color: '#6b7280',
  },
  patternModalScroll: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  patternModalContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-start',
    paddingBottom: 8,
  },
  patternNewCard: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternNewThumb: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  patternNewIconCenter: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
  patternThumb: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    backgroundColor: '#000',
    borderRadius: 6,
    padding: PATTERN_THUMB_PADDING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  patternPropertiesModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  patternPropertiesModalPanel: {
    alignSelf: 'center',
    maxWidth: 300,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
  },
  patternPropertiesModalScroll: {
    maxHeight: 380,
  },
  patternPropertiesModalScrollContent: {
    paddingBottom: 8,
    gap: 12,
  },
  patternPropertiesModalTitle: {
    color: '#111',
  },
  patternPropertiesModalSection: {
    gap: 10,
  },
  patternPropertiesSectionLabel: {
    color: '#111',
    marginBottom: 6,
  },
  patternPropertiesOrientationGrid: {
    gap: 6,
  },
  patternPropertiesOrientationRow: {
    flexDirection: 'row',
    gap: 6,
  },
  patternPropertiesOrientationThumb: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  patternPropertiesOrientationThumbSelected: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  patternPropertiesOrientationThumbWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternPropertiesModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  patternPropertiesModalButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 6,
    borderWidth: 1,
  },
  patternPropertiesModalButtonGhost: {
    borderColor: '#d1d5db',
    backgroundColor: 'transparent',
  },
  patternPropertiesModalButtonPrimary: {
    borderColor: '#22c55e',
    backgroundColor: '#22c55e',
  },
  patternPropertiesModalButtonText: {
    color: '#fff',
  },
});
