import { Asset } from 'expo-asset';
import { Image as RNImage, Platform } from 'react-native';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { type GridLayout, type Tile } from '@/utils/tile-grid';

type ExportParams = {
  tiles: Tile[];
  gridLayout: GridLayout;
  tileSources: TileSource[];
  gridGap: number;
  blankSource: unknown;
  errorSource: unknown;
  lineColor?: string;
  lineWidth?: number;
  fileName?: string;
};

type ExportResult = { ok: true } | { ok: false; error: string };

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

export const exportTileCanvasAsPng = async ({
  tiles,
  gridLayout,
  tileSources,
  gridGap,
  blankSource,
  errorSource,
  fileName = 'tile-canvas.png',
}: ExportParams): Promise<ExportResult> => {
  const dataUrl = await renderTileCanvasToDataUrl({
    tiles,
    gridLayout,
    tileSources,
    gridGap,
    blankSource,
    errorSource,
  });
  if (!dataUrl) {
    return { ok: false, error: 'Unable to render canvas preview.' };
  }
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  return { ok: true };
};

export const renderTileCanvasToDataUrl = async ({
  tiles,
  gridLayout,
  tileSources,
  gridGap,
  blankSource,
  errorSource,
  lineColor,
  lineWidth,
  maxDimension = 256,
  format = 'image/png',
  quality,
}: Omit<ExportParams, 'fileName'> & {
  maxDimension?: number;
  format?: 'image/png' | 'image/jpeg';
  quality?: number;
}): Promise<string | null> => {
  if (Platform.OS !== 'web') {
    return null;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  if (gridLayout.columns <= 0 || gridLayout.rows <= 0 || gridLayout.tileSize <= 0) {
    return null;
  }

  const totalWidth =
    gridLayout.columns * gridLayout.tileSize +
    gridGap * Math.max(0, gridLayout.columns - 1);
  const totalHeight =
    gridLayout.rows * gridLayout.tileSize +
    gridGap * Math.max(0, gridLayout.rows - 1);

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  const uriCache = new Map<string, HTMLImageElement>();
  const svgCache = new Map<string, string>();
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
    const cached = uriCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (uri.toLowerCase().includes('.svg')) {
      let xml = svgCache.get(uri);
      if (!xml) {
        const response = await fetch(uri);
        xml = await response.text();
        svgCache.set(uri, xml);
      }
      let nextXml = stripOuterBorder(xml);
      if (overrides) {
        nextXml = applySvgOverrides(nextXml, overrides.strokeColor, overrides.strokeWidth);
      }
      const blob = new Blob([nextXml], { type: 'image/svg+xml' });
      const blobUrl = URL.createObjectURL(blob);
      const img = await loadImage(blobUrl);
      URL.revokeObjectURL(blobUrl);
      uriCache.set(cacheKey, img);
      return img;
    }
    const img = await loadImage(uri);
    uriCache.set(cacheKey, img);
    return img;
  };

  for (let index = 0; index < gridLayout.rows * gridLayout.columns; index += 1) {
    const tile = tiles[index];
    if (!tile) {
      continue;
    }
    const row = Math.floor(index / gridLayout.columns);
    const col = index % gridLayout.columns;
    const x = col * (gridLayout.tileSize + gridGap);
    const y = row * (gridLayout.tileSize + gridGap);

    const source =
      tile.imageIndex < 0
        ? tile.imageIndex === -2
          ? errorSource
          : blankSource
        : tileSources[tile.imageIndex]?.source ?? errorSource;

    const img = await getImage(
      source,
      tile.imageIndex >= 0 ? { strokeColor: lineColor, strokeWidth: lineWidth } : undefined
    );
    if (!img) {
      continue;
    }

    ctx.save();
    ctx.translate(x + gridLayout.tileSize / 2, y + gridLayout.tileSize / 2);
    ctx.scale(tile.mirrorX ? -1 : 1, tile.mirrorY ? -1 : 1);
    ctx.rotate(((tile.rotation || 0) * Math.PI) / 180);
    ctx.drawImage(
      img,
      -gridLayout.tileSize / 2,
      -gridLayout.tileSize / 2,
      gridLayout.tileSize,
      gridLayout.tileSize
    );
    ctx.restore();
  }

  if (maxDimension > 0) {
    const scale = Math.min(1, maxDimension / Math.max(totalWidth, totalHeight));
    if (scale < 1) {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = Math.max(1, Math.floor(totalWidth * scale));
      thumbCanvas.height = Math.max(1, Math.floor(totalHeight * scale));
      const thumbCtx = thumbCanvas.getContext('2d');
      if (thumbCtx) {
        thumbCtx.imageSmoothingEnabled = false;
        thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
        return thumbCanvas.toDataURL(format, quality);
      }
    }
  }

  return canvas.toDataURL(format, quality);
};
