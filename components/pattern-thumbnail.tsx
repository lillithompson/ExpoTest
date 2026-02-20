import { View } from 'react-native';

import { TileAsset } from '@/components/tile-asset';
import { type Tile } from '@/utils/tile-grid';

export type PatternThumbnailPattern = {
  id?: string;
  tiles: Tile[];
  width: number;
  height: number;
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

/**
 * Renders a pattern thumbnail grid with the same resolution and layout as the pattern
 * chooser dialog. Use this in both the pattern chooser and the tile palette so UGC
 * tiles resolve correctly and thumbnails stay in sync.
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
          flexDirection: 'column',
        }}
      >
        {Array.from({ length: pattern.height }, (_, rowIndex) => (
          <View
            key={`pattern-row-${keyPrefix}-${rowIndex}`}
            style={{ flexDirection: 'row' }}
          >
            {Array.from({ length: pattern.width }, (_, colIndex) => {
              const index = rowIndex * pattern.width + colIndex;
              const tile = pattern.tiles[index];
              const resolved = tile ? resolveTile(tile) : { source: null as unknown | null, name: '' };
              const tileName = resolved.name;
              const source = resolved.source;
              return (
                <View
                  key={`pattern-cell-${keyPrefix}-${index}`}
                  style={{
                    width: tileSize,
                    height: tileSize,
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
    </View>
  );
}
