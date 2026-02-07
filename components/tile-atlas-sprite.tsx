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
}: Props) {
  const entry = atlas?.entries.get(name);
  if (Platform.OS === 'web' && atlas && entry && preferAtlas) {
    const backgroundStyle = {
      backgroundImage: `url(${atlas.uri})`,
      backgroundPosition: `-${entry.x}px -${entry.y}px`,
      backgroundSize: `${atlas.width}px ${atlas.height}px`,
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
