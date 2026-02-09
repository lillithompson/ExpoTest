/**
 * Tests for load-state utils. These guard the file load/hydration flow so that:
 * - Empty new files (rows=0, cols=0) are applied when tileSize > 0 and become editable.
 * - Non-empty restores apply when grid matches or fallback conditions hold.
 * - isLoadComplete is true only when loadedToken === loadToken and !hydrating (loadToken !== 0).
 * - Deferring setLoadedToken or setHydrating leaves isLoadComplete false (documents "stuck preview" cause).
 */
import {
    canApplyEmptyNewFileRestore,
    canApplyNonEmptyRestore,
    isLoadComplete,
} from '../load-state';

describe('canApplyEmptyNewFileRestore', () => {
  it('returns true for empty new file when tileSize > 0 (so we exit hydrating)', () => {
    const pending = { rows: 0, columns: 0, tiles: [] };
    const gridLayout = { rows: 0, columns: 0, tileSize: 100 };
    expect(canApplyEmptyNewFileRestore(pending, gridLayout)).toBe(true);
  });

  it('returns true for any positive tileSize (e.g. 25, 50, 200)', () => {
    const pending = { rows: 0, columns: 0, tiles: [] };
    expect(canApplyEmptyNewFileRestore(pending, { rows: 0, columns: 0, tileSize: 25 })).toBe(true);
    expect(canApplyEmptyNewFileRestore(pending, { rows: 0, columns: 0, tileSize: 200 })).toBe(true);
  });

  it('returns false when tileSize is 0 (apply must wait for layout)', () => {
    const pending = { rows: 0, columns: 0, tiles: [] };
    const gridLayout = { rows: 0, columns: 0, tileSize: 0 };
    expect(canApplyEmptyNewFileRestore(pending, gridLayout)).toBe(false);
  });

  it('returns false when pending has non-zero rows/columns (use non-empty branch)', () => {
    const pending = { rows: 3, columns: 4, tiles: [] };
    const gridLayout = { rows: 3, columns: 4, tileSize: 50 };
    expect(canApplyEmptyNewFileRestore(pending, gridLayout)).toBe(false);
  });
});

describe('canApplyNonEmptyRestore', () => {
  it('returns true when grid matches and tileSize > 0', () => {
    const pending = { rows: 2, columns: 3, tiles: [{ id: '1' }] };
    const gridLayout = { rows: 2, columns: 3, tileSize: 50 };
    expect(canApplyNonEmptyRestore(pending, gridLayout)).toBe(true);
  });

  it('returns true when pending has tiles even if grid size differs (allowFallback)', () => {
    const pending = { rows: 2, columns: 2, tiles: [{ id: '1' }] };
    const gridLayout = { rows: 2, columns: 2, tileSize: 50 };
    expect(canApplyNonEmptyRestore(pending, gridLayout)).toBe(true);
  });

  it('returns false when tileSize is 0', () => {
    const pending = { rows: 2, columns: 2, tiles: [] };
    const gridLayout = { rows: 2, columns: 2, tileSize: 0 };
    expect(canApplyNonEmptyRestore(pending, gridLayout)).toBe(false);
  });

  it('returns false when pending is empty grid with no tiles', () => {
    const pending = { rows: 0, columns: 0, tiles: [] };
    const gridLayout = { rows: 0, columns: 0, tileSize: 50 };
    expect(canApplyNonEmptyRestore(pending, gridLayout)).toBe(false);
  });
});

describe('isLoadComplete', () => {
  it('is true when loadedToken === loadToken and !hydrating and loadToken !== 0', () => {
    expect(isLoadComplete(1, 1, false)).toBe(true);
    expect(isLoadComplete(2, 2, false)).toBe(true);
  });

  it('is false when hydrating is true (file not yet editable)', () => {
    expect(isLoadComplete(1, 1, true)).toBe(false);
  });

  it('is false when loadedToken !== loadToken (e.g. deferred setLoadedToken causes stuck preview)', () => {
    expect(isLoadComplete(0, 1, false)).toBe(false);
    expect(isLoadComplete(1, 2, false)).toBe(false);
  });

  it('is false when loadToken is 0 (no load started)', () => {
    expect(isLoadComplete(0, 0, false)).toBe(false);
  });

  it('documents that both loadedToken and hydrating must be updated for file to become editable', () => {
    // After apply effect runs we set loadedToken and setHydrating(false).
    // If we defer those updates (e.g. in requestAnimationFrame) and run load effect
    // again, we can get loadedToken=0, loadToken=1, hydrating=true -> stuck.
    expect(isLoadComplete(0, 1, true)).toBe(false);
    expect(isLoadComplete(1, 1, false)).toBe(true);
  });
});
