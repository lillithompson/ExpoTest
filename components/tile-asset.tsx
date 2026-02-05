import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, type ImageProps } from 'react-native';
import { SvgUri, SvgXml } from 'react-native-svg';

type Props = {
  source: unknown;
  name?: string;
  strokeColor?: string;
  strokeWidth?: number;
  style?: ImageProps['style'];
  resizeMode?: ImageProps['resizeMode'];
  onLoad?: () => void;
};

const svgXmlCache = new Map<string, string>();

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

const applySvgOverrides = (xml: string, strokeColor?: string, strokeWidth?: number) => {
  let next = xml;
  const applyInlineOverrides = (input: string) => {
    const tagRegex =
      /<(path|rect|circle|line|polyline|polygon|ellipse)([^>]*?)(\/?)>/gi;
    return input.replace(tagRegex, (_match, tagName, attrs, selfClosing) => {
      let nextAttrs = attrs;
      if (strokeColor) {
        if (/stroke=/.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(
            /stroke="(?!none)[^"]*"/gi,
            `stroke="${strokeColor}"`
          );
          nextAttrs = nextAttrs.replace(
            /stroke='(?!none)[^']*'/gi,
            `stroke='${strokeColor}'`
          );
        } else {
          nextAttrs += ` stroke="${strokeColor}"`;
        }
      }
      if (strokeWidth !== undefined) {
        if (/stroke-width=/.test(nextAttrs)) {
          nextAttrs = nextAttrs.replace(
            /stroke-width="[^"]*"/gi,
            `stroke-width="${strokeWidth}"`
          );
          nextAttrs = nextAttrs.replace(
            /stroke-width='[^']*'/gi,
            `stroke-width='${strokeWidth}'`
          );
        } else {
          nextAttrs += ` stroke-width="${strokeWidth}"`;
        }
      }
      const closing = selfClosing === '/' ? ' />' : '>';
      return `<${tagName}${nextAttrs}${closing}`;
    });
  };

  if (strokeColor) {
    next = next.replace(/stroke="(?!none)[^"]*"/gi, `stroke="${strokeColor}"`);
    next = next.replace(/stroke='(?!none)[^']*'/gi, `stroke='${strokeColor}'`);
    if (!/stroke\s*=/.test(next)) {
      next = next.replace(/<svg\b([^>]*)>/i, `<svg$1 stroke="${strokeColor}">`);
    }
  }
  if (strokeWidth !== undefined) {
    next = next.replace(/stroke-width="[^"]*"/gi, `stroke-width="${strokeWidth}"`);
    next = next.replace(/stroke-width='[^']*'/gi, `stroke-width='${strokeWidth}'`);
    if (!/stroke-width\s*=/.test(next)) {
      next = next.replace(/<svg\b([^>]*)>/i, `<svg$1 stroke-width="${strokeWidth}">`);
    }
  }
  if (strokeColor || strokeWidth !== undefined) {
    const overrideRules = [
      strokeColor ? `stroke: ${strokeColor} !important;` : '',
      strokeWidth !== undefined
        ? `stroke-width: ${strokeWidth} !important; vector-effect: non-scaling-stroke;`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const overrideStyle = `<style data-tile-overrides="true">* { ${overrideRules} }</style>`;
    next = next.replace(/<style data-tile-overrides="true">[\s\S]*?<\/style>/i, '');
    next = next.replace(/<svg\b([^>]*)>/i, `<svg$1>${overrideStyle}`);
    next = applyInlineOverrides(next);
  }
  return next;
};

