/**
 * Tests for tile URI helpers. These guard the UGC cache-bypass rule on native:
 * file:// URIs under /tile-sets/ must be treated as UGC and must not use the
 * shared SVG cache, so we never show a cached built-in tile for a UGC placement.
 */
import { isUgcTileFileUri } from '../tile-uri';

describe('isUgcTileFileUri', () => {
  it('returns false on web for any URI', () => {
    expect(isUgcTileFileUri('file:///var/mobile/.../tile-sets/xyz/tile.svg', 'web')).toBe(false);
    expect(isUgcTileFileUri('file:///any/path.svg', 'web')).toBe(false);
    expect(isUgcTileFileUri(null, 'web')).toBe(false);
  });

  it('returns true on native for file URIs containing /tile-sets/', () => {
    expect(
      isUgcTileFileUri(
        'file:///var/mobile/Containers/Data/Application/.../Documents/.../tile-sets/tileset-123/tile.svg',
        'ios'
      )
    ).toBe(true);
    expect(
      isUgcTileFileUri(
        'file:///data/user/0/.../files/tile-sets/tileset-abc/file.svg',
        'android'
      )
    ).toBe(true);
  });

  it('returns false on native for non-file URIs', () => {
    expect(isUgcTileFileUri('https://example.com/tile-sets/foo.svg', 'ios')).toBe(false);
    expect(isUgcTileFileUri('data:image/svg+xml,...', 'android')).toBe(false);
  });

  it('returns false on native for file URIs without /tile-sets/', () => {
    expect(isUgcTileFileUri('file:///var/bundle/assets/tile_00000000.svg', 'ios')).toBe(false);
    expect(isUgcTileFileUri('file:///tmp/other.svg', 'android')).toBe(false);
  });

  it('returns false for null or empty URI', () => {
    expect(isUgcTileFileUri(null, 'ios')).toBe(false);
    expect(isUgcTileFileUri('', 'ios')).toBe(false);
  });
});
