/**
 * Draw stroke validation: when a stroke is done,
 * 1) the first tile has exactly one connection,
 * 2) every other tile has exactly two connections (only toward stroke neighbors).
 */
import type { Tile } from './tile-grid';
import type { TileConnections } from './tile-compat';

export function getDirectionFromTo(
  fromCell: number,
  toCell: number,
  columns: number
): number {
  const fromRow = Math.floor(fromCell / columns);
  const fromCol = fromCell % columns;
  const toRow = Math.floor(toCell / columns);
  const toCol = toCell % columns;
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return -1;
  if (dr === -1 && dc === 0) return 0;
  if (dr === -1 && dc === 1) return 1;
  if (dr === 0 && dc === 1) return 2;
  if (dr === 1 && dc === 1) return 3;
  if (dr === 1 && dc === 0) return 4;
  if (dr === 1 && dc === -1) return 5;
  if (dr === 0 && dc === -1) return 6;
  if (dr === -1 && dc === -1) return 7;
  return -1;
}

export function getStrokeNeighborDirections(
  cellIndex: number,
  strokeOrder: number[],
  strokeIndex: number,
  columns: number
): Set<number> {
  const out = new Set<number>();
  if (strokeIndex > 0) {
    const d = getDirectionFromTo(cellIndex, strokeOrder[strokeIndex - 1], columns);
    if (d >= 0) out.add(d);
  }
  if (strokeIndex < strokeOrder.length - 1) {
    const d = getDirectionFromTo(cellIndex, strokeOrder[strokeIndex + 1], columns);
    if (d >= 0) out.add(d);
  }
  return out;
}

export type GetConnectionsForPlacement = (
  imageIndex: number,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean
) => TileConnections | null;

/**
 * Returns true iff the stroke is valid:
 * 1) First tile has exactly one connection.
 * 2) Every other tile has exactly two connections, and they are only in the directions of its stroke neighbors (prev/next in order).
 */
export function validateDrawStroke(
  strokeOrder: number[],
  tilesState: Tile[],
  columns: number,
  getConnectionsForPlacement: GetConnectionsForPlacement
): boolean {
  for (let i = 0; i < strokeOrder.length; i += 1) {
    const cellIndex = strokeOrder[i];
    const tile = tilesState[cellIndex];
    if (!tile || tile.imageIndex < 0) return false;
    const conn = getConnectionsForPlacement(
      tile.imageIndex,
      tile.rotation,
      tile.mirrorX,
      tile.mirrorY
    );
    if (!conn) return false;
    if (i === 0) {
      const count = conn.filter(Boolean).length;
      if (count !== 1) return false;
      continue;
    }
    const allowed = getStrokeNeighborDirections(cellIndex, strokeOrder, i, columns);
    const isLast = i === strokeOrder.length - 1;
    if (isLast && strokeOrder.length > 1) {
      const count = conn.filter(Boolean).length;
      if (count !== 2) return false;
      for (const d of allowed) {
        if (!conn[d]) return false;
      }
      continue;
    }
    for (let d = 0; d < 8; d += 1) {
      if (conn[d] !== allowed.has(d)) return false;
    }
  }
  return true;
}
