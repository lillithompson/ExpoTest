/**
 * Bundle format for patterns and files that use UGC tile sets.
 * Ensures downloaded exports can be imported with no external dependencies
 * by embedding referenced tile sets in the same file.
 */

import type { TileCategory } from '@/assets/images/tiles/manifest';
import type { TileSet } from '@/hooks/use-tile-sets';
import {
  TILE_FORMAT_VERSION,
  type TileFilePayload,
} from '@/utils/tile-format';
import type { Tile } from '@/utils/tile-grid';
import {
  TILE_UGC_FORMAT_VERSION,
  type PatternExportPayload,
  type TileSetExportPayload,
} from '@/utils/tile-ugc-format';
import {
  serializeTileSet,
  serializeTileSetForBundle,
} from '@/utils/tile-ugc-format';

export const TILE_BUNDLE_VERSION = 1;

export type TileSetInBundle = {
  setId: string;
  payload: TileSetExportPayload;
};

/** Self-contained pattern export including referenced UGC tile sets. */
export type PatternBundlePayload = {
  kind: 'patternBundle';
  v: number;
  tileSets: TileSetInBundle[];
  pattern: PatternExportPayload;
};

/** Self-contained file export including referenced UGC tile sets. */
export type FileBundlePayload = {
  kind: 'fileBundle';
  v: number;
  tileSets: TileSetInBundle[];
  file: TileFilePayload;
};

export type DeserializeBundleResult =
  | { ok: true; kind: 'patternBundle'; payload: PatternBundlePayload }
  | { ok: true; kind: 'fileBundle'; payload: FileBundlePayload }
  | { ok: false; error: string };

/**
 * Collect set IDs referenced by pattern tile names (e.g. "setId:tile_0_00000000.svg").
 */
export function getSetIdsFromPatternTiles(tiles: Tile[]): string[] {
  const ids = new Set<string>();
  for (const t of tiles) {
    const name = t.name;
    if (typeof name === 'string' && name.includes(':')) {
      const setId = name.split(':')[0];
      if (setId) ids.add(setId);
    }
  }
  return Array.from(ids);
}

/**
 * Collect set IDs referenced by file source names (e.g. "setId:tile_0.svg").
 * Use this together with file.tileSetIds so the bundle includes all UGC sets the file uses.
 */
export function getSetIdsFromFileSourceNames(sourceNames: string[]): string[] {
  const ids = new Set<string>();
  for (const name of sourceNames ?? []) {
    if (typeof name === 'string' && name.includes(':')) {
      const setId = name.split(':')[0];
      if (setId) ids.add(setId);
    }
  }
  return Array.from(ids);
}

/**
 * Returns true if the file references UGC tile sets (so it should be exported as a bundle).
 */
export function fileUsesUgc(file: {
  tileSetIds?: string[];
  sourceNames?: string[];
  tiles?: Tile[];
}): boolean {
  if (Array.isArray(file.tileSetIds) && file.tileSetIds.length > 0) return true;
  if (
    Array.isArray(file.sourceNames) &&
    file.sourceNames.some((n) => typeof n === 'string' && n.includes(':'))
  )
    return true;
  if (Array.isArray(file.tiles)) {
    const hasUgcName = file.tiles.some(
      (t) => typeof t.name === 'string' && t.name.includes(':')
    );
    if (hasUgcName) return true;
  }
  return false;
}

/**
 * Build a pattern bundle so the export can be imported with no dependencies.
 * Include only tile sets that are actually referenced by the pattern.
 */
export function serializePatternBundle(
  pattern: { name: string; category: PatternExportPayload['category']; width: number; height: number; tiles: Tile[]; createdAt: number },
  tileSetsById: Map<string, TileSet>
): string {
  const setIds = getSetIdsFromPatternTiles(pattern.tiles);
  const tileSets: TileSetInBundle[] = setIds
    .map((setId) => {
      const set = tileSetsById.get(setId);
      if (!set) return null;
      const payload = JSON.parse(serializeTileSetForBundle(set)) as TileSetExportPayload;
      return { setId, payload };
    })
    .filter((x): x is TileSetInBundle => x !== null);

  const patternPayload: PatternExportPayload = {
    kind: 'pattern',
    v: TILE_UGC_FORMAT_VERSION,
    name: pattern.name,
    category: pattern.category,
    width: pattern.width,
    height: pattern.height,
    tiles: pattern.tiles,
    createdAt: pattern.createdAt,
  };

  const bundle: PatternBundlePayload = {
    kind: 'patternBundle',
    v: TILE_BUNDLE_VERSION,
    tileSets,
    pattern: patternPayload,
  };
  return JSON.stringify(bundle, null, 0);
}

/**
 * Build a file bundle so the export can be imported with no dependencies.
 * Embeds all UGC tile sets referenced by the file (from tileSetIds and sourceNames)
 * so that re-import on a machine without those sets creates the sets and the file.
 */
