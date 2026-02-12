/**
 * Tests for bundle format: patterns and files with embedded UGC tile sets
 * so export/import works with no external dependencies.
 */
jest.mock('@/assets/images/tiles/manifest', () => ({
  TILE_CATEGORIES: ['angular'],
  TILE_MANIFEST: { angular: [] },
}));

import type { TileFilePayload } from '../tile-format';
import { TILE_FORMAT_VERSION } from '../tile-format';
import type { Tile } from '../tile-grid';
import {
  deserializeBundle,
  fileUsesUgc,
  getSetIdsFromFileSourceNames,
  getSetIdsFromPatternTiles,
  remapFilePayload,
  remapPatternTileNames,
  serializeFileBundle,
  serializePatternBundle,
  TILE_BUNDLE_VERSION,
} from '../tile-bundle-format';
import type { PatternExportPayload, TileSetExportPayload } from '../tile-ugc-format';
import { deserializePattern } from '../tile-ugc-format';
import { deserializeTileFile, serializeTileFile } from '../tile-format';
import type { TileSet } from '@/hooks/use-tile-sets';

const validCategory = 'angular';

function minimalTileSet(setId: string, name: string): TileSet {
  return {
    id: setId,
    name,
    category: validCategory as TileSet['category'],
    categories: [validCategory as TileSet['category']],
    resolution: 4,
    lineWidth: 3,
    lineColor: '#ffffff',
    tiles: [
      {
        id: 'tile-1',
        name: 'Tile 1',
        grid: { rows: 4, columns: 4 },
        preferredTileSize: 45,
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
        ].flatMap((t) => Array(16).fill(t)),
        thumbnailUri: null,
        previewUri: null,
        updatedAt: Date.now(),
      },
    ],
    updatedAt: Date.now(),
  };
}

