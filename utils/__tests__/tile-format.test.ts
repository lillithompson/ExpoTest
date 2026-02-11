/**
 * Tests for .tile file format serialize/deserialize (utils/tile-format.ts).
 */
jest.mock('@/assets/images/tiles/manifest', () => ({
  TILE_CATEGORIES: ['angular'],
  TILE_MANIFEST: { angular: [] },
}));

import {
  deserializeTileFile,
  serializeTileFile,
  TILE_FORMAT_VERSION,
  type TileFilePayload,
} from '../tile-format';

const validCategory = 'angular';

describe('tile-format', () => {
  describe('serializeTileFile', () => {
    it('produces JSON with version and required fields', () => {
      const payload: TileFilePayload = {
        v: TILE_FORMAT_VERSION,
        name: 'Test',
        grid: { rows: 2, columns: 3 },
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 90, mirrorX: true, mirrorY: false },
        ],
        preferredTileSize: 50,
        lineWidth: 10,
        lineColor: '#ffffff',
        sourceNames: ['a.svg'],
        tileSetIds: [],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const json = serializeTileFile(payload);
      const parsed = JSON.parse(json);
      expect(parsed.v).toBe(TILE_FORMAT_VERSION);
      expect(parsed.name).toBe('Test');
      expect(parsed.grid).toEqual({ rows: 2, columns: 3 });
      expect(parsed.tiles).toHaveLength(2);
      expect(parsed.preferredTileSize).toBe(50);
      expect(parsed.lineWidth).toBe(10);
      expect(parsed.lineColor).toBe('#ffffff');
      expect(parsed.sourceNames).toEqual(['a.svg']);
      expect(parsed.category).toBe(validCategory);
    });
  });

  describe('deserializeTileFile', () => {
    it('round-trips a valid payload', () => {
      const payload: TileFilePayload = {
        v: TILE_FORMAT_VERSION,
        name: 'Round trip',
        grid: { rows: 1, columns: 2 },
        tiles: [
          { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false, name: 'tile_0.svg' },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
        ],
        preferredTileSize: 45,
        lineWidth: 8,
        lineColor: '#ccc',
        sourceNames: ['tile_0.svg'],
        tileSetIds: [],
        category: validCategory as TileFilePayload['category'],
        categories: [validCategory as TileFilePayload['category']],
      };
      const json = serializeTileFile(payload);
      const result = deserializeTileFile(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.name).toBe('Round trip');
        expect(result.payload.grid).toEqual({ rows: 1, columns: 2 });
        expect(result.payload.tiles).toHaveLength(2);
        expect(result.payload.tiles[0].name).toBe('tile_0.svg');
        expect(result.payload.preferredTileSize).toBe(45);
        expect(result.payload.lineWidth).toBe(8);
        expect(result.payload.lineColor).toBe('#ccc');
        expect(result.payload.category).toBe(validCategory);
      }
    });

    it('returns error for invalid JSON', () => {
      const result = deserializeTileFile('not json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid JSON');
      }
    });

    it('returns error for wrong version', () => {
      const json = JSON.stringify({ v: 99, name: 'x', grid: { rows: 1, columns: 1 }, tiles: [] });
      const result = deserializeTileFile(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Unsupported .tile version');
      }
    });

    it('returns error for missing grid', () => {
      const json = JSON.stringify({
        v: TILE_FORMAT_VERSION,
        name: 'x',
        tiles: [],
      });
      const result = deserializeTileFile(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid grid');
      }
    });

    it('normalizes and pads tiles to grid size', () => {
      const json = JSON.stringify({
        v: TILE_FORMAT_VERSION,
        name: 'Pad',
        grid: { rows: 2, columns: 2 },
        tiles: [{ imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false }],
        preferredTileSize: 45,
        lineWidth: 10,
        lineColor: '#fff',
        sourceNames: [],
        tileSetIds: [],
        category: validCategory,
        categories: [validCategory],
      });
      const result = deserializeTileFile(json);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.tiles).toHaveLength(4);
        expect(result.payload.tiles[0].imageIndex).toBe(0);
        expect(result.payload.tiles[1].imageIndex).toBe(-1);
        expect(result.payload.tiles[2].imageIndex).toBe(-1);
        expect(result.payload.tiles[3].imageIndex).toBe(-1);
      }
    });
  });
});
