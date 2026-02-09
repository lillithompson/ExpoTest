/**
 * Pure helpers for the file load/hydration flow. Used to decide when the
 * apply effect can run (clear pending restore, set loadedToken, set hydrating false)
 * and when the file is considered "load complete" (editable).
 * Tests in __tests__/load-state.test.ts guard this so the flow does not regress.
 */

export type PendingRestoreShape = {
  rows: number;
  columns: number;
  tiles: unknown[];
  token?: number;
};

export type GridLayoutShape = {
  rows: number;
  columns: number;
  tileSize: number;
};

/**
 * True when the apply effect can run the "non-empty file" branch: load tiles,
 * clear pending, set hydrating false, then setLoadedToken. Requires tileSize > 0,
 * pending has rows/cols > 0, and grid either matches or allows fallback or has tiles.
 */
export function canApplyNonEmptyRestore(
  pending: PendingRestoreShape,
  gridLayout: GridLayoutShape
): boolean {
  const gridMatches =
    pending.rows === gridLayout.rows && pending.columns === gridLayout.columns;
  const allowFallback = pending.rows === 0 || pending.columns === 0;
  return (
    gridLayout.tileSize > 0 &&
    pending.rows > 0 &&
    pending.columns > 0 &&
    (gridMatches || allowFallback || pending.tiles.length > 0)
  );
}

/**
 * True when the apply effect can run the "empty new file" branch: resetTiles(),
 * clear pending, set hydrating false, setLoadedToken. This branch is required for
 * new files (rows=0, cols=0) to become editable; if it never runs, the cached
 * preview stays up and the grid never shows.
 */
export function canApplyEmptyNewFileRestore(
  pending: PendingRestoreShape,
  gridLayout: GridLayoutShape
): boolean {
  return (
    gridLayout.tileSize > 0 &&
    pending.rows === 0 &&
    pending.columns === 0
  );
}

/**
 * True when the file is past the load phase: loadedToken matches loadToken and
 * we are not hydrating. When false, the UI shows loading/preview and the grid
 * is not editable. Deferring setLoadedToken or setHydrating incorrectly leaves
 * this false and causes "stuck on cached image" bugs.
 */
export function isLoadComplete(
  loadedToken: number,
  loadToken: number,
  hydrating: boolean
): boolean {
  return (
    loadToken !== 0 &&
    loadedToken === loadToken &&
    !hydrating
  );
}
