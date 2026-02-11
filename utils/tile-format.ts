/**
 * Serialize/deserialize a tile canvas to the custom .tile file format.
 * Format is versioned JSON for future compatibility.
 */

import { TILE_CATEGORIES, type TileCategory } from '@/assets/images/tiles/manifest';
import type { Tile } from '@/utils/tile-grid';

export const TILE_FORMAT_VERSION = 1;

export type TileFilePayload = {
  v: number;
  name: string;
  grid: { rows: number; columns: number };
  tiles: Tile[];
  preferredTileSize: number;
  lineWidth: number;
  lineColor: string;
  sourceNames: string[];
  tileSetIds: string[];
  category: TileCategory;
  categories: TileCategory[];
  lockedCells?: number[];
};

type TileFileExport = {
  id?: never;
  thumbnailUri?: never;
  previewUri?: never;
  updatedAt?: never;
} & TileFilePayload;

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
 * Serialize a tile file to the .tile JSON string (no id, thumbnailUri, previewUri, updatedAt).
 */
export function serializeTileFile(file: {
  name: string;
  grid: { rows: number; columns: number };
  tiles: Tile[];
  preferredTileSize: number;
  lineWidth: number;
  lineColor: string;
  sourceNames: string[];
  tileSetIds: string[];
  category: TileCategory;
  categories: TileCategory[];
  lockedCells?: number[];
}): string {
  const payload: TileFileExport = {
    v: TILE_FORMAT_VERSION,
    name: file.name,
    grid: file.grid,
    tiles: file.tiles,
    preferredTileSize: file.preferredTileSize,
    lineWidth: file.lineWidth,
    lineColor: file.lineColor,
    sourceNames: file.sourceNames ?? [],
    tileSetIds: file.tileSetIds ?? [],
    category: file.category,
    categories: file.categories ?? [file.category],
    ...(Array.isArray(file.lockedCells) &&
      file.lockedCells.length > 0 && { lockedCells: file.lockedCells }),
  };
  return JSON.stringify(payload, null, 0);
}

export type DeserializeResult =
  | { ok: true; payload: TileFilePayload }
  | { ok: false; error: string };

/**
 * Deserialize a .tile file string into a validated payload.
 * Caller should create a TileFile from payload (new id, updatedAt, thumbnailUri/previewUri null).
 */
export function deserializeTileFile(json: string): DeserializeResult {
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
  const v = o.v;
  if (typeof v !== 'number' || v !== TILE_FORMAT_VERSION) {
    return { ok: false, error: 'Unsupported .tile version' };
  }
  const name = typeof o.name === 'string' ? o.name : 'Imported';
  const grid = o.grid;
  if (
    !grid ||
    typeof grid !== 'object' ||
    typeof (grid as { rows?: unknown }).rows !== 'number' ||
    typeof (grid as { columns?: unknown }).columns !== 'number'
  ) {
    return { ok: false, error: 'Invalid grid' };
  }
  const rows = Math.max(0, (grid as { rows: number }).rows);
  const columns = Math.max(0, (grid as { columns: number }).columns);
  const totalCells = rows * columns;
  const rawTiles = o.tiles;
  const tiles: Tile[] = Array.isArray(rawTiles)
    ? rawTiles
        .slice(0, totalCells)
        .map((t) => normalizeTile(t))
        .filter((t): t is Tile => t !== null)
    : [];
  while (tiles.length < totalCells) {
    tiles.push({
      imageIndex: -1,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    });
  }
  const preferredTileSize =
    typeof o.preferredTileSize === 'number' && o.preferredTileSize > 0
      ? o.preferredTileSize
      : 45;
  const lineWidth =
    typeof o.lineWidth === 'number' && o.lineWidth >= 0 ? o.lineWidth : 10;
  const lineColor =
    typeof o.lineColor === 'string' && o.lineColor.length > 0
      ? o.lineColor
      : '#ffffff';
  const sourceNames = Array.isArray(o.sourceNames)
    ? (o.sourceNames as unknown[]).filter(
        (n): n is string => typeof n === 'string'
      )
    : [];
  const tileSetIds = Array.isArray(o.tileSetIds)
    ? (o.tileSetIds as unknown[]).filter(
        (id): id is string => typeof id === 'string'
      )
    : [];
  const fallbackCategory = TILE_CATEGORIES[0] as TileCategory;
  const category = isValidCategory(o.category) ? o.category : fallbackCategory;
  const rawCategories = o.categories;
  const categories: TileCategory[] = Array.isArray(rawCategories)
    ? (rawCategories as unknown[]).filter(isValidCategory)
    : [category];
  const finalCategories =
    categories.length > 0 ? categories : [fallbackCategory];
  let lockedCells: number[] = [];
  if (Array.isArray(o.lockedCells) && totalCells > 0) {
    lockedCells = (o.lockedCells as unknown[])
      .filter(
        (i): i is number =>
          typeof i === 'number' &&
          Number.isInteger(i) &&
          i >= 0 &&
          i < totalCells
      )
      .slice(0, totalCells);
  }
  const payload: TileFilePayload = {
    v: TILE_FORMAT_VERSION,
    name,
    grid: { rows, columns },
    tiles,
    preferredTileSize,
    lineWidth,
    lineColor,
    sourceNames,
    tileSetIds,
    category: finalCategories[0] ?? fallbackCategory,
    categories: finalCategories,
    ...(lockedCells.length > 0 && { lockedCells }),
  };
  return { ok: true, payload };
}
