import { View } from 'react-native';

import { TileAsset } from '@/components/tile-asset';
import { type Tile } from '@/utils/tile-grid';

export type PatternThumbnailPattern = {
  id?: string;
  tiles: Tile[];
  width: number;
  height: number;
  /** Internal grid level at which tiles/width/height were captured. Absent for legacy patterns. */
  createdAtLevel?: number;
  /** Finer-layer tile data keyed by internal level (level < createdAtLevel). */
  layerTiles?: Record<number, { tiles: Tile[]; width: number; height: number }>;
};

type Props = {
  pattern: PatternThumbnailPattern;
  /** Rotation in degrees clockwise (0, 90, 180, 270). */
  rotationCW: number;
  mirrorX: boolean;
  tileSize: number;
  resolveTile: (tile: Tile) => { source: unknown | null; name: string };
  strokeColor?: string;
  strokeWidth?: number;
  strokeScaleByName?: Map<string, number>;
};

type LayerData = {
  tiles: Tile[];
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
};

/**
 * Renders a pattern thumbnail grid with the same resolution and layout as the pattern
 * chooser dialog. Use this in both the pattern chooser and the tile palette so UGC
 * tiles resolve correctly and thumbnails stay in sync.
 *
 * When the pattern has multi-layer data (createdAtLevel + layerTiles), finer layers
 * are rendered on top of the base layer so the composite is visible.
 */
export function PatternThumbnail({
  pattern,
  rotationCW,
  mirrorX,
  tileSize,
  resolveTile,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
}: Props) {
  const rotatedWidth =
    rotationCW % 180 === 0 ? pattern.width : pattern.height;
  const rotatedHeight =
    rotationCW % 180 === 0 ? pattern.height : pattern.width;
  const keyPrefix = pattern.id ?? 'pattern';

  // Rotate the whole pattern as a single group (one transform), not each tile.
  const innerWidth = pattern.width * tileSize;
  const innerHeight = pattern.height * tileSize;
  // Mirror in pattern space first, then rotate the group.
  const groupTransform = [
    ...(mirrorX ? [{ scaleX: -1 }] : []),
    { rotate: `${rotationCW}deg` },
  ];

  // Build all layers sorted coarsest-to-finest so finer layers render on top.
  const createdAtLevel = pattern.createdAtLevel;
  type LayerWithLevel = LayerData & { level: number };
  const allLayersWithLevel: LayerWithLevel[] = [
    { tiles: pattern.tiles, gridWidth: pattern.width, gridHeight: pattern.height, cellSize: tileSize, level: createdAtLevel ?? 0 },
  ];
  if (createdAtLevel != null && pattern.layerTiles) {
    for (const [levelStr, layerData] of Object.entries(pattern.layerTiles)) {
      if (!layerData || layerData.tiles.length === 0) continue;
      const M = parseInt(levelStr, 10);
      if (isNaN(M)) continue;
      // cellSize = tileSize * 2^(M - createdAtLevel): smaller for finer, larger for coarser
      const cellSize = tileSize * Math.pow(2, M - createdAtLevel);
      if (cellSize < 0.5) continue;
      allLayersWithLevel.push({ tiles: layerData.tiles, gridWidth: layerData.width, gridHeight: layerData.height, cellSize, level: M });
    }
  }
  // Coarsest level first (renders as background), finest last (renders on top)
  allLayersWithLevel.sort((a, b) => b.level - a.level);
  const layers: LayerData[] = allLayersWithLevel;

  return (
    <View
      style={{
        width: rotatedWidth * tileSize,
        height: rotatedHeight * tileSize,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: innerWidth,
          height: innerHeight,
          transform: groupTransform,
        }}
      >
        {layers.map((layer, layerIdx) => (
          <View
            key={`layer-${keyPrefix}-${layerIdx}`}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            {Array.from({ length: layer.gridHeight }, (_, rowIndex) => (
              <View
                key={`layer-${keyPrefix}-${layerIdx}-row-${rowIndex}`}
                style={{ flexDirection: 'row' }}
              >
                {Array.from({ length: layer.gridWidth }, (_, colIndex) => {
                  const index = rowIndex * layer.gridWidth + colIndex;
                  const tile = layer.tiles[index];
                  const resolved = tile ? resolveTile(tile) : { source: null as unknown | null, name: '' };
                  const tileName = resolved.name;
                  const source = resolved.source;
                  return (
                    <View
                      key={`layer-${keyPrefix}-${layerIdx}-cell-${index}`}
                      style={{
                        width: layer.cellSize,
                        height: layer.cellSize,
                        backgroundColor: 'transparent',
                      }}
                    >
                      {source && tile && (
                        <TileAsset
                          source={source}
                          name={tileName}
                          strokeColor={strokeColor}
                          strokeWidth={
                            strokeWidth !== undefined && strokeScaleByName?.get(tileName) !== undefined
                              ? strokeWidth * (strokeScaleByName.get(tileName) ?? 1)
                              : strokeWidth
                          }
                          style={{
                            width: '100%',
                            height: '100%',
                            transform: [
                              { scaleX: tile.mirrorX ? -1 : 1 },
                              { scaleY: tile.mirrorY ? -1 : 1 },
                              { rotate: `${tile.rotation}deg` },
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
        ))}
      </View>
    </View>
  );
}
