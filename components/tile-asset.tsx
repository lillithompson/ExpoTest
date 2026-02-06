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
const svgOverrideCache = new Map<string, string>();
const svgXmlInflight = new Map<string, Promise<string | null>>();

const cacheSvgXml = (primary: string, xml: string, alias?: string | null) => {
  svgXmlCache.set(primary, xml);
  if (alias && alias !== primary) {
    svgXmlCache.set(alias, xml);
  }
};

const loadSvgXmlOnce = async (
  primary: string,
  alias: string | null,
  loader: () => Promise<string>
) => {
  const cached = svgXmlCache.get(primary) ?? (alias ? svgXmlCache.get(alias) : null);
  if (cached) {
    return cached;
  }
  const inflightKey = alias ?? primary;
  const inflight = svgXmlInflight.get(inflightKey);
  if (inflight) {
    return inflight;
  }
  const promise = (async () => {
    try {
      const xml = await loader();
      if (xml) {
        cacheSvgXml(primary, xml, alias);
      }
      return xml;
    } catch {
      return null;
    } finally {
      svgXmlInflight.delete(inflightKey);
    }
  })();
  svgXmlInflight.set(inflightKey, promise);
  return promise;
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

const normalizeSvgRoot = (xml: string) => {
  const viewBoxMatch = xml.match(/viewBox=["']([^"']+)["']/i);
  let viewBox = viewBoxMatch?.[1];
  if (!viewBox) {
    const widthMatch = xml.match(/width=["']([^"']+)["']/i);
    const heightMatch = xml.match(/height=["']([^"']+)["']/i);
    if (widthMatch && heightMatch) {
      viewBox = `0 0 ${widthMatch[1]} ${heightMatch[1]}`;
    }
  }
  return xml.replace(/<svg\b([^>]*)>/i, (_match, attrs) => {
    let nextAttrs = attrs;
    nextAttrs = nextAttrs.replace(/\s(width|height)=["'][^"']*["']/gi, '');
    if (viewBox && !/viewBox=/.test(nextAttrs)) {
      nextAttrs += ` viewBox="${viewBox}"`;
    }
    if (!/preserveAspectRatio=/.test(nextAttrs)) {
      nextAttrs += ' preserveAspectRatio="xMidYMid meet"';
    }
    return `<svg${nextAttrs}>`;
  });
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
    if (!uri || !uri.toLowerCase().includes('.svg')) {
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
    const cached =
      svgXmlCache.get(uri) ?? svgXmlCache.get(resolvedUri);
    if (cached) {
      return;
    }
    await loadSvgXmlOnce(resolvedUri, uri, async () => {
      return Platform.OS === 'web'
        ? await fetch(resolvedUri).then((response) => response.text())
        : await FileSystem.readAsStringAsync(resolvedUri);
    });
  });
  await Promise.all(tasks);
};

