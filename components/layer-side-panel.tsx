import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { getEmphasizeStrokeColor, getLevelGridInfo, zoomRegionHasPartialCellsAtLevel } from '@/utils/tile-grid';
import { type TileFile } from '@/hooks/use-tile-files';

const BUTTON_SIZE = 40;
const COMPACT_BUTTON_SIZE = Math.round(BUTTON_SIZE * 1.1); // 44
const SLIDEOUT_DURATION_MS = 250;
const DOUBLE_TAP_MS = 300;
const FULL_GAP = 4;
const COMPACT_GAP = 16;

interface LayerSidePanelProps {
  maxDisplayLevel: number;
  displayResolutionLevel: number;
  activeFile: TileFile | null;
  containerWidth: number;
  containerHeight: number;
  gridWidth: number;
  zoomRegion: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
  onSelectLayer: (internalLevel: number) => void;
  onToggleVisibility: (internalLevel: number, visible: boolean) => void;
  onToggleLocked: (internalLevel: number, locked: boolean) => void;
  onToggleEmphasized: (internalLevel: number, emphasized: boolean) => void;
}

export function LayerSidePanel({
  maxDisplayLevel,
  displayResolutionLevel,
  activeFile,
  containerWidth,
  containerHeight,
  gridWidth,
  zoomRegion,
  onSelectLayer,
  onToggleVisibility,
  onToggleLocked,
  onToggleEmphasized,
}: LayerSidePanelProps) {
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null);

  // Animated.Value map keyed by internalLevel
  const animRefs = useRef<Map<number, Animated.Value>>(new Map());
  const getAnim = (internalLevel: number): Animated.Value => {
    if (!animRefs.current.has(internalLevel)) {
      animRefs.current.set(internalLevel, new Animated.Value(0));
    }
    return animRefs.current.get(internalLevel)!;
  };

  // Last-tap tracking for double-tap detection
  const lastTapRef = useRef<{ level: number; time: number } | null>(null);

  // Measured natural widths per layer; shared max drives all animations.
  const measuredWidthsRef = useRef<Map<number, number>>(new Map());
  const [slideOutWidth, setSlideOutWidth] = useState(0);
  const handleMeasure = (internalLevel: number, w: number) => {
    if (w <= 0) return;
    if (measuredWidthsRef.current.get(internalLevel) === w) return;
    measuredWidthsRef.current.set(internalLevel, w);
    const maxW = Math.max(...measuredWidthsRef.current.values());
    setSlideOutWidth((prev) => (maxW > prev ? maxW : prev));
  };

  const leftMargin = (containerWidth - gridWidth) / 2;
  const isFullMode = leftMargin >= BUTTON_SIZE;
  const buttonSize = isFullMode ? BUTTON_SIZE : COMPACT_BUTTON_SIZE;
  const gap = isFullMode ? FULL_GAP : COMPACT_GAP;
  const buttonLeft = isFullMode
    ? leftMargin - BUTTON_SIZE
    : leftMargin - COMPACT_BUTTON_SIZE / 2;

  // Vertically center the compact button group on the canvas center (horizontal mirror line).
  const buttonGroupHeight = maxDisplayLevel * buttonSize + (maxDisplayLevel - 1) * gap;
  const topOffset = !isFullMode && containerHeight > 0
    ? Math.max(0, (containerHeight - buttonGroupHeight) / 2)
    : FULL_GAP;

  const expandLayer = (internalLevel: number) => {
    const targetWidth = slideOutWidth;
    if (targetWidth <= 0) return;

    // Collapse any currently expanded layer
    if (expandedLayer !== null && expandedLayer !== internalLevel) {
      const prevAnim = getAnim(expandedLayer);
      Animated.timing(prevAnim, {
        toValue: 0,
        duration: SLIDEOUT_DURATION_MS,
        useNativeDriver: false,
      }).start();
    }

    const anim = getAnim(internalLevel);
    if (expandedLayer === internalLevel) {
      // Collapse this one
      Animated.timing(anim, {
        toValue: 0,
        duration: SLIDEOUT_DURATION_MS,
        useNativeDriver: false,
      }).start(() => setExpandedLayer(null));
    } else {
      setExpandedLayer(internalLevel);
      Animated.timing(anim, {
        toValue: targetWidth,
        duration: SLIDEOUT_DURATION_MS,
        useNativeDriver: false,
      }).start();
    }
  };

  const collapseAll = () => {
    if (expandedLayer !== null) {
      const anim = getAnim(expandedLayer);
      Animated.timing(anim, {
        toValue: 0,
        duration: SLIDEOUT_DURATION_MS,
        useNativeDriver: false,
      }).start(() => setExpandedLayer(null));
    }
  };

  const isLayerVisible = (level: number) => activeFile?.layerVisibility?.[level] !== false;
  const isLayerLocked = (level: number) => activeFile?.layerLocked?.[level] === true;
  const isLayerEmphasized = (level: number) => activeFile?.layerEmphasized?.[level] === true;

  const fullCols = activeFile?.grid?.columns ?? 0;
  const fullRows = activeFile?.grid?.rows ?? 0;

  const isDisabled = (internalLevel: number): boolean => {
    if (!zoomRegion || fullCols <= 0 || fullRows <= 0) return false;
    return Boolean(zoomRegionHasPartialCellsAtLevel(zoomRegion, fullCols, fullRows, internalLevel));
  };

  // Render nothing if no layers
  if (maxDisplayLevel <= 0) return null;

  return (
    <>
      {/* Backdrop to dismiss slide-out */}
      {expandedLayer !== null && (
        <Pressable
          style={[StyleSheet.absoluteFill, { pointerEvents: 'auto' }]}
          onPress={collapseAll}
          accessibilityRole="button"
          accessibilityLabel="Close layer panel"
        />
      )}

      {/* Button column */}
      <View
        style={[
          styles.buttonColumn,
          { left: buttonLeft, top: topOffset, gap },
          { pointerEvents: 'box-none' },
        ]}
      >
        {Array.from({ length: maxDisplayLevel }, (_, i) => i + 1).map((displayLevel) => {
          const internalLevel = maxDisplayLevel - displayLevel + 1;
          const isSelected = displayLevel === displayResolutionLevel;
          const emphasized = isLayerEmphasized(internalLevel);
          const emphColor = getEmphasizeStrokeColor(internalLevel);
          const visible = isLayerVisible(internalLevel);
          const locked = isLayerLocked(internalLevel);
          const disabled = isDisabled(internalLevel);

          // Compute button fill, border, text color
          let fillColor: string;
          let borderColor: string;
          let textColor: string;
          if (isSelected && emphasized) {
            fillColor = emphColor;
            borderColor = emphColor;
            textColor = '#000';
          } else if (isSelected && !emphasized) {
            fillColor = '#ffffff';
            borderColor = '#ffffff';
            textColor = '#000';
          } else if (!isSelected && emphasized) {
            fillColor = 'transparent';
            borderColor = emphColor;
            textColor = emphColor;
          } else {
            fillColor = 'transparent';
            borderColor = 'rgba(255,255,255,0.80)';
            textColor = 'rgba(255,255,255,0.6)';
          }

          // Radial gradient colors for compact mode
          const gradientColor = (isSelected || emphasized) ? (emphasized ? emphColor : '#ffffff') : '#ffffff';
          const gradientOpacity = isSelected && emphasized ? 0.8
            : isSelected ? 0.65
            : emphasized ? 0.35
            : 0.40;

          const borderRadius = isFullMode ? 8 : COMPACT_BUTTON_SIZE / 2;
          const anim = getAnim(internalLevel);
          const isExpanded = expandedLayer === internalLevel;
          const levelInfo = fullCols > 0 && fullRows > 0
            ? getLevelGridInfo(fullCols, fullRows, internalLevel)
            : null;
          const resolutionLabel = levelInfo
            ? `${levelInfo.levelCols}\u00d7${levelInfo.levelRows}`
            : `L${displayLevel}`;

          // Inline style reused by both the real content and the measurer.
          const contentStyle = [styles.slideOutContent, { width: slideOutWidth, height: buttonSize }];

          return (
            <View
              key={internalLevel}
              style={[styles.buttonRow, { pointerEvents: 'box-none' }]}
            >
              {/*
               * Hidden measurer: absolutely positioned so it doesn't constrain to the
               * animated parent's width. Sizes to natural content width; onLayout
               * captures that width so all slide-outs animate to the same measured size.
               */}
              <View
                style={[styles.slideOutMeasurer, { pointerEvents: 'none' }]}
                onLayout={(e) => handleMeasure(internalLevel, e.nativeEvent.layout.width)}
              >
                <Text style={styles.slideOutLabel} numberOfLines={1}>{resolutionLabel}</Text>
                <View style={styles.iconButton}><View style={styles.iconPlaceholder} /></View>
                <View style={styles.iconButton}><View style={styles.iconPlaceholder} /></View>
                <View style={styles.iconButton}><View style={styles.iconPlaceholder} /></View>
              </View>

              {isExpanded && (
                <View
                  style={[
                    styles.buttonWhiteFill,
                    {
                      width: buttonSize,
                      height: buttonSize,
                      borderTopLeftRadius: borderRadius,
                      borderBottomLeftRadius: borderRadius,
                    },
                    { pointerEvents: 'none' },
                  ]}
                />
              )}
              <Pressable
                onPress={() => {
                  if (disabled) return;
                  const now = Date.now();
                  const last = lastTapRef.current;
                  if (last && last.level === internalLevel && now - last.time < DOUBLE_TAP_MS) {
                    // Double tap: expand slide-out
                    lastTapRef.current = null;
                    expandLayer(internalLevel);
                  } else {
                    // Single tap: select layer, collapse any other open panel
                    lastTapRef.current = { level: internalLevel, time: now };
                    if (expandedLayer !== null && expandedLayer !== internalLevel) {
                      collapseAll();
                    }
                    onSelectLayer(internalLevel);
                  }
                }}
                onLongPress={() => {
                  if (disabled) return;
                  lastTapRef.current = null;
                  onSelectLayer(internalLevel);
                  expandLayer(internalLevel);
                }}
                style={[
                  styles.button,
                  {
                    width: buttonSize,
                    height: buttonSize,
                    borderRadius,
                    backgroundColor: isFullMode ? fillColor : '#111111',
                    borderColor,
                    opacity: disabled ? 0.5 : 1,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Layer ${displayLevel}${isSelected ? ', selected' : ''}${disabled ? ', not editable when zoomed' : ''}`}
                accessibilityState={{ disabled }}
              >
                {/* Radial gradient fill — compact mode only */}
                {!isFullMode && (
                  <Svg
                    style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
                    width={COMPACT_BUTTON_SIZE}
                    height={COMPACT_BUTTON_SIZE}
                  >
                    <Defs>
                      <RadialGradient
                        id={`rg-${internalLevel}`}
                        cx="50%"
                        cy="50%"
                        r="50%"
                        fx="50%"
                        fy="50%"
                      >
                        <Stop offset="0" stopColor={gradientColor} stopOpacity={gradientOpacity} />
                        <Stop offset="1" stopColor={gradientColor} stopOpacity={0} />
                      </RadialGradient>
                    </Defs>
                    <Circle
                      cx={COMPACT_BUTTON_SIZE / 2}
                      cy={COMPACT_BUTTON_SIZE / 2}
                      r={COMPACT_BUTTON_SIZE / 2}
                      fill={`url(#rg-${internalLevel})`}
                    />
                  </Svg>
                )}
                {/* Label — full mode only */}
                {isFullMode && (
                  <Text style={[styles.buttonLabel, { color: textColor }]}>
                    L{displayLevel}
                  </Text>
                )}
              </Pressable>

              {/* Slide-out panel — width animates 0 → slideOutWidth */}
              <Animated.View
                style={[styles.slideOut, { width: anim, height: buttonSize }, { pointerEvents: isExpanded ? 'box-none' : 'none' }]}
              >
                <View style={contentStyle}>
                  <Text style={styles.slideOutLabel} numberOfLines={1}>
                    {resolutionLabel}
                  </Text>
                  <Pressable
                    onPress={() => !disabled && onToggleVisibility(internalLevel, !visible)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel={visible ? 'Hide layer' : 'Show layer'}
                    accessibilityState={{ disabled }}
                  >
                    <MaterialCommunityIcons
                      name={visible ? 'eye' : 'eye-off'}
                      size={20}
                      color={disabled ? '#9ca3af' : visible ? '#374151' : '#9ca3af'}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => !disabled && onToggleLocked(internalLevel, !locked)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel={locked ? 'Unlock layer' : 'Lock layer'}
                    accessibilityState={{ disabled }}
                  >
                    <MaterialCommunityIcons
                      name={locked ? 'lock' : 'lock-open-outline'}
                      size={20}
                      color={disabled ? '#9ca3af' : locked ? '#dc2626' : '#9ca3af'}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => !disabled && onToggleEmphasized(internalLevel, !emphasized)}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel={emphasized ? 'Remove emphasize' : 'Emphasize layer'}
                    accessibilityState={{ disabled }}
                  >
                    <MaterialCommunityIcons
                      name="format-color-highlight"
                      size={20}
                      color={disabled ? '#9ca3af' : emphasized ? emphColor : '#9ca3af'}
                    />
                  </Pressable>
                </View>
              </Animated.View>
            </View>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  buttonColumn: {
    position: 'absolute',
    flexDirection: 'column',
    zIndex: 60,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  buttonWhiteFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#fff',
  },
  /**
   * Invisible reference view used to measure the natural content width.
   * position: 'absolute' removes it from flex flow so it doesn't constrain
   * to the animated parent; no explicit width lets it expand to its content.
   */
  slideOutMeasurer: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    opacity: 0,
  },
  iconPlaceholder: {
    width: 20,
    height: 20,
  },
  slideOut: {
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    zIndex: 60,
  },
  slideOutContent: {
    // width and height applied inline
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  slideOutLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  iconButton: {
    padding: 6,
  },
});