const stripOuterBorder = (xml: string) => {
  return xml.replace(/<rect\b[^>]*(x=["']0\.5["']|y=["']0\.5["'])[^>]*\/?>/gi, '');
};

export const prefetchTileAssets = async (sources: unknown[]) => {
  const tasks = sources.map(async (source) => {
    const uri = resolveSourceUri(source);
    if (!uri || !uri.toLowerCase().includes('.svg') || svgXmlCache.has(uri)) {
      return;
    }
    let resolvedUri = uri;
    if (typeof source === 'number') {
      const asset = Asset.fromModule(source);
      if (!asset.downloaded && Platform.OS !== 'web') {
        await asset.downloadAsync();
      }
      resolvedUri = asset.localUri ?? asset.uri ?? uri;
    }
    if (svgXmlCache.has(resolvedUri)) {
      return;
    }
    try {
      const xml =
        Platform.OS === 'web'
          ? await fetch(resolvedUri).then((response) => response.text())
          : await FileSystem.readAsStringAsync(resolvedUri);
      svgXmlCache.set(resolvedUri, xml);
    } catch {
      // ignore prefetch errors
    }
  });
  await Promise.all(tasks);
};

export function TileAsset({
  source,
  name,
  strokeColor,
  strokeWidth,
  style,
  resizeMode,
  onLoad,
}: Props) {
  const sourceRef = useRef(source);
  const uri = useMemo(() => resolveSourceUri(source), [source]);
  const isSvg =
    (name ?? '').toLowerCase().endsWith('.svg') ||
    (uri ?? '').toLowerCase().includes('.svg');
  const [svgUri, setSvgUri] = useState<string | null>(null);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const [svgXmlWithOverrides, setSvgXmlWithOverrides] = useState<string | null>(null);
  const loadCalledRef = useRef(false);
  const overrideRef = useRef<string | null>(null);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    if (!isSvg) {
      setSvgUri((prev) => (prev === null ? prev : null));
      setSvgXml((prev) => (prev === null ? prev : null));
      setSvgXmlWithOverrides((prev) => (prev === null ? prev : null));
      overrideRef.current = null;
      return;
    }
    let cancelled = false;
    const resolveSvg = async () => {
      if (uri) {
        if (!cancelled) {
          setSvgUri((prev) => (prev === uri ? prev : uri));
          const cached = svgXmlCache.get(uri);
          if (cached) {
            setSvgXml((prev) => (prev === cached ? prev : cached));
            return;
          }
          if (Platform.OS === 'web') {
            try {
              const response = await fetch(uri);
              const xml = await response.text();
              if (!cancelled) {
                svgXmlCache.set(uri, xml);
                setSvgXml((prev) => (prev === xml ? prev : xml));
              }
            } catch {
              // ignore, fall back to uri rendering
            }
          } else {
            try {
              const xml = await FileSystem.readAsStringAsync(uri);
              if (!cancelled) {
                svgXmlCache.set(uri, xml);
                setSvgXml((prev) => (prev === xml ? prev : xml));
              }
            } catch {
              if (typeof source === 'number') {
                try {
                  const asset = Asset.fromModule(source);
                  if (!asset.downloaded) {
                    await asset.downloadAsync();
                  }
                  const resolved = asset.localUri ?? asset.uri ?? null;
                  if (resolved) {
                    const cachedResolved = svgXmlCache.get(resolved);
                    if (cachedResolved) {
                      setSvgXml((prev) =>
                        prev === cachedResolved ? prev : cachedResolved
                      );
                      return;
                    }
                    const xml = await FileSystem.readAsStringAsync(resolved);
                    if (!cancelled) {
                      svgXmlCache.set(resolved, xml);
                      setSvgXml((prev) => (prev === xml ? prev : xml));
                    }
                  }
                } catch {
                  // ignore, fall back to uri rendering
                }
              }
            }
          }
        }
        return;
      }
      const fallbackSource = sourceRef.current;
      if (typeof fallbackSource === 'number') {
        const asset = Asset.fromModule(fallbackSource);
        if (!asset.downloaded && Platform.OS !== 'web') {
          await asset.downloadAsync();
        }
        if (!cancelled) {
          const resolved = asset.localUri ?? asset.uri ?? null;
          setSvgUri((prev) => (prev === resolved ? prev : resolved));
          if (resolved) {
            if (Platform.OS === 'web') {
              try {
                const cachedResolved = svgXmlCache.get(resolved);
                if (cachedResolved) {
                  setSvgXml((prev) =>
                    prev === cachedResolved ? prev : cachedResolved
                  );
                  return;
                }
                const response = await fetch(resolved);
                const xml = await response.text();
                if (!cancelled) {
                  svgXmlCache.set(resolved, xml);
                  setSvgXml((prev) => (prev === xml ? prev : xml));
                }
              } catch {
                // ignore, fall back to uri rendering
              }
            } else {
              try {
                const cachedResolved = svgXmlCache.get(resolved);
                if (cachedResolved) {
                  setSvgXml((prev) =>
                    prev === cachedResolved ? prev : cachedResolved
                  );
                  return;
                }
                const xml = await FileSystem.readAsStringAsync(resolved);
                if (!cancelled) {
                  svgXmlCache.set(resolved, xml);
                  setSvgXml((prev) => (prev === xml ? prev : xml));
                }
              } catch {
                // ignore, fall back to uri rendering
              }
            }
          }
        }
      }
    };
    void resolveSvg();
    return () => {
      cancelled = true;
    };
  }, [isSvg, uri]);

  useEffect(() => {
    if (!svgXml) {
      setSvgXmlWithOverrides((prev) => (prev === null ? prev : null));
      overrideRef.current = null;
      return;
    }
    const stripped = stripOuterBorder(svgXml);
    const next = applySvgOverrides(stripped, strokeColor, strokeWidth);
    if (overrideRef.current !== next) {
      overrideRef.current = next;
      setSvgXmlWithOverrides(next);
    }
  }, [svgXml, strokeColor, strokeWidth]);

  useEffect(() => {
    if (!isSvg || !onLoad || !svgUri || loadCalledRef.current) {
      return;
    }
    loadCalledRef.current = true;
    onLoad();
  }, [isSvg, onLoad, svgUri]);

  if (isSvg && svgUri) {
    if (svgXmlWithOverrides) {
      return (
        <SvgXml xml={svgXmlWithOverrides} width="100%" height="100%" style={style as any} />
      );
    }
    return (
      <SvgUri
        uri={svgUri}
        width="100%"
        height="100%"
        style={style as any}
        color={strokeColor}
      />
    );
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