export const getSvgXmlWithOverrides = async (
  source: unknown,
  strokeColor?: string,
  strokeWidth?: number
) => {
  const uri = resolveSourceUri(source);
  if (!uri || !uri.toLowerCase().includes('.svg')) {
    return null;
  }
  const overrideKey = `${uri}|${strokeColor ?? ''}|${strokeWidth ?? ''}`;
  const cachedOverride = svgOverrideCache.get(overrideKey);
  if (cachedOverride) {
    return cachedOverride;
  }

  const start = Date.now();
  if (uri.startsWith('data:image/svg+xml')) {
    const cached = svgXmlCache.get(uri);
    let xml = cached ?? '';
    if (!xml) {
      const parts = uri.split(',');
      const header = parts[0] ?? '';
      const body = parts.slice(1).join(',');
      if (header.includes(';base64')) {
        try {
          if (typeof atob === 'function') {
            xml = atob(body);
          }
        } catch {
          xml = '';
        }
      } else {
        try {
          xml = decodeURIComponent(body);
        } catch {
          xml = body;
        }
      }
      if (xml) {
        cacheSvgXml(uri, xml);
      }
    }
    if (!xml) {
      return null;
    }
    const stripped = stripOuterBorder(xml);
    const normalized = normalizeSvgRoot(stripped);
    const overridden = applySvgOverrides(normalized, strokeColor, strokeWidth);
    svgOverrideCache.set(overrideKey, overridden);
    console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: cached ? true : false });
    return overridden;
  }

  let resolvedUri = uri;
  if (typeof source === 'number') {
    const asset = Asset.fromModule(source);
    if (!asset.downloaded && Platform.OS !== 'web') {
      await asset.downloadAsync();
    }
    resolvedUri = asset.localUri ?? asset.uri ?? uri;
  }

  const xml = await loadSvgXmlOnce(resolvedUri, uri, async () => {
    return Platform.OS === 'web'
      ? await fetch(resolvedUri).then((response) => response.text())
      : await FileSystem.readAsStringAsync(resolvedUri);
  });
  if (!xml) {
    return null;
  }
  const stripped = stripOuterBorder(xml);
  const normalized = normalizeSvgRoot(stripped);
  const overridden = applySvgOverrides(normalized, strokeColor, strokeWidth);
  svgOverrideCache.set(overrideKey, overridden);
  return overridden;
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
    const overrideKey = uri
      ? `${uri}|${strokeColor ?? ''}|${strokeWidth ?? ''}`
      : null;
    if (overrideKey) {
      const cachedOverride = svgOverrideCache.get(overrideKey);
      if (cachedOverride) {
        setSvgXml((prev) => (prev === cachedOverride ? prev : cachedOverride));
        setSvgXmlWithOverrides((prev) =>
          prev === cachedOverride ? prev : cachedOverride
        );
        overrideRef.current = cachedOverride;
        setSvgUri((prev) => (prev === uri ? prev : uri));
        return () => {
          cancelled = true;
        };
      }
    }
    const resolveSvg = async () => {
      const start = Date.now();
      if (uri) {
        if (!cancelled) {
          setSvgUri((prev) => (prev === uri ? prev : uri));
          if (uri.startsWith('data:image/svg+xml')) {
            const cached = svgXmlCache.get(uri);
            if (cached) {
              setSvgXml((prev) => (prev === cached ? prev : cached));
              console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: true });
              return;
            }
            const parts = uri.split(',');
            const header = parts[0] ?? '';
            const body = parts.slice(1).join(',');
            let xml = '';
            if (header.includes(';base64')) {
              try {
                if (typeof atob === 'function') {
                  xml = atob(body);
                }
              } catch {
                xml = '';
              }
            } else {
              try {
                xml = decodeURIComponent(body);
              } catch {
                xml = body;
              }
            }
            if (!cancelled && xml) {
              cacheSvgXml(uri, xml);
              setSvgXml((prev) => (prev === xml ? prev : xml));
              console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: false });
              return;
            }
          }
          const cached = svgXmlCache.get(uri);
          if (cached) {
            setSvgXml((prev) => (prev === cached ? prev : cached));
            console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: true });
            return;
          }
          if (Platform.OS === 'web') {
            try {
              const response = await fetch(uri);
              const xml = await response.text();
              if (!cancelled) {
                cacheSvgXml(uri, xml);
                setSvgXml((prev) => (prev === xml ? prev : xml));
                console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: false });
              }
            } catch {
              // ignore, fall back to uri rendering
            }
          } else {
            try {
              const xml = await FileSystem.readAsStringAsync(uri);
              if (!cancelled) {
                cacheSvgXml(uri, xml);
                setSvgXml((prev) => (prev === xml ? prev : xml));
                console.log('[perf:svg-load]', { uri, ms: Date.now() - start, cache: false });
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
                      console.log('[perf:svg-load]', {
                        uri: resolved,
                        ms: Date.now() - start,
                        cache: true,
                      });
                      return;
                    }
                    const xml = await FileSystem.readAsStringAsync(resolved);
                    if (!cancelled) {
                      cacheSvgXml(resolved, xml, uri);
                      setSvgXml((prev) => (prev === xml ? prev : xml));
                      console.log('[perf:svg-load]', {
                        uri: resolved,
                        ms: Date.now() - start,
                        cache: false,
                      });
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
                  console.log('[perf:svg-load]', {
                    uri: resolved,
                    ms: Date.now() - start,
                    cache: true,
                  });
                  return;
                }
                const response = await fetch(resolved);
                const xml = await response.text();
                if (!cancelled) {
                  cacheSvgXml(resolved, xml, uri);
                  setSvgXml((prev) => (prev === xml ? prev : xml));
                  console.log('[perf:svg-load]', {
                    uri: resolved,
                    ms: Date.now() - start,
                    cache: false,
                  });
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
                  console.log('[perf:svg-load]', {
                    uri: resolved,
                    ms: Date.now() - start,
                    cache: true,
                  });
                  return;
                }
                const xml = await FileSystem.readAsStringAsync(resolved);
                if (!cancelled) {
                  svgXmlCache.set(resolved, xml);
                  setSvgXml((prev) => (prev === xml ? prev : xml));
                  console.log('[perf:svg-load]', {
                    uri: resolved,
                    ms: Date.now() - start,
                    cache: false,
                  });
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
    const normalized = normalizeSvgRoot(stripped);
    const next = applySvgOverrides(normalized, strokeColor, strokeWidth);
    if (overrideRef.current !== next) {
      overrideRef.current = next;
      setSvgXmlWithOverrides(next);
    }
  }, [svgXml, strokeColor, strokeWidth]);
  useEffect(() => {
    if (!svgXml || !uri) {
      return;
    }
    const key = `${uri}|${strokeColor ?? ''}|${strokeWidth ?? ''}`;
    if (svgXmlWithOverrides && !svgOverrideCache.has(key)) {
      svgOverrideCache.set(key, svgXmlWithOverrides);
    }
  }, [svgXml, svgXmlWithOverrides, uri, strokeColor, strokeWidth]);

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
