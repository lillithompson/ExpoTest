import { Platform, View, type ImageProps } from 'react-native';

import { TileAsset } from '@/components/tile-asset';
import { type TileAtlas } from '@/utils/tile-atlas';

type Props = {
  atlas?: TileAtlas | null;
  source: unknown;
  name: string;
  strokeColor?: string;
  strokeWidth?: number;
  style?: ImageProps['style'];
  resizeMode?: ImageProps['resizeMode'];
  onLoad?: () => void;
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
}: Props) {
  const entry = atlas?.entries.get(name);
  const wantsStroke = Boolean(strokeColor) || strokeWidth !== undefined;
  if (Platform.OS === 'web' && atlas && entry && !wantsStroke) {
    const backgroundStyle = {
      backgroundImage: `url(${atlas.uri})`,
      backgroundPosition: `-${entry.x}px -${entry.y}px`,
      backgroundSize: `${atlas.width}px ${atlas.height}px`,
      backgroundRepeat: 'no-repeat',
    } as const;
    return <View style={[style as any, backgroundStyle]} />;
  }

  return (
    <TileAsset
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
