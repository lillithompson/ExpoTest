/**
 * Serialize/deserialize UGC tile sets and patterns to the custom .tile file format.
 * Uses versioned JSON with a kind discriminator (tileSet | pattern) for future import.
 */

import { TILE_CATEGORIES, type TileCategory } from '@/assets/images/tiles/manifest';
import type { Tile } from '@/utils/tile-grid';
import type { TileSet, TileSetTile } from '@/hooks/use-tile-sets';
import type { TilePattern } from '@/hooks/use-tile-patterns';

export const TILE_UGC_FORMAT_VERSION = 1;

/** Exported tile set (no id, no thumbnailUri/previewUri/updatedAt on set or tile entries). */
export type TileSetExportPayload = {
  kind: 'tileSet';
  v: number;
  name: string;
  category: TileCategory;
  categories: TileCategory[];
  resolution: number;
  lineWidth: number;
  lineColor: string;
  tiles: Array<{
    id: string;
    name: string;
    grid: { rows: number; columns: number };
    preferredTileSize: number;
    tiles: Tile[];
  }>;
};

/** Exported pattern (no id). */
export type PatternExportPayload = {
  kind: 'pattern';
  v: number;
  name: string;
  category: TileCategory;
  width: number;
  height: number;
  tiles: Tile[];
  createdAt: number;
};

function isValidCategory(value: unknown): value is TileCategory {
  return (
    typeof value === 'string' && (TILE_CATEGORIES as string[]).includes(value)
  );
}

function normalizeTile(raw: unknown): Tile | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const imageIndex =
    typeof o.imageIndex === 'number' && Number.isInteger(o.imageIndex)
      ? o.imageIndex
      : -1;
  const rotation =
    typeof o.rotation === 'number' && Number.isInteger(o.rotation)
      ? o.rotation % 360
      : 0;
  const mirrorX = o.mirrorX === true;
  const mirrorY = o.mirrorY === true;
  const name =
    typeof o.name === 'string' && o.name.length > 0 ? o.name : undefined;
  return {
    imageIndex,
    rotation,
    mirrorX,
    mirrorY,
    ...(name !== undefined && { name }),
  };
}

/**
 * Serialize a tile set to .tile JSON string.
 */
export function serializeTileSet(set: TileSet): string {
  const payload: TileSetExportPayload = {
    kind: 'tileSet',
    v: TILE_UGC_FORMAT_VERSION,
    name: set.name,
    category: set.category,
    categories: set.categories ?? [set.category],
    resolution: set.resolution,
    lineWidth: set.lineWidth,
    lineColor: set.lineColor,
    tiles: set.tiles.map((t) => ({
      id: t.id,
      name: t.name,
      grid: t.grid,
      preferredTileSize: t.preferredTileSize,
      tiles: t.tiles,
    })),
  };
  return JSON.stringify(payload, null, 0);
}

/**
 * Serialize a pattern to .tile JSON string.
 */
export function serializePattern(pattern: TilePattern): string {
  const payload: PatternExportPayload = {
    kind: 'pattern',
    v: TILE_UGC_FORMAT_VERSION,
    name: pattern.name,
    category: pattern.category,
    width: pattern.width,
    height: pattern.height,
    tiles: pattern.tiles,
    createdAt: pattern.createdAt,
  };
  return JSON.stringify(payload, null, 0);
}

export type DeserializeTileSetResult =
  | { ok: true; payload: TileSetExportPayload }
  | { ok: false; error: string };

export type DeserializePatternResult =
  | { ok: true; payload: PatternExportPayload }
  | { ok: false; error: string };

/**
 * Deserialize a .tile string that is a tile set export.
 */
