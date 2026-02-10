/**
 * Tests for tile-file-sync: design files stay valid when tile sets or tiles
 * are deleted. Sequence under test: tile set with two tiles, file uses both;
 * delete first tile -> file still loads; delete second tile -> file still loads.
 */
import type { Tile } from '../tile-grid';
import {
  applyRemovedSourcesToFile,
  isRemovedSourceName,
} from '../tile-file-sync';

const emptyTile = (overrides: Partial<Tile> = {}): Tile => ({
  imageIndex: -1,
  rotation: 0,
  mirrorX: false,
  mirrorY: false,
  ...overrides,
});

describe('isRemovedSourceName', () => {
  it('returns true for exact match in removed set', () => {
    expect(isRemovedSourceName('set1:tile-1_0_00000000.svg', new Set(['set1:tile-1_0_00000000.svg']), '')).toBe(true);
  });

  it('returns true when name starts with prefix', () => {
    expect(isRemovedSourceName('set1:tile-2_0_00000000.svg', new Set(), 'set1:tile-2_')).toBe(true);
  });

  it('returns false when not in set and prefix empty', () => {
    expect(isRemovedSourceName('other.svg', new Set(['a.svg']), '')).toBe(false);
  });
});

describe('applyRemovedSourcesToFile', () => {
  const setName = 'set-1';
  const nameA = `${setName}:tile-A_100_01010101.svg`;
  const nameB = `${setName}:tile-B_200_10101010.svg`;

  it('replaces tiles that reference removed source by name', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0, name: nameA },
        { ...emptyTile(), imageIndex: 1 },
      ],
      sourceNames: [nameA, nameB],
    };
    const result = applyRemovedSourcesToFile(file, [nameA]);
    expect(result.changed).toBe(true);
    expect(result.tiles[0].imageIndex).toBe(-2);
    expect(result.tiles[1].imageIndex).toBe(0);
    expect(result.tiles[1].name).toBe(nameB);
    expect(result.sourceNames).toEqual([nameB]);
  });

  it('replaces tiles that reference removed source by imageIndex', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0 },
        { ...emptyTile(), imageIndex: 1 },
      ],
      sourceNames: [nameA, nameB],
    };
    const result = applyRemovedSourcesToFile(file, [nameA]);
    expect(result.changed).toBe(true);
    expect(result.tiles[0].imageIndex).toBe(-2);
    expect(result.tiles[1].imageIndex).toBe(0);
    expect(result.tiles[1].name).toBe(nameB);
    expect(result.sourceNames).toEqual([nameB]);
  });

  it('replaces by namePrefix when exact names not provided', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0, name: nameA },
        { ...emptyTile(), imageIndex: 1, name: nameB },
      ],
      sourceNames: [nameA, nameB],
    };
    const result = applyRemovedSourcesToFile(file, [], {
      namePrefix: `${setName}:tile-A_`,
    });
    expect(result.changed).toBe(true);
    expect(result.tiles[0].imageIndex).toBe(-2);
    expect(result.tiles[1].imageIndex).toBe(0);
    expect(result.tiles[1].name).toBe(nameB);
    expect(result.sourceNames).toEqual([nameB]);
  });

  it('sequence: file with two UGC tiles, remove first then second – file stays valid', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0, name: nameA },
        { ...emptyTile(), imageIndex: 1, name: nameB },
      ],
      sourceNames: [nameA, nameB],
    };

    const afterFirst = applyRemovedSourcesToFile(file, [nameA]);
    expect(afterFirst.changed).toBe(true);
    expect(afterFirst.tiles[0].imageIndex).toBe(-2);
    expect(afterFirst.tiles[1].imageIndex).toBe(0);
    expect(afterFirst.tiles[1].name).toBe(nameB);
    expect(afterFirst.sourceNames).toEqual([nameB]);

    const afterSecond = applyRemovedSourcesToFile(
      { tiles: afterFirst.tiles, sourceNames: afterFirst.sourceNames },
      [nameB]
    );
    expect(afterSecond.changed).toBe(true);
    expect(afterSecond.tiles[0].imageIndex).toBe(-2);
    expect(afterSecond.tiles[1].imageIndex).toBe(-2);
    expect(afterSecond.sourceNames).toEqual([]);
  });

  it('sequence: tiles reference only by index; remove first then second', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0 },
        { ...emptyTile(), imageIndex: 1 },
      ],
      sourceNames: [nameA, nameB],
    };

    const afterFirst = applyRemovedSourcesToFile(file, [nameA]);
    expect(afterFirst.changed).toBe(true);
    expect(afterFirst.tiles[0].imageIndex).toBe(-2);
    expect(afterFirst.tiles[1].imageIndex).toBe(0);
    expect(afterFirst.tiles[1].name).toBe(nameB);
    expect(afterFirst.sourceNames).toEqual([nameB]);

    const afterSecond = applyRemovedSourcesToFile(
      { tiles: afterFirst.tiles, sourceNames: afterFirst.sourceNames },
      [nameB]
    );
    expect(afterSecond.changed).toBe(true);
    expect(afterSecond.tiles[0].imageIndex).toBe(-2);
    expect(afterSecond.tiles[1].imageIndex).toBe(-2);
    expect(afterSecond.sourceNames).toEqual([]);
  });

  it('returns unchanged when nothing matches', () => {
    const file = {
      tiles: [{ ...emptyTile(), imageIndex: 0, name: nameA }],
      sourceNames: [nameA, nameB],
    };
    const result = applyRemovedSourcesToFile(file, ['other-set:other.svg']);
    expect(result.changed).toBe(false);
    expect(result.tiles).toHaveLength(1);
    expect(result.tiles[0].imageIndex).toBe(0);
    expect(result.tiles[0].name).toBe(nameA);
    expect(result.sourceNames).toEqual([nameA, nameB]);
  });

  it('no-op when removedNames and prefix empty', () => {
    const file = {
      tiles: [{ ...emptyTile(), imageIndex: 0 }],
      sourceNames: [nameA],
    };
    const result = applyRemovedSourcesToFile(file, []);
    expect(result.changed).toBe(false);
  });

  it('file stays loadable after each removal (no out-of-bounds imageIndex)', () => {
    const file = {
      tiles: [
        { ...emptyTile(), imageIndex: 0, name: nameA },
        { ...emptyTile(), imageIndex: 1, name: nameB },
      ],
      sourceNames: [nameA, nameB],
    };

    const afterFirst = applyRemovedSourcesToFile(file, [nameA]);
    afterFirst.tiles.forEach((tile, i) => {
      if (tile.imageIndex >= 0) {
        expect(tile.imageIndex).toBeLessThan(afterFirst.sourceNames.length);
      }
    });

    const afterSecond = applyRemovedSourcesToFile(
      { tiles: afterFirst.tiles, sourceNames: afterFirst.sourceNames },
      [nameB]
    );
    afterSecond.tiles.forEach((tile) => {
      expect(tile.imageIndex === -2 || tile.imageIndex < afterSecond.sourceNames.length).toBe(true);
    });
    expect(afterSecond.sourceNames).toEqual([]);
    expect(afterSecond.tiles.every((t) => t.imageIndex === -2)).toBe(true);
  });
});
