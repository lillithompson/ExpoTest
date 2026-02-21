import { Platform, View, type ImageProps } from 'react-native';

import { TileAsset } from '@/components/tile-asset';
import { type TileAtlas } from '@/utils/tile-atlas';

const getSourceUri = (source: unknown): string | null => {
  if (!source) return null;
  if (typeof source === 'string') return source;
  const uri = (source as { uri?: string })?.uri;
  return uri ?? null;
};

type Props = {
  atlas?: TileAtlas | null;
  source: unknown;
  name: string;
  strokeColor?: string;
  strokeWidth?: number;
  style?: ImageProps['style'];
  resizeMode?: ImageProps['resizeMode'];
  onLoad?: () => void;
  preferAtlas?: boolean;
  /** When set, scale the atlas so one tile (entry.size) fills this size in the view. Ensures correct size/alignment when cell size differs from atlas tile size. */
  displaySize?: number;
};

export function TileAtlasSprite({
  atlas,
  source,
  name,
  strokeColor,
  strokeWidth,
  style,
  resizeMode,
  onLoad,
  preferAtlas = true,
  displaySize,
}: Props) {
  const entry = atlas?.entries.get(name);
  if (Platform.OS === 'web' && atlas && entry && preferAtlas) {
    const scale =
      displaySize != null && entry.size > 0 ? displaySize / entry.size : 1;
    const posX = entry.x * scale;
    const posY = entry.y * scale;
    const backgroundStyle = {
      backgroundImage: `url(${atlas.uri})`,
      backgroundPosition: `-${posX}px -${posY}px`,
      backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
      backgroundRepeat: 'no-repeat',
    } as const;
    return <View style={[style as any, backgroundStyle]} />;
  }

  const sourceUri = getSourceUri(source);
  return (
    <TileAsset
      key={sourceUri ?? name}
      source={source}
      name={name}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
    />
  );
}
