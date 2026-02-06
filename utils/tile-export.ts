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
  backgroundColor?: string;
  backgroundLineColor?: string;
  backgroundLineWidth?: number;
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

const extractSvgContent = (xml: string) => {
  const cleaned = xml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim();
  const viewBoxMatch = cleaned.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = cleaned.match(/width=["']([^"']+)["']/i);
  const heightMatch = cleaned.match(/height=["']([^"']+)["']/i);
  const viewBox =
    viewBoxMatch?.[1] ??
    (widthMatch && heightMatch ? `0 0 ${widthMatch[1]} ${heightMatch[1]}` : null);
  const innerMatch = cleaned.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  let content = innerMatch ? innerMatch[1] : cleaned;
  content = content.replace(/<title>[\s\S]*?<\/title>/gi, '');
  return { viewBox, content };
};

const applyTransformToSvgContent = (content: string, transform: string) => {
  const withoutGroups = content
    .replace(/<defs[\s\S]*?<\/defs>/gi, '')
    .replace(/<\/?g\b[^>]*>/gi, '')
    .replace(/\sclip-path="[^"]*"/gi, '')
    .replace(/\sclip-path='[^']*'/gi, '');
  const tagRegex =
    /<(path|rect|circle|line|polyline|polygon|ellipse)\b([^>]*?)(\/?)>/gi;
  return withoutGroups.replace(tagRegex, (_match, tagName, attrs, selfClosing) => {
    let nextAttrs = attrs;
    if (/transform=/.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(
        /transform="([^"]*)"/i,
        (_t, existing) => `transform="${transform} ${existing}"`
      );
      nextAttrs = nextAttrs.replace(
        /transform='([^']*)'/i,
        (_t, existing) => `transform='${transform} ${existing}'`
      );
    } else {
      nextAttrs += ` transform="${transform}"`;
    }
    const closing = selfClosing === '/' ? ' />' : '>';
    return `<${tagName}${nextAttrs}${closing}`;
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

export const renderTileCanvasToSvg = async ({
  tiles,
  gridLayout,
  tileSources,
  gridGap,
  errorSource,
  lineColor,
  lineWidth,
  backgroundColor,
  sourceXmlCache,
  outputSize,
  strokeScaleByName,
}: Omit<ExportParams, 'blankSource' | 'backgroundLineColor' | 'backgroundLineWidth' | 'fileName'> & {
  sourceXmlCache?: Map<string, string>;
  outputSize?: number;
  strokeScaleByName?: Map<string, number>;
}): Promise<string | null> => {
  if (gridLayout.columns <= 0 || gridLayout.rows <= 0 || gridLayout.tileSize <= 0) {
    return null;
  }

  const totalWidth =
    gridLayout.columns * gridLayout.tileSize +
    gridGap * Math.max(0, gridLayout.columns - 1);
  const totalHeight =
    gridLayout.rows * gridLayout.tileSize +
    gridGap * Math.max(0, gridLayout.rows - 1);

  const svgParts: string[] = [];
  const normalizedSize =
    outputSize && outputSize > 0 ? outputSize : null;
  const viewWidth = normalizedSize ?? totalWidth;
  const viewHeight = normalizedSize ?? totalHeight;
  const scale =
    normalizedSize && totalWidth > 0 ? normalizedSize / totalWidth : 1;
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewWidth}" height="${viewHeight}" viewBox="0 0 ${viewWidth} ${viewHeight}">`
  );
  if (backgroundColor) {
    svgParts.push(
      `<rect width="${viewWidth}" height="${viewHeight}" fill="${backgroundColor}" />`
    );
  }
  if (scale !== 1) {
    svgParts.push(`<g transform="scale(${scale})">`);
  }

  const rawSvgCache = sourceXmlCache ?? new Map<string, string>();
  const svgCache = new Map<string, { content: string; viewBox: string | null }>();
  const dataUriCache = new Map<string, string>();
  const getRawSvg = async (uri: string) => {
    const cached = rawSvgCache.get(uri);
    if (cached) {
      return cached;
    }
    const response = await fetch(uri);
    const xml = await response.text();
    rawSvgCache.set(uri, xml);
    return xml;
  };
  const toDataUri = async (
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
    const cached = dataUriCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    if (!uri.toLowerCase().includes('.svg')) {
      dataUriCache.set(cacheKey, uri);
      return uri;
    }
    const xml = await getRawSvg(uri);
    let nextXml = stripOuterBorder(xml);
    if (overrides) {
      nextXml = applySvgOverrides(nextXml, overrides.strokeColor, overrides.strokeWidth);
    }
    const encoded = encodeURIComponent(nextXml);
    const dataUri = `data:image/svg+xml;utf8,${encoded}`;
    dataUriCache.set(cacheKey, dataUri);
    return dataUri;
  };

  const toInlineSvg = async (
    source: unknown,
    overrides?: { strokeColor?: string; strokeWidth?: number }
  ) => {
    const uri = resolveSourceUri(source);
    if (!uri || !uri.toLowerCase().includes('.svg')) {
      return null;
    }
    const cacheKey = overrides
      ? `${uri}|${overrides.strokeColor ?? ''}|${overrides.strokeWidth ?? ''}`
      : uri;
    const cached = svgCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const xml = await getRawSvg(uri);
    let nextXml = stripOuterBorder(xml);
    if (overrides) {
      nextXml = applySvgOverrides(nextXml, overrides.strokeColor, overrides.strokeWidth);
    }
    const extracted = extractSvgContent(nextXml);
    svgCache.set(cacheKey, extracted);
    return extracted;
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
          : null
        : tileSources[tile.imageIndex]?.source ?? errorSource;

    if (!source) {
      continue;
    }

    const tileName = tile.imageIndex >= 0 ? tileSources[tile.imageIndex]?.name ?? '' : '';
    const scale = strokeScaleByName?.get(tileName) ?? 1;
    const overrides =
      tile.imageIndex >= 0
        ? {
            strokeColor: lineColor,
            strokeWidth: lineWidth !== undefined ? lineWidth * scale : undefined,
          }
        : undefined;
    const center = gridLayout.tileSize / 2;
    const scaleX = tile.mirrorX ? -1 : 1;
    const scaleY = tile.mirrorY ? -1 : 1;
    const rotation = tile.rotation ?? 0;
    const transform = [
      `translate(${x} ${y})`,
      `translate(${center} ${center})`,
      `scale(${scaleX} ${scaleY})`,
      `rotate(${rotation})`,
      `translate(${-center} ${-center})`,
    ].join(' ');

    const inline = await toInlineSvg(source, overrides);
    if (inline) {
      const viewBox = inline.viewBox ?? `0 0 ${gridLayout.tileSize} ${gridLayout.tileSize}`;
      const viewParts = viewBox.split(/\s+/).map((part) => Number(part));
      const vbWidth = Number.isFinite(viewParts[2]) ? viewParts[2] : gridLayout.tileSize;
      const vbHeight = Number.isFinite(viewParts[3]) ? viewParts[3] : gridLayout.tileSize;
      const scaleXToTile = gridLayout.tileSize / vbWidth;
      const scaleYToTile = gridLayout.tileSize / vbHeight;
      const tileTransform = [
        `translate(${x} ${y})`,
        `translate(${center} ${center})`,
        `scale(${scaleX} ${scaleY})`,
        `rotate(${rotation})`,
        `translate(${-center} ${-center})`,
      ].join(' ');
      const fullTransform = `${tileTransform} scale(${scaleXToTile} ${scaleYToTile})`;
      svgParts.push(applyTransformToSvgContent(inline.content, fullTransform));
      continue;
    }

    const dataUri = await toDataUri(source, overrides);
    if (!dataUri) {
      continue;
    }
    svgParts.push(
      `<g transform="${transform}"><image href="${dataUri}" width="${gridLayout.tileSize}" height="${gridLayout.tileSize}" /></g>`
    );
  }

  if (scale !== 1) {
    svgParts.push('</g>');
  }
  svgParts.push('</svg>');
  return svgParts.join('');
};

