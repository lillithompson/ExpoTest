/**
 * Tests for preview-state utils. These guard the "cached canvas preview during load" flow:
 * - Opening a file uses previewUri ?? thumbnailUri so the cached image can be shown.
 * - Preview is shown when we have a URI and the live grid is not visible (or we're clearing).
 * - Preview/thumb paths are unique per save so the image cache shows the latest state.
 * - We only treat URIs under our preview dir as ours (safe delete).
 * - File list always shows cached thumbnail when present (hasCachedThumbnail; no platform/tiles branching).
 */
import {
  buildPreviewPath,
  getFilePreviewUri,
  hasCachedThumbnail,
  hasPreview,
  isOwnPreviewUri,
  showPreview,
} from '../preview-state';

const PREVIEW_DIR = 'file:///cache/tile-previews/';

describe('getFilePreviewUri', () => {
  it('returns previewUri when present', () => {
    expect(
      getFilePreviewUri({
        previewUri: 'file:///cache/full.png',
        thumbnailUri: 'file:///cache/thumb.png',
      })
    ).toBe('file:///cache/full.png');
  });

  it('falls back to thumbnailUri when previewUri is null', () => {
    expect(
      getFilePreviewUri({
        previewUri: null,
        thumbnailUri: 'file:///cache/thumb.png',
      })
    ).toBe('file:///cache/thumb.png');
  });

  it('falls back to thumbnailUri when previewUri is undefined', () => {
    expect(getFilePreviewUri({ thumbnailUri: 'file:///cache/thumb.png' })).toBe(
      'file:///cache/thumb.png'
    );
  });

  it('returns null when both are null/undefined', () => {
    expect(getFilePreviewUri({ previewUri: null, thumbnailUri: null })).toBe(null);
    expect(getFilePreviewUri({})).toBe(null);
  });

  it('returns null for null file', () => {
    expect(getFilePreviewUri(null)).toBe(null);
  });
});

describe('hasPreview', () => {
  it('is true when loadPreviewUri is set', () => {
    expect(hasPreview('file:///preview.png', null)).toBe(true);
  });

  it('is true when clearPreviewUri is set', () => {
    expect(hasPreview(null, 'file:///clear.png')).toBe(true);
  });

  it('is true when both are set', () => {
    expect(hasPreview('file:///a.png', 'file:///b.png')).toBe(true);
  });

  it('is false when both are null', () => {
    expect(hasPreview(null, null)).toBe(false);
  });
});

describe('showPreview', () => {
  it('shows preview when we have preview and grid is not visible', () => {
    expect(showPreview(true, false, false)).toBe(true);
  });

  it('hides preview when grid is visible (and not clearing)', () => {
    expect(showPreview(true, true, false)).toBe(false);
  });

  it('shows preview when clearing even if grid visible', () => {
    expect(showPreview(true, true, true)).toBe(true);
  });

  it('never shows when we have no preview', () => {
    expect(showPreview(false, false, false)).toBe(false);
    expect(showPreview(false, true, true)).toBe(false);
  });
});

describe('isOwnPreviewUri', () => {
  it('returns true for URI under preview dir', () => {
    expect(isOwnPreviewUri(PREVIEW_DIR + 'file-123-456-full.png', PREVIEW_DIR)).toBe(true);
    expect(isOwnPreviewUri(PREVIEW_DIR + 'file-1-2-thumb.png', PREVIEW_DIR)).toBe(true);
  });

  it('returns false for URI outside preview dir', () => {
    expect(isOwnPreviewUri('file:///other/path.png', PREVIEW_DIR)).toBe(false);
    expect(isOwnPreviewUri('/tmp/file.png', PREVIEW_DIR)).toBe(false);
  });

  it('returns false for URI that only shares a prefix', () => {
    expect(isOwnPreviewUri('file:///cache/tile-previews-other/file.png', PREVIEW_DIR)).toBe(
      false
    );
  });
});

describe('hasCachedThumbnail', () => {
  it('returns true when file has thumbnailUri', () => {
    expect(hasCachedThumbnail({ thumbnailUri: 'file:///thumb.png' })).toBe(true);
    expect(hasCachedThumbnail({ thumbnailUri: 'file:///thumb.png', previewUri: null })).toBe(true);
  });

  it('returns true when file has previewUri', () => {
    expect(hasCachedThumbnail({ previewUri: 'file:///preview.png' })).toBe(true);
    expect(hasCachedThumbnail({ previewUri: 'file:///preview.png', thumbnailUri: null })).toBe(
      true
    );
  });

  it('returns true when file has both (cached thumbnail should be shown)', () => {
    expect(
      hasCachedThumbnail({
        thumbnailUri: 'file:///thumb.png',
        previewUri: 'file:///preview.png',
      })
    ).toBe(true);
  });

  it('returns false when file has neither thumbnailUri nor previewUri', () => {
    expect(hasCachedThumbnail({})).toBe(false);
    expect(hasCachedThumbnail({ thumbnailUri: null, previewUri: null })).toBe(false);
  });

  it('returns false for null file', () => {
    expect(hasCachedThumbnail(null)).toBe(false);
  });

  it('depends only on thumbnailUri/previewUri (not tiles, grid, or platform)', () => {
    expect(
      hasCachedThumbnail({
        thumbnailUri: 'file:///thumb.png',
        tiles: [{ id: '1' }],
        grid: { rows: 2, columns: 2 },
      } as any)
    ).toBe(true);
  });
});

describe('buildPreviewPath', () => {
  it('builds full preview path with fileId and timestamp', () => {
    const path = buildPreviewPath(PREVIEW_DIR, 'file-abc', 'full', 1234567890);
    expect(path).toBe(PREVIEW_DIR + 'file-abc-1234567890-full.png');
  });

  it('builds thumb path with fileId and timestamp', () => {
    const path = buildPreviewPath(PREVIEW_DIR, 'file-xyz', 'thumb', 999);
    expect(path).toBe(PREVIEW_DIR + 'file-xyz-999-thumb.png');
  });

  it('produces different paths for different timestamps (unique per save)', () => {
    const p1 = buildPreviewPath(PREVIEW_DIR, 'file-1', 'full', 1000);
    const p2 = buildPreviewPath(PREVIEW_DIR, 'file-1', 'full', 2000);
    expect(p1).not.toBe(p2);
  });
});
