import { Asset } from 'expo-asset';
import { Image as RNImage } from 'react-native';

import { type TileSource } from '@/assets/images/tiles/manifest';

type AtlasEntry = {
  name: string;
  x: number;
  y: number;
  size: number;
};

export type TileAtlas = {
  uri: string;
  width: number;
  height: number;
  tileSize: number;
  entries: Map<string, AtlasEntry>;
};

type BuildParams = {
  tileSources: TileSource[];
  tileSize: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeScaleByName?: Map<string, number>;
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
  const resolveAssetSource = (RNImage as any)?.resolveAssetSource;
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

const loadImage = (uri: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${uri}`));
    img.src = uri;
  });

const stripOuterBorder = (xml: string) =>
  xml.replace(/<rect\b[^>]*(x=["']0\.5["']|y=["']0\.5["'])[^>]*\/?>/gi, '');

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
      next = next.replace(
        /<svg\b([^>]*)>/i,
        `<svg$1 stroke-width="${strokeWidth}">`
      );
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

const decodeDataSvg = (uri: string) => {
  const commaIndex = uri.indexOf(',');
  if (commaIndex < 0) {
    return null;
  }
  const meta = uri.slice(0, commaIndex).toLowerCase();
  const data = uri.slice(commaIndex + 1);
  try {
    if (meta.includes(';base64')) {
      return atob(data);
    }
    return decodeURIComponent(data);
  } catch {
    return null;
  }
};

export const buildTileAtlas = async ({
  tileSources,
  tileSize,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
}: BuildParams): Promise<TileAtlas | null> => {
  if (typeof document === 'undefined') {
    return null;
  }
  if (tileSize <= 0 || tileSources.length === 0) {
    return null;
  }

  const columns = Math.max(1, Math.ceil(Math.sqrt(tileSources.length)));
  const rows = Math.max(1, Math.ceil(tileSources.length / columns));
  const width = columns * tileSize;
  const height = rows * tileSize;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const svgCache = new Map<string, string>();
  const imageCache = new Map<string, HTMLImageElement>();

  const getSvgXml = async (uri: string) => {
    const cached = svgCache.get(uri);
    if (cached) {
      return cached;
    }
    const response = await fetch(uri);
    const xml = await response.text();
    svgCache.set(uri, xml);
    return xml;
  };

  const getImage = async (
    source: unknown,
    overrides?: { strokeColor?: string; strokeWidth?: number }
  ) => {
    const uri = resolveSourceUri(source);
    if (!uri) {
      return null;
    }
    const cacheKey = overrides
      ? `${uri}|${overrides.strokeColor ?? ''}|${overrides.strokeWidth ?? ''}`
      : uri;
    const cached = imageCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (uri.startsWith('data:')) {
      const lower = uri.toLowerCase();
      if (!lower.includes('image/svg+xml')) {
        const img = await loadImage(uri);
        imageCache.set(cacheKey, img);
        return img;
      }
      const rawSvg = decodeDataSvg(uri);
      if (!rawSvg) {
        return null;
      }
      let nextXml = stripOuterBorder(rawSvg);
      if (overrides) {
        nextXml = applySvgOverrides(nextXml, overrides.strokeColor, overrides.strokeWidth);
      }
      const blob = new Blob([nextXml], { type: 'image/svg+xml' });
      const blobUrl = URL.createObjectURL(blob);
      const img = await loadImage(blobUrl);
      URL.revokeObjectURL(blobUrl);
      imageCache.set(cacheKey, img);
      return img;
    }
    if (uri.toLowerCase().includes('.svg')) {
      let xml: string;
      try {
        xml = await getSvgXml(uri);
      } catch {
        const img = await loadImage(uri);
        imageCache.set(cacheKey, img);
        return img;
      }
      let nextXml = stripOuterBorder(xml);
      if (overrides) {
        nextXml = applySvgOverrides(nextXml, overrides.strokeColor, overrides.strokeWidth);
      }
      const blob = new Blob([nextXml], { type: 'image/svg+xml' });
      const blobUrl = URL.createObjectURL(blob);
      const img = await loadImage(blobUrl);
      URL.revokeObjectURL(blobUrl);
      imageCache.set(cacheKey, img);
      return img;
    }
    const img = await loadImage(uri);
    imageCache.set(cacheKey, img);
    return img;
  };

  const images = await Promise.all(
    tileSources.map(async (source, index) => {
      const scale = strokeScaleByName?.get(source.name) ?? 1;
      const overrides =
        strokeWidth !== undefined || strokeColor
          ? {
              strokeColor,
              strokeWidth:
                strokeWidth !== undefined ? strokeWidth * scale : undefined,
            }
          : undefined;
      try {
        const img = await getImage(source.source, overrides);
        return img ? { index, img, name: source.name } : null;
      } catch {
        return null;
      }
    })
  );

  const entries = new Map<string, AtlasEntry>();
  images.forEach((entry) => {
    if (!entry) {
      return;
    }
    const row = Math.floor(entry.index / columns);
    const col = entry.index % columns;
    const x = col * tileSize;
    const y = row * tileSize;
    ctx.drawImage(entry.img, x, y, tileSize, tileSize);
    entries.set(entry.name, { name: entry.name, x, y, size: tileSize });
  });

  const uri = canvas.toDataURL('image/png');
  return { uri, width, height, tileSize, entries };
};
