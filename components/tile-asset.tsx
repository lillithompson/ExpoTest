import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, type ImageProps } from 'react-native';
import { SvgUri, SvgXml } from 'react-native-svg';

type Props = {
  source: unknown;
  name?: string;
  style?: ImageProps['style'];
  resizeMode?: ImageProps['resizeMode'];
  onLoad?: () => void;
};

const resolveSourceUri = (source: unknown) => {
  if (!source) {
    return null;
  }
  if (typeof source === 'string') {
    return source;
  }
  if ((source as { uri?: string }).uri) {
    return (source as { uri?: string }).uri ?? null;
  }
  const resolveAssetSource = (Image as any)?.resolveAssetSource;
  if (typeof resolveAssetSource === 'function') {
    const resolved = resolveAssetSource(source as any);
    if (resolved?.uri) {
      return resolved.uri;
    }
  }
  if (typeof source === 'number') {
    const asset = Asset.fromModule(source);
    if (asset?.uri) {
      return asset.uri;
    }
  }
  return null;
};

export function TileAsset({ source, name, style, resizeMode, onLoad }: Props) {
  const uri = useMemo(() => resolveSourceUri(source), [source]);
  const isSvg =
    (name ?? '').toLowerCase().endsWith('.svg') ||
    (uri ?? '').toLowerCase().includes('.svg');
  const [svgUri, setSvgUri] = useState<string | null>(null);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const loadCalledRef = useRef(false);

  useEffect(() => {
    if (!isSvg) {
      setSvgUri(null);
      setSvgXml(null);
      return;
    }
    let cancelled = false;
    const resolveSvg = async () => {
      if (uri) {
        if (!cancelled) {
          setSvgUri(uri);
          if (Platform.OS !== 'web') {
            try {
              const xml = await FileSystem.readAsStringAsync(uri);
              if (!cancelled) {
                setSvgXml(xml);
              }
            } catch {
              // ignore, fall back to uri rendering
            }
          }
        }
        return;
      }
      if (typeof source === 'number') {
        const asset = Asset.fromModule(source);
        if (!asset.downloaded && Platform.OS !== 'web') {
          await asset.downloadAsync();
        }
        if (!cancelled) {
          const resolved = asset.localUri ?? asset.uri ?? null;
          setSvgUri(resolved);
          if (resolved && Platform.OS !== 'web') {
            try {
              const xml = await FileSystem.readAsStringAsync(resolved);
              if (!cancelled) {
                setSvgXml(xml);
              }
            } catch {
              // ignore, fall back to uri rendering
            }
          }
        }
      }
    };
    void resolveSvg();
    return () => {
      cancelled = true;
    };
  }, [isSvg, source, uri]);

  useEffect(() => {
    if (!isSvg || !onLoad || !svgUri || loadCalledRef.current) {
      return;
    }
    loadCalledRef.current = true;
    onLoad();
  }, [isSvg, onLoad, svgUri]);

  if (isSvg && svgUri) {
    if (Platform.OS !== 'web' && svgXml) {
      return <SvgXml xml={svgXml} width="100%" height="100%" style={style as any} />;
    }
    return <SvgUri uri={svgUri} width="100%" height="100%" style={style as any} />;
  }
  if (isSvg) {
    return null;
  }

  return (
    <Image
      source={source as any}
      style={style}
      resizeMode={resizeMode}
      fadeDuration={0}
      onLoad={onLoad}
    />
  );
}