export const exportTileCanvasAsSvg = async ({
  tiles,
  gridLayout,
  tileSources,
  gridGap,
  errorSource,
  lineColor,
  lineWidth,
  backgroundColor,
  fileName = 'tile-canvas.svg',
}: Omit<ExportParams, 'blankSource' | 'backgroundLineColor' | 'backgroundLineWidth'>): Promise<ExportResult> => {
  if (typeof document === 'undefined') {
    return { ok: false, error: 'Unable to export SVG.' };
  }
  const svg = await renderTileCanvasToSvg({
    tiles,
    gridLayout,
    tileSources,
    gridGap,
    errorSource,
    lineColor,
    lineWidth,
    backgroundColor,
  });
  if (!svg) {
    return { ok: false, error: 'Unable to render SVG.' };
  }
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  backgroundColor,
  backgroundLineColor,
  backgroundLineWidth,
  strokeScaleByName,
  maxDimension = 256,
  format = 'image/png',
  quality,
}: Omit<ExportParams, 'fileName'> & {
  strokeScaleByName?: Map<string, number>;
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

  if (backgroundColor) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  const lineWidthValue = Math.max(0, backgroundLineWidth ?? 0);
  if (lineWidthValue > 0 && backgroundLineColor) {
    ctx.strokeStyle = backgroundLineColor;
    ctx.lineWidth = lineWidthValue;
    ctx.beginPath();
    for (let col = 1; col < gridLayout.columns; col += 1) {
      const x = col * (gridLayout.tileSize + gridGap);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
    }
    for (let row = 1; row < gridLayout.rows; row += 1) {
      const y = row * (gridLayout.tileSize + gridGap);
      ctx.moveTo(0, y);
      ctx.lineTo(totalWidth, y);
    }
    ctx.stroke();
  }

  const uriCache = new Map<string, HTMLImageElement>();
  const svgCache = new Map<string, string>();
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
    if (uri.startsWith('data:')) {
      const lower = uri.toLowerCase();
      if (!lower.includes('image/svg+xml')) {
        const img = await loadImage(uri);
        uriCache.set(cacheKey, img);
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
      uriCache.set(cacheKey, img);
      return img;
    }
    if (uri.toLowerCase().includes('.svg')) {
      let xml = svgCache.get(uri);
      if (!xml) {
        try {
          const response = await fetch(uri);
          xml = await response.text();
        } catch {
          const img = await loadImage(uri);
          uriCache.set(cacheKey, img);
          return img;
        }
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
          : null
        : tileSources[tile.imageIndex]?.source ?? errorSource;

    if (!source) {
      continue;
    }

    const tileName = tile.imageIndex >= 0 ? tileSources[tile.imageIndex]?.name ?? '' : '';
    const scale = strokeScaleByName?.get(tileName) ?? 1;
    const img = await getImage(
      source,
      tile.imageIndex >= 0
        ? {
            strokeColor: lineColor,
            strokeWidth: lineWidth !== undefined ? lineWidth * scale : undefined,
          }
        : undefined
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
