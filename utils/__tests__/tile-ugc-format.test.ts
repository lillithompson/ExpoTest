/**
 * Tests for UGC tile set and pattern serialize/deserialize (utils/tile-ugc-format.ts).
 */
jest.mock('@/assets/images/tiles/manifest', () => ({
  TILE_CATEGORIES: ['angular', 'curved'],
  TILE_MANIFEST: { angular: [], curved: [] },
}));

import {
  deserializePattern,
  deserializeTileSet,
  serializePattern,
  serializeTileSet,
  TILE_UGC_FORMAT_VERSION,
  type PatternExportPayload,
  type TileSetExportPayload,
} from '../tile-ugc-format';
import type { TileSet } from '@/hooks/use-tile-sets';

const validCategory = 'angular';

describe('tile-ugc-format', () => {
  describe('serializeTileSet / deserializeTileSet', () => {
    it('round-trips a tile set export', () => {
      const set: TileSet = {
        id: 'set-1',
        name: 'Test Set',
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
            tiles: Array(16).fill({
              imageIndex: 0,
              rotation: 0,
              mirrorX: false,
              mirrorY: false,
            }),
            thumbnailUri: null,
            previewUri: null,
            updatedAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      };
      const json = serializeTileSet(set);
      const result = deserializeTileSet(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.kind).toBe('tileSet');
      expect(result.payload.v).toBe(TILE_UGC_FORMAT_VERSION);
      expect(result.payload.name).toBe('Test Set');
      expect(result.payload.resolution).toBe(4);
      expect(result.payload.tiles).toHaveLength(1);
      expect(result.payload.tiles[0].name).toBe('Tile 1');
      expect(result.payload.tiles[0].grid).toEqual({ rows: 4, columns: 4 });
      expect(result.payload.tiles[0].tiles).toHaveLength(16);
    });

    it('returns error for invalid JSON', () => {
      const result = deserializeTileSet('not json');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Invalid JSON');
    });

    it('returns error when kind is not tileSet', () => {
      const result = deserializeTileSet(JSON.stringify({ kind: 'pattern', v: 1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Not a tile set .tile file');
    });
  });

  describe('serializePattern / deserializePattern', () => {
    it('round-trips a pattern export', () => {
      const pattern = {
        id: 'pattern-1',
        name: 'Test Pattern',
        category: validCategory as PatternExportPayload['category'],
        width: 2,
        height: 2,
        tiles: [
          { imageIndex: 0, rotation: 90, mirrorX: true, mirrorY: false, name: 'tile_0.svg' },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
          { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
        ],
        createdAt: Date.now(),
      };
      const json = serializePattern(pattern);
      const result = deserializePattern(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.kind).toBe('pattern');
      expect(result.payload.v).toBe(TILE_UGC_FORMAT_VERSION);
      expect(result.payload.name).toBe('Test Pattern');
      expect(result.payload.width).toBe(2);
      expect(result.payload.height).toBe(2);
      expect(result.payload.tiles).toHaveLength(4);
      expect(result.payload.tiles[0].name).toBe('tile_0.svg');
      expect(result.payload.tiles[0].rotation).toBe(90);
      expect(result.payload.tiles[0].mirrorX).toBe(true);
    });

    it('returns error for invalid JSON', () => {
      const result = deserializePattern('not json');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Invalid JSON');
    });

    it('returns error when kind is not pattern', () => {
      const result = deserializePattern(JSON.stringify({ kind: 'tileSet', v: 1 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('Not a pattern .tile file');
    });
  });

  describe('export/import flow: tileset', () => {
    it('serialized tileset can be deserialized and used as TileSetExportPayload for import', () => {
      const set: TileSet = {
        id: 'export-me',
        name: 'UGC Tiles',
        category: validCategory as TileSet['category'],
        categories: [validCategory as TileSet['category']],
        resolution: 4,
        lineWidth: 5,
        lineColor: '#ccc',
        tiles: [
          {
            id: 't1',
            name: 'UGC Tile',
            grid: { rows: 2, columns: 2 },
            preferredTileSize: 50,
            tiles: [
              { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
              { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
              { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
              { imageIndex: -1, rotation: 0, mirrorX: false, mirrorY: false },
            ],
            thumbnailUri: null,
            previewUri: null,
            updatedAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      };
      const json = serializeTileSet(set);
      const parsed = deserializeTileSet(json);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const payload = parsed.payload as TileSetExportPayload;
      expect(payload.name).toBe('UGC Tiles');
      expect(payload.tiles).toHaveLength(1);
      expect(payload.tiles[0].name).toBe('UGC Tile');
      expect(payload.tiles[0].grid).toEqual({ rows: 2, columns: 2 });
      // Payload is suitable for importTileSet(payload)
      expect(payload.kind).toBe('tileSet');
      expect(payload.resolution).toBe(4);
      expect(payload.lineWidth).toBe(5);
      expect(payload.lineColor).toBe('#ccc');
    });
  });

  describe('export/import flow: pattern', () => {
    it('serialized pattern can be deserialized and used for createPattern', () => {
      const pattern = {
        id: 'p1',
        name: 'Imported Pattern',
        category: validCategory as PatternExportPayload['category'],
        width: 1,
        height: 1,
        tiles: [
          { imageIndex: 0, rotation: 180, mirrorX: false, mirrorY: true, name: 'ugc:tile.svg' },
        ],
        createdAt: 12345,
      };
      const json = serializePattern(pattern);
      const parsed = deserializePattern(json);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const p = parsed.payload;
      expect(p.name).toBe('Imported Pattern');
      expect(p.width).toBe(1);
      expect(p.height).toBe(1);
      expect(p.tiles[0].name).toBe('ugc:tile.svg');
      expect(p.tiles[0].rotation).toBe(180);
      expect(p.tiles[0].mirrorY).toBe(true);
      expect(p.createdAt).toBe(12345);
      // Payload has shape expected by createPattern({ name, category, width, height, tiles })
      expect(p.kind).toBe('pattern');
    });
  });
});