export function serializeFileBundle(
  file: {
    name: string;
    grid: { rows: number; columns: number };
    tiles: Tile[];
    preferredTileSize: number;
    lineWidth: number;
    lineColor: string;
    sourceNames: string[];
    tileSetIds: string[];
    category: TileFilePayload['category'];
    categories: TileCategory[];
    lockedCells?: number[];
  },
  tileSetsById: Map<string, TileSet>
): string {
  const setIdsFromIds = new Set<string>(file.tileSetIds ?? []);
  const setIdsFromNames = getSetIdsFromFileSourceNames(file.sourceNames ?? []);
  setIdsFromNames.forEach((id) => setIdsFromIds.add(id));
  const setIdsToEmbed = Array.from(setIdsFromIds);
  const tileSets: TileSetInBundle[] = setIdsToEmbed
    .map((setId) => {
      const set = tileSetsById.get(setId);
      if (!set) return null;
      const payload = JSON.parse(serializeTileSetForBundle(set)) as TileSetExportPayload;
      return { setId, payload };
    })
    .filter((x): x is TileSetInBundle => x !== null);

  const filePayload: TileFilePayload = {
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

  const bundle: FileBundlePayload = {
    kind: 'fileBundle',
    v: TILE_BUNDLE_VERSION,
    tileSets,
    file: filePayload,
  };
  return JSON.stringify(bundle, null, 0);
}

/**
 * Parse JSON and detect if it is a pattern or file bundle.
 * Does not validate inner payloads; caller should deserialize tile sets and pattern/file.
 */
export function deserializeBundle(json: string): DeserializeBundleResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (data == null || typeof data !== 'object') {
    return { ok: false, error: 'Invalid bundle' };
  }
  const o = data as Record<string, unknown>;
  const v = o.v;
  if (typeof v !== 'number' || v !== TILE_BUNDLE_VERSION) {
    return { ok: false, error: 'Unsupported bundle version' };
  }
  if (o.kind === 'patternBundle') {
    if (!Array.isArray(o.tileSets) || typeof o.pattern !== 'object' || o.pattern == null) {
      return { ok: false, error: 'Invalid pattern bundle' };
    }
    return {
      ok: true,
      kind: 'patternBundle',
      payload: data as PatternBundlePayload,
    };
  }
  if (o.kind === 'fileBundle') {
    if (!Array.isArray(o.tileSets) || typeof o.file !== 'object' || o.file == null) {
      return { ok: false, error: 'Invalid file bundle' };
    }
    return {
      ok: true,
      kind: 'fileBundle',
      payload: data as FileBundlePayload,
    };
  }
  return { ok: false, error: 'Not a bundle file' };
}

/**
 * Remap pattern tile names from old set IDs to new set IDs after importing embedded tile sets.
 */
export function remapPatternTileNames(
  pattern: PatternExportPayload,
  oldToNewSetId: Map<string, string>
): PatternExportPayload {
  if (oldToNewSetId.size === 0) return pattern;
  const tiles = pattern.tiles.map((t) => {
    const name = t.name;
    if (typeof name !== 'string' || !name.includes(':')) return t;
    const colon = name.indexOf(':');
    const oldId = name.slice(0, colon);
    const rest = name.slice(colon);
    const newId = oldToNewSetId.get(oldId);
    if (!newId) return t;
    return { ...t, name: newId + rest };
  });
  return { ...pattern, tiles };
}

function remapQualifiedName(
  name: string,
  oldToNewSetId: Map<string, string>
): string {
  if (!name.includes(':')) return name;
  const colon = name.indexOf(':');
  const oldId = name.slice(0, colon);
  const rest = name.slice(colon);
  const newId = oldToNewSetId.get(oldId);
  return newId != null ? newId + rest : name;
}

/**
 * Remap file tileSetIds, sourceNames, and each tile's name from old set IDs to new set IDs after importing embedded tile sets.
 * Tile names must be remapped so that when the canvas resolves by tile.name it finds the newly imported set's baked source.
 */
export function remapFilePayload(
  file: TileFilePayload,
  oldToNewSetId: Map<string, string>
): TileFilePayload {
  if (oldToNewSetId.size === 0) return file;
  const tileSetIds = (file.tileSetIds ?? []).map(
    (id) => oldToNewSetId.get(id) ?? id
  );
  const sourceNames = (file.sourceNames ?? []).map((name) =>
    typeof name === 'string' ? remapQualifiedName(name, oldToNewSetId) : name
  );
  const tiles = (file.tiles ?? []).map((tile) => {
    const name = tile.name;
    if (typeof name !== 'string' || !name.includes(':')) return tile;
    return { ...tile, name: remapQualifiedName(name, oldToNewSetId) };
  });
  return { ...file, tileSetIds, sourceNames, tiles };
}
