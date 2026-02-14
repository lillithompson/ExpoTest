/**
 * Tests for UGC baked name parsing (utils/tile-baked-name.ts).
 * Used to resolve legacy/stale baked names (e.g. after tile edit) to current
 * baked source by setId + tileId so files load when timing races leave old names on disk.
 */
import {
  getSetIdAndLegacyFromQualifiedName,
  parseBakedName,
} from '../tile-baked-name';

describe('parseBakedName', () => {
  it('parses name with timestamp: tileId_timestamp_bits.svg', () => {
    expect(parseBakedName('tile-1_123_00000000.svg')).toEqual({
      tileId: 'tile-1',
      bits: '00000000',
    });
    expect(parseBakedName('tile-1_999999_10101010.svg')).toEqual({
      tileId: 'tile-1',
      bits: '10101010',
    });
  });

  it('parses name without timestamp: tileId_bits.svg', () => {
    expect(parseBakedName('tile-1_00000000.svg')).toEqual({
      tileId: 'tile-1',
      bits: '00000000',
    });
  });

  it('parses qualified name (setId:legacy) by using legacy part', () => {
    expect(parseBakedName('set1:tile-1_123_00000000.svg')).toEqual({
      tileId: 'tile-1',
      bits: '00000000',
    });
  });

  it('returns null for non-matching names', () => {
    expect(parseBakedName('plain.svg')).toBeNull();
    expect(parseBakedName('no-bits')).toBeNull();
  });
});

describe('getSetIdAndLegacyFromQualifiedName', () => {
  it('splits qualified UGC name into setId and legacy', () => {
    expect(getSetIdAndLegacyFromQualifiedName('set1:tile-1_123_00000000.svg')).toEqual({
      setId: 'set1',
      legacy: 'tile-1_123_00000000.svg',
    });
  });

  it('returns null for name without colon', () => {
    expect(getSetIdAndLegacyFromQualifiedName('tile-1_123_00000000.svg')).toBeNull();
  });

  it('handles multiple colons in legacy part', () => {
    const name = 'set1:path:to:tile_123_00000000.svg';
    expect(getSetIdAndLegacyFromQualifiedName(name)).toEqual({
      setId: 'set1',
      legacy: 'path:to:tile_123_00000000.svg',
    });
  });
});
