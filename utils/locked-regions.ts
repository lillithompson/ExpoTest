/**
 * Helpers for locked regions (rectangular start/end cell indices).
 * Used to prevent tool operations from modifying locked tiles.
 */

export type LockedRegion = { start: number; end: number };

export function getRegionBounds(
  start: number,
  end: number,
  columns: number
): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
  const startRow = Math.floor(start / columns);
  const startCol = start % columns;
  const endRow = Math.floor(end / columns);
  const endCol = end % columns;
  return {
    minRow: Math.min(startRow, endRow),
    maxRow: Math.max(startRow, endRow),
    minCol: Math.min(startCol, endCol),
    maxCol: Math.max(startCol, endCol),
  };
}

export function getCellIndicesInRegion(
  start: number,
  end: number,
  columns: number
): number[] {
  const { minRow, maxRow, minCol, maxCol } = getRegionBounds(start, end, columns);
  const indices: number[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      indices.push(r * columns + c);
    }
  }
  return indices;
}

/** True if the two rectangular regions share any cell. */
export function regionsOverlap(
  a: LockedRegion,
  b: LockedRegion,
  columns: number
): boolean {
  const ba = getRegionBounds(a.start, a.end, columns);
  const bb = getRegionBounds(b.start, b.end, columns);
  return !(
    ba.maxRow < bb.minRow ||
    bb.maxRow < ba.minRow ||
    ba.maxCol < bb.minCol ||
    bb.maxCol < ba.minCol
  );
}

export function isCellInRegion(
  cellIndex: number,
  start: number,
  end: number,
  columns: number
): boolean {
  const { minRow, maxRow, minCol, maxCol } = getRegionBounds(start, end, columns);
  const row = Math.floor(cellIndex / columns);
  const col = cellIndex % columns;
  return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
}

/** Returns the locked region that contains this cell, or null. */
export function findLockedRegionContainingCell(
  cellIndex: number,
  lockedRegions: LockedRegion[],
  columns: number
): LockedRegion | null {
  for (const region of lockedRegions) {
    if (isCellInRegion(cellIndex, region.start, region.end, columns)) {
      return region;
    }
  }
  return null;
}

/** Normalize region to canonical start/end (min index, max index). */
export function normalizeRegion(
  start: number,
  end: number,
  columns: number
): LockedRegion {
  const { minRow, maxRow, minCol, maxCol } = getRegionBounds(start, end, columns);
  const startIndex = minRow * columns + minCol;
  const endIndex = maxRow * columns + maxCol;
  return { start: startIndex, end: endIndex };
}

/** True if the two regions cover exactly the same cells. */
export function regionsEqual(
  a: LockedRegion,
  b: LockedRegion,
  columns: number
): boolean {
  const na = normalizeRegion(a.start, a.end, columns);
  const nb = normalizeRegion(b.start, b.end, columns);
  return na.start === nb.start && na.end === nb.end;
}

const LOCKED_BORDER_WIDTH = 2;

/**
 * Returns rects for the outside border of the locked cells only (edges between
 * a locked cell and a non-locked cell or grid edge). Each rect is a 2px grey
 * border segment in pixel coordinates.
 */
export function getLockedBoundaryEdges(
  lockedCells: number[],
  columns: number,
  rows: number,
  tileSize: number,
  gap: number
): Array<{ left: number; top: number; width: number; height: number }> {
  if (lockedCells.length === 0 || columns <= 0 || rows <= 0) {
    return [];
  }
  const lockedSet = new Set(lockedCells);
  const stride = tileSize + gap;
  const edges: Array<{ left: number; top: number; width: number; height: number }> = [];

  for (const index of lockedCells) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const left = col * stride;
    const top = row * stride;

    const topNeighbor = row > 0 ? index - columns : -1;
    const bottomNeighbor = row < rows - 1 ? index + columns : -1;
    const leftNeighbor = col > 0 ? index - 1 : -1;
    const rightNeighbor = col < columns - 1 ? index + 1 : -1;

    if (topNeighbor < 0 || !lockedSet.has(topNeighbor)) {
      edges.push({ left, top, width: tileSize, height: LOCKED_BORDER_WIDTH });
    }
    if (bottomNeighbor < 0 || !lockedSet.has(bottomNeighbor)) {
      edges.push({
        left,
        top: top + tileSize - LOCKED_BORDER_WIDTH,
        width: tileSize,
        height: LOCKED_BORDER_WIDTH,
      });
    }
    if (leftNeighbor < 0 || !lockedSet.has(leftNeighbor)) {
      edges.push({ left, top, width: LOCKED_BORDER_WIDTH, height: tileSize });
    }
    if (rightNeighbor < 0 || !lockedSet.has(rightNeighbor)) {
      edges.push({
        left: left + tileSize - LOCKED_BORDER_WIDTH,
        top,
        width: LOCKED_BORDER_WIDTH,
        height: tileSize,
      });
    }
  }

  return edges;
}
