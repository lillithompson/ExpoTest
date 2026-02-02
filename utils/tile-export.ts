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
  maxDimension = 256,
}: Omit<ExportParams, 'fileName'> & { maxDimension?: number }): Promise<string | null> => {
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
  const getImage = async (source: unknown) => {
    const uri = resolveSourceUri(source);
    if (!uri) {
      return null;
    }
    const cached = uriCache.get(uri);
    if (cached) {
      return cached;
    }
    const img = await loadImage(uri);
    uriCache.set(uri, img);
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

    const img = await getImage(source);
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
        return thumbCanvas.toDataURL('image/png');
      }
    }
  }

  return canvas.toDataURL('image/png');
};