export function deserializeTileSet(json: string): DeserializeTileSetResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'Invalid .tile file' };
  }
  const o = data as Record<string, unknown>;
  if (o.kind !== 'tileSet') {
    return { ok: false, error: 'Not a tile set .tile file' };
  }
  const v = o.v;
  if (typeof v !== 'number' || v !== TILE_UGC_FORMAT_VERSION) {
    return { ok: false, error: 'Unsupported .tile version' };
  }
  const name = typeof o.name === 'string' ? o.name : 'Imported Set';
  const fallbackCategory = TILE_CATEGORIES[0] as TileCategory;
  const category = isValidCategory(o.category) ? o.category : fallbackCategory;
  const rawCategories = o.categories;
  const categories: TileCategory[] = Array.isArray(rawCategories)
    ? (rawCategories as unknown[]).filter(isValidCategory)
    : [category];
  const resolution =
    typeof o.resolution === 'number' && o.resolution >= 2 && o.resolution <= 8
      ? o.resolution
      : 4;
  const lineWidth =
    typeof o.lineWidth === 'number' && o.lineWidth >= 0 ? o.lineWidth : 3;
  const lineColor =
    typeof o.lineColor === 'string' && o.lineColor.length > 0
      ? o.lineColor
      : '#ffffff';
  const rawTiles = o.tiles;
  const tiles: TileSetExportPayload['tiles'] = [];
  if (Array.isArray(rawTiles)) {
    for (const raw of rawTiles as unknown[]) {
      if (raw == null || typeof raw !== 'object') continue;
      const t = raw as Record<string, unknown>;
      const grid = t.grid;
      const rows =
        grid && typeof grid === 'object' && typeof (grid as { rows?: number }).rows === 'number'
          ? Math.max(0, (grid as { rows: number }).rows)
          : 0;
      const columns =
        grid && typeof grid === 'object' && typeof (grid as { columns?: number }).columns === 'number'
          ? Math.max(0, (grid as { columns: number }).columns)
          : 0;
      const preferredTileSize =
        typeof t.preferredTileSize === 'number' && t.preferredTileSize > 0
          ? t.preferredTileSize
          : 45;
      const tileName = typeof t.name === 'string' ? t.name : 'Tile';
      const tileId = typeof t.id === 'string' ? t.id : `tile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rawCellTiles = t.tiles;
      const totalCells = rows * columns;
      const cellTiles: Tile[] = Array.isArray(rawCellTiles)
        ? (rawCellTiles as unknown[])
            .slice(0, totalCells)
            .map((c) => normalizeTile(c))
            .filter((c): c is Tile => c !== null)
        : [];
      while (cellTiles.length < totalCells) {
        cellTiles.push({
          imageIndex: -1,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
        });
      }
      tiles.push({
        id: tileId,
        name: tileName,
        grid: { rows, columns },
        preferredTileSize,
        tiles: cellTiles,
      });
    }
  }
  const payload: TileSetExportPayload = {
    kind: 'tileSet',
    v: TILE_UGC_FORMAT_VERSION,
    name,
    category: categories[0] ?? fallbackCategory,
    categories: categories.length > 0 ? categories : [fallbackCategory],
    resolution,
    lineWidth,
    lineColor,
    tiles,
  };
  return { ok: true, payload };
}

/**
 * Deserialize a .tile string that is a pattern export.
 */
export function deserializePattern(json: string): DeserializePatternResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'Invalid .tile file' };
  }
  const o = data as Record<string, unknown>;
  if (o.kind !== 'pattern') {
    return { ok: false, error: 'Not a pattern .tile file' };
  }
  const v = o.v;
  if (typeof v !== 'number' || v !== TILE_UGC_FORMAT_VERSION) {
    return { ok: false, error: 'Unsupported .tile version' };
  }
  const name = typeof o.name === 'string' ? o.name : 'Imported Pattern';
  const fallbackCategory = TILE_CATEGORIES[0] as TileCategory;
  const category = isValidCategory(o.category) ? o.category : fallbackCategory;
  const width = typeof o.width === 'number' && o.width > 0 ? o.width : 1;
  const height = typeof o.height === 'number' && o.height > 0 ? o.height : 1;
  const createdAt =
    typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)
      ? o.createdAt
      : Date.now();
  const rawTiles = o.tiles;
  const totalCells = width * height;
  const tiles: Tile[] = Array.isArray(rawTiles)
    ? (rawTiles as unknown[])
        .slice(0, totalCells)
        .map((c) => normalizeTile(c))
        .filter((c): c is Tile => c !== null)
    : [];
  while (tiles.length < totalCells) {
    tiles.push({
      imageIndex: -1,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    });
  }
  const payload: PatternExportPayload = {
    kind: 'pattern',
    v: TILE_UGC_FORMAT_VERSION,
    name,
    category,
    width,
    height,
    tiles,
    createdAt,
  };
  return { ok: true, payload };
}