describe('tile-bundle-format', () => {
  describe('getSetIdsFromPatternTiles', () => {
    it('returns unique set IDs from tile names containing colon', () => {
      const tiles: Tile[] = [
        { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: 'setA:tile_0.svg' },
        { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false, name: 'setB:tile_1.svg' },
        { imageIndex: 2, rotation: 0, mirrorX: false, mirrorY: false, name: 'setA:other.svg' },
      ];
      expect(getSetIdsFromPatternTiles(tiles)).toEqual(['setA', 'setB']);
    });

    it('returns empty array when no tile has colon in name', () => {
      const tiles: Tile[] = [
        { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: 'tile_0.svg' },
      ];
      expect(getSetIdsFromPatternTiles(tiles)).toEqual([]);
    });
  });

  describe('getSetIdsFromFileSourceNames', () => {
    it('returns unique set IDs from source names containing colon', () => {
      expect(
        getSetIdsFromFileSourceNames(['setX:a.svg', 'setY:b.svg', 'setX:c.svg'])
      ).toEqual(['setX', 'setY']);
    });
    it('returns empty array when no name contains colon', () => {
      expect(getSetIdsFromFileSourceNames(['a.svg', 'b.svg'])).toEqual([]);
    });
  });

  describe('fileUsesUgc', () => {
    it('returns true when tileSetIds is non-empty', () => {
      expect(fileUsesUgc({ tileSetIds: ['set-1'], sourceNames: [] })).toBe(true);
    });
    it('returns true when sourceNames contains UGC-style name', () => {
      expect(fileUsesUgc({ tileSetIds: [], sourceNames: ['set-1:tile_0.svg'] })).toBe(true);
    });
    it('returns true when tiles have UGC-style name', () => {
      expect(
        fileUsesUgc({
          tileSetIds: [],
          sourceNames: [],
          tiles: [{ imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: 'set-1:x.svg' }],
        })
      ).toBe(true);
    });
    it('returns false when no UGC references', () => {
      expect(
        fileUsesUgc({ tileSetIds: [], sourceNames: ['builtin.svg'], tiles: [] })
      ).toBe(false);
    });
  });

  describe('serializePatternBundle / deserializeBundle', () => {
    it('produces a pattern bundle that deserializes and preserves pattern and tile sets', () => {
      const setId = 'ugc-set-1';
      const set = minimalTileSet(setId, 'My UGC Set');
      const tileSetsById = new Map<string, TileSet>([[setId, set]]);
      const pattern = {
        name: 'Pattern with UGC',
        category: validCategory as PatternExportPayload['category'],
        width: 2,
        height: 2,
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: `${setId}:tile_0.svg` },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
        ],
        createdAt: Date.now(),
      };
      const json = serializePatternBundle(pattern, tileSetsById);
      const result = deserializeBundle(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.kind).toBe('patternBundle');
      if (result.kind !== 'patternBundle') return;
      const payload = result.payload;
      expect(payload.kind).toBe('patternBundle');
      expect(payload.v).toBe(TILE_BUNDLE_VERSION);
      expect(payload.tileSets).toHaveLength(1);
      expect(payload.tileSets[0].setId).toBe(setId);
      expect(payload.tileSets[0].payload.kind).toBe('tileSet');
      expect(payload.pattern.name).toBe('Pattern with UGC');
      expect(payload.pattern.tiles[0].name).toBe(`${setId}:tile_0.svg`);
    });
  });

  describe('serializeFileBundle / deserializeBundle', () => {
    it('produces a file bundle that deserializes and preserves file and tile sets', () => {
      const setId = 'ugc-set-2';
      const set = minimalTileSet(setId, 'File UGC Set');
      const tileSetsById = new Map<string, TileSet>([[setId, set]]);
      const file = {
        name: 'Canvas with UGC',
        grid: { rows: 2, columns: 2 },
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: `${setId}:tile_0.svg` },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
        ],
        preferredTileSize: 45,
        lineWidth: 10,
        lineColor: '#fff',
        sourceNames: [`${setId}:tile_0.svg`],
        tileSetIds: [setId],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const json = serializeFileBundle(file, tileSetsById);
      const result = deserializeBundle(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.kind).toBe('fileBundle');
      if (result.kind !== 'fileBundle') return;
      const payload = result.payload;
      expect(payload.tileSets).toHaveLength(1);
      expect(payload.tileSets[0].setId).toBe(setId);
      expect(payload.file.name).toBe('Canvas with UGC');
      expect(payload.file.tileSetIds).toEqual([setId]);
      expect(payload.file.sourceNames).toEqual([`${setId}:tile_0.svg`]);
    });

    it('embeds UGC set when only sourceNames reference it (tileSetIds empty)', () => {
      const setId = 'ugc-from-sourcenames';
      const set = minimalTileSet(setId, 'UGC From Names');
      const tileSetsById = new Map<string, TileSet>([[setId, set]]);
      const file = {
        name: 'Canvas UGC from names',
        grid: { rows: 1, columns: 1 },
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: `${setId}:tile_0.svg` },
        ],
        preferredTileSize: 45,
        lineWidth: 10,
        lineColor: '#fff',
        sourceNames: [`${setId}:tile_0.svg`],
        tileSetIds: [] as string[],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const json = serializeFileBundle(file, tileSetsById);
      const result = deserializeBundle(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.kind).toBe('fileBundle');
      if (result.kind !== 'fileBundle') return;
      expect(result.payload.tileSets).toHaveLength(1);
      expect(result.payload.tileSets[0].setId).toBe(setId);
      expect(result.payload.tileSets[0].payload.name).toBe('UGC From Names');
    });
  });

  describe('remapPatternTileNames', () => {
    it('replaces old set ID with new set ID in tile names', () => {
      const pattern: PatternExportPayload = {
        kind: 'pattern',
        v: 1,
        name: 'P',
        category: validCategory as PatternExportPayload['category'],
        width: 1,
        height: 1,
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: 'oldId:tile_0.svg' },
        ],
        createdAt: 0,
      };
      const oldToNew = new Map([['oldId', 'newId']]);
      const remapped = remapPatternTileNames(pattern, oldToNew);
      expect(remapped.tiles[0].name).toBe('newId:tile_0.svg');
    });
  });

  describe('remapFilePayload', () => {
    it('replaces old set IDs in tileSetIds, sourceNames, and tile names', () => {
      const file: TileFilePayload = {
        v: TILE_FORMAT_VERSION,
        name: 'F',
        grid: { rows: 1, columns: 1 },
        tiles: [
          {
            imageIndex: 0,
            rotation: 0,
            mirrorX: false,
            mirrorY: false,
            name: 'oldId:tile_0.svg',
          },
        ],
        preferredTileSize: 45,
        lineWidth: 10,
        lineColor: '#fff',
        sourceNames: ['oldId:tile_0.svg'],
        tileSetIds: ['oldId'],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const oldToNew = new Map([['oldId', 'newId']]);
      const remapped = remapFilePayload(file, oldToNew);
      expect(remapped.tileSetIds).toEqual(['newId']);
      expect(remapped.sourceNames).toEqual(['newId:tile_0.svg']);
      expect(remapped.tiles[0].name).toBe('newId:tile_0.svg');
    });
  });

  describe('export/import flow: pattern bundle round-trip', () => {
    it('imported pattern payload can be used after remapping (simulated import)', () => {
      const setId = 'exported-set';
      const set = minimalTileSet(setId, 'Exported');
      const tileSetsById = new Map<string, TileSet>([[setId, set]]);
      const pattern = {
        name: 'Round-trip pattern',
        category: validCategory as PatternExportPayload['category'],
        width: 1,
        height: 1,
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: `${setId}:tile_0.svg` },
        ],
        createdAt: Date.now(),
      };
      const json = serializePatternBundle(pattern, tileSetsById);
      const bundle = deserializeBundle(json);
      expect(bundle.ok).toBe(true);
      if (!bundle.ok) return;
      expect(bundle.kind).toBe('patternBundle');
      if (bundle.kind !== 'patternBundle') return;
      const { pattern: importedPattern, tileSets } = bundle.payload;
      // Simulate import: new IDs for tile sets
      const oldToNew = new Map<string, string>();
      tileSets.forEach((entry, i) => {
        oldToNew.set(entry.setId, `imported-${i}`);
      });
      const remapped = remapPatternTileNames(importedPattern, oldToNew);
      expect(remapped.tiles[0].name).toBe('imported-0:tile_0.svg');
      // Remapped pattern is valid for createPattern (name, category, width, height, tiles)
      expect(remapped.name).toBe('Round-trip pattern');
      expect(remapped.width).toBe(1);
      expect(remapped.height).toBe(1);
    });
  });

  describe('export/import flow: file bundle round-trip', () => {
    it('imported file payload can be deserialized as TileFilePayload after remapping', () => {
      const setId = 'file-set';
      const set = minimalTileSet(setId, 'File Set');
      const tileSetsById = new Map<string, TileSet>([[setId, set]]);
      const file = {
        name: 'Round-trip file',
        grid: { rows: 1, columns: 1 },
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: `${setId}:tile_0.svg` },
        ],
        preferredTileSize: 45,
        lineWidth: 10,
        lineColor: '#fff',
        sourceNames: [`${setId}:tile_0.svg`],
        tileSetIds: [setId],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const json = serializeFileBundle(file, tileSetsById);
      const bundle = deserializeBundle(json);
      expect(bundle.ok).toBe(true);
      if (!bundle.ok) return;
      expect(bundle.kind).toBe('fileBundle');
      if (bundle.kind !== 'fileBundle') return;
      const oldToNew = new Map([['file-set', 'new-file-set']]);
      const remapped = remapFilePayload(bundle.payload.file, oldToNew);
      expect(remapped.tileSetIds).toEqual(['new-file-set']);
      expect(remapped.sourceNames).toEqual(['new-file-set:tile_0.svg']);
      // Re-serialize and deserialize as plain tile file to ensure payload is valid
      const roundTrip = serializeTileFile(remapped);
      const fileResult = deserializeTileFile(roundTrip);
      expect(fileResult.ok).toBe(true);
      if (fileResult.ok) {
        expect(fileResult.payload.name).toBe('Round-trip file');
        expect(fileResult.payload.tileSetIds).toEqual(['new-file-set']);
      }
    });
  });

  describe('deserializeBundle', () => {
    it('returns error for non-bundle JSON (legacy pattern)', () => {
      const legacyPattern = JSON.stringify({
        kind: 'pattern',
        v: 1,
        name: 'Legacy',
        category: validCategory,
        width: 1,
        height: 1,
        tiles: [],
        createdAt: Date.now(),
      });
      const result = deserializeBundle(legacyPattern);
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toBe('Not a bundle file');
    });

    it('returns error for invalid JSON', () => {
      const result = deserializeBundle('not json');
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.error).toBe('Invalid JSON');
    });
  });
});
