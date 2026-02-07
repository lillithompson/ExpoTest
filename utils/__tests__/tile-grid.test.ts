/**
 * Tests for tile-grid utils. These guard UGC vs built-in tile resolution:
 * - Hydration must assign tile.name from the file's sourceNames so rendering uses name, not index.
 * - When source order differs (e.g. Expo Go built-in first vs UGC first), index-only resolution shows wrong tiles.
 */
import type { Tile } from '../tile-grid';
import {
  buildInitialTiles,
  getTileSourceIndexByName,
  hydrateTilesWithSourceNames,
  normalizeTiles,
  resolveDisplaySource,
} from '../tile-grid';

describe('hydrateTilesWithSourceNames', () => {
  it('assigns name from sourceNames[tile.imageIndex] when tile has no name', () => {
    const ugcSourceNames = [
      'ugc-tile-0.svg',
      'ugc-tile-1.svg',
      'built-in-0.svg',
    ];
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 90, mirrorX: true, mirrorY: false },
      { imageIndex: 2, rotation: 180, mirrorX: false, mirrorY: true },
    ];
    const result = hydrateTilesWithSourceNames(tiles, ugcSourceNames);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('ugc-tile-0.svg');
    expect(result[1].name).toBe('ugc-tile-1.svg');
    expect(result[2].name).toBe('built-in-0.svg');
    expect(result[0].rotation).toBe(0);
    expect(result[1].mirrorX).toBe(true);
  });

  it('leaves tiles with imageIndex < 0 unchanged', () => {
    const sourceNames = ['a.svg', 'b.svg'];
    const tiles: Tile[] = [
      { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: -2, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, sourceNames);
    expect(result[0].name).toBeUndefined();
    expect(result[1].name).toBeUndefined();
  });

  it('does not overwrite existing tile.name', () => {
    const sourceNames = ['wrong.svg', 'also-wrong.svg'];
    const tiles: Tile[] = [
      {
        imageIndex: 0,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        name: 'ugc-correct.svg',
      },
    ];
    const result = hydrateTilesWithSourceNames(tiles, sourceNames);
    expect(result[0].name).toBe('ugc-correct.svg');
  });

  it('returns same array when sourceNames is empty', () => {
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, []);
    expect(result).toBe(tiles);
    expect(result[0].name).toBeUndefined();
  });

  it('uses file sourceNames order so UGC index 0 is UGC name not built-in', () => {
    const fileSourceNames = [
      'tileset-123:ugc_0.svg',
      'tileset-123:ugc_1.svg',
      'tile_00000000.svg',
    ];
    const tiles: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    const result = hydrateTilesWithSourceNames(tiles, fileSourceNames);
    expect(result[0].name).toBe('tileset-123:ugc_0.svg');
    expect(result[1].name).toBe('tileset-123:ugc_1.svg');
  });
});

describe('normalizeTiles', () => {
  it('preserves tile.name when extending array', () => {
    const current: Tile[] = [
      {
        imageIndex: 1,
        rotation: 0,
        mirrorX: false,
        mirrorY: false,
        name: 'ugc.svg',
      },
    ];
    const result: Tile[] = normalizeTiles(current, 3, 10);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('ugc.svg');
    expect(result[1].name).toBe('ugc.svg');
    expect(result[2].name).toBe('ugc.svg');
  });
});

describe('resolveDisplaySource', () => {
  it('uses name-based resolution when tile.name is set (never index)', () => {
    const ugcName = 'tileset-123:ugc_0.svg';
    const tile: Tile = {
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      name: ugcName,
    };
    const byIndex = (i: number) => ({ name: i === 0 ? 'built-in-0.svg' : 'other.svg' });
    const byName = (name: string) => (name === ugcName ? { name: ugcName } : null);
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toEqual({ name: ugcName });
  });

  it('returns null when tile.name is set but resolveByName returns null (do not use index)', () => {
    const tile: Tile = {
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      name: 'ugc-tile.svg',
    };
    const byIndex = () => ({ name: 'wrong-built-in.svg' });
    const byName = () => null;
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toBeNull();
  });

  it('uses index when tile.name is not set', () => {
    const tile: Tile = {
      imageIndex: 1,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    };
    const byIndex = (i: number) => ({ name: `source-${i}.svg` });
    const byName = () => null;
    const result = resolveDisplaySource(tile, byName, byIndex);
    expect(result).toEqual({ name: 'source-1.svg' });
  });
});

describe('getTileSourceIndexByName', () => {
  it('resolves index by name so UGC name finds UGC slot not built-in index', () => {
    const sources = [
      { name: 'tile_00000000.svg' },
      { name: 'tile_00000001.svg' },
      { name: 'tileset-123:ugc_0.svg' },
      { name: 'tileset-123:ugc_1.svg' },
    ];
    expect(getTileSourceIndexByName(sources, 'tileset-123:ugc_0.svg')).toBe(2);
    expect(getTileSourceIndexByName(sources, 'tileset-123:ugc_1.svg')).toBe(3);
    expect(getTileSourceIndexByName(sources, 'tile_00000000.svg')).toBe(0);
  });

  it('returns -1 when name is not in list', () => {
    const sources = [{ name: 'a.svg' }];
    expect(getTileSourceIndexByName(sources, 'missing.svg')).toBe(-1);
  });
});

describe('buildInitialTiles', () => {
  it('builds empty tiles with imageIndex -1', () => {
    const tiles: Tile[] = buildInitialTiles(4);
    expect(tiles).toHaveLength(4);
    tiles.forEach((t) => {
      expect(t.imageIndex).toBe(-1);
      expect(t.name).toBeUndefined();
    });
  });
});
