/**
 * Pure helpers for keeping design files in sync when tile sets or tiles are
 * modified or removed. Used by use-tile-files and tested so file corruption
 * does not regress.
 */

import type { Tile } from './tile-grid';

const ERROR_TILE_CELL: Tile = {
  imageIndex: -2,
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
};

export type ApplyRemovedOptions = { namePrefix?: string };

/**
 * Returns whether a source name should be treated as removed (exact match or prefix).
 */
export function isRemovedSourceName(
  name: string,
  removedNames: Set<string>,
  namePrefix: string
): boolean {
  return removedNames.has(name) || (namePrefix !== '' && name.startsWith(namePrefix));
}

/**
 * Applies "removed sources" to a file: replaces any tile that references a removed
 * source (by name or by imageIndex into sourceNames) with the tile_error tile, and
 * removes those names from sourceNames. Ensures files do not corrupt when a tile set
 * or single tile is deleted.
 */
export function applyRemovedSourcesToFile(
  file: { tiles: Tile[]; sourceNames: string[] },
  removedNames: string[],
  options?: ApplyRemovedOptions
): { tiles: Tile[]; sourceNames: string[]; changed: boolean } {
  const removedSet = new Set(removedNames);
  const prefix = options?.namePrefix ?? '';
  const matchName = (name: string) =>
    isRemovedSourceName(name, removedSet, prefix);

  if (removedNames.length === 0 && prefix === '') {
    return { tiles: file.tiles, sourceNames: file.sourceNames, changed: false };
  }

  const sourceNames = file.sourceNames ?? [];
  const removedIndices = new Set<number>();
  for (let i = 0; i < sourceNames.length; i += 1) {
    if (matchName(sourceNames[i])) {
      removedIndices.add(i);
    }
  }

  const newSourceNames = sourceNames.filter((n) => !matchName(n));
  const nameToNewIndex = new Map<string, number>();
  newSourceNames.forEach((name, i) => nameToNewIndex.set(name, i));
  let fileChanged = removedIndices.size > 0 || newSourceNames.length !== sourceNames.length;

  const newTiles = file.tiles.map((tile) => {
    const byName = tile.name && matchName(tile.name);
    const byRemovedIndex = tile.imageIndex >= 0 && removedIndices.has(tile.imageIndex);
    if (byName || byRemovedIndex) {
      fileChanged = true;
      return { ...ERROR_TILE_CELL };
    }
    if (tile.imageIndex >= 0 && tile.imageIndex < sourceNames.length) {
      const oldName = sourceNames[tile.imageIndex];
      const newIndex = nameToNewIndex.get(oldName);
      if (newIndex !== undefined) {
        if (tile.imageIndex !== newIndex || tile.name !== oldName) {
          fileChanged = true;
        }
        return { ...tile, imageIndex: newIndex, name: oldName };
      }
    }
    if (tile.imageIndex >= 0 && tile.imageIndex >= newSourceNames.length) {
      fileChanged = true;
      return { ...ERROR_TILE_CELL };
    }
    return tile;
  });

  return {
    tiles: newTiles,
    sourceNames: newSourceNames,
    changed: fileChanged,
  };
}
