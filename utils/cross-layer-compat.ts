import type { TileConnections } from '@/utils/tile-compat';
import type { LevelGridInfo, Tile } from '@/utils/tile-grid';
import { getLevelGridInfo } from '@/utils/tile-grid';

// Direction indices: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW

/** Per-direction constraint: true = must connect, false = must not connect, null = unconstrained */
export type CrossLayerEdgeConstraints = (boolean | null)[];

/** Map from editing-layer cell index → 8-element constraint array */
export type CrossLayerEdgeMap = Map<number, CrossLayerEdgeConstraints>;

export type CrossLayerContext = {
  editingLevel: number;
  baseColumns: number;
  baseRows: number;
  /** Other layers' tiles and grid info, keyed by internal level */
  otherLayers: Record<number, { tiles: Tile[]; gridInfo: LevelGridInfo }>;
};

/** Opposite direction index */
const oppositeDir = [4, 5, 6, 7, 0, 1, 2, 3];

/** Direction deltas (dr, dc) for each direction index 0..7 */
const dirDr = [-1, -1, 0, 1, 1, 1, 0, -1];
const dirDc = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Pre-compute cross-layer edge constraints for all editing-layer cells.
 */
export function buildCrossLayerEdgeMap(
  editingLevel: number,
  editCols: number,
  editRows: number,
  baseColumns: number,
  baseRows: number,
  otherLayers: Record<number, { tiles: Tile[]; gridInfo: LevelGridInfo }>,
  getConnectionsForTile: (tile: Tile) => (boolean | null)[] | null
): CrossLayerEdgeMap {
  const map: CrossLayerEdgeMap = new Map();

  const editGridInfo = getLevelGridInfo(baseColumns, baseRows, editingLevel);
  if (!editGridInfo) return map;

  for (const levelStr of Object.keys(otherLayers)) {
    const otherLevel = Number(levelStr);
    if (otherLevel === editingLevel) continue;
    const { tiles: otherTiles, gridInfo: otherGridInfo } = otherLayers[otherLevel];

    if (otherLevel > editingLevel) {
      addCoarserLayerConstraints(
        map, editingLevel, editGridInfo,
        otherLevel, otherTiles, otherGridInfo,
        baseColumns, baseRows, getConnectionsForTile
      );
    } else {
      addFinerLayerConstraints(
        map, editingLevel, editGridInfo,
        otherLevel, otherTiles, otherGridInfo,
        baseColumns, baseRows, getConnectionsForTile
      );
    }
  }

  return map;
}

/**
 * Merge a constraint into the edge map. Multiple layers can constrain the same cell/direction.
 * false always wins over true (if any layer says "wall", it's a wall).
 */
function mergeConstraint(
  map: CrossLayerEdgeMap,
  cellIndex: number,
  dirIndex: number,
  value: boolean
): void {
  let arr = map.get(cellIndex);
  if (!arr) {
    arr = [null, null, null, null, null, null, null, null];
    map.set(cellIndex, arr);
  }
  const existing = arr[dirIndex];
  if (existing === null) {
    arr[dirIndex] = value;
  } else if (existing === true && value === false) {
    arr[dirIndex] = false; // wall wins
  }
}

/**
 * Diagonal directions that cross through each cardinal face.
 * E.g., east face (2): inside diags exiting eastward = NE(1), SE(3);
 *                       outside diags entering westward = NW(7), SW(5).
 */
const cardinalCrossingDiags: Record<number, { inside: number[]; outside: number[] }> = {
  0: { inside: [1, 7], outside: [3, 5] }, // North: NE, NW exit north; SE, SW enter from north
  2: { inside: [1, 3], outside: [7, 5] }, // East:  NE, SE exit east;  NW, SW enter from east
  4: { inside: [3, 5], outside: [1, 7] }, // South: SE, SW exit south; NE, NW enter from south
  6: { inside: [5, 7], outside: [1, 3] }, // West:  SW, NW exit west;  NE, SE enter from west
};

/**
 * A coarser layer constrains the finer editing layer.
 *
 * Constraint model (only walls constrain — true is permissive, not required):
 * - Cardinal connection = false (wall): blocks ALL fine cells on that edge for their
 *   cardinal outward direction AND diagonal directions that cross through that face.
 * - Cardinal connection = true: no constraint (fine tiles are free to connect or not).
 * - Diagonal connection = false (wall): blocks only the corner fine cell's diagonal direction.
 * - Diagonal connection = true: no constraint.
 *
 * Both inside (looking outward) and outside (looking inward) fine cells are constrained.
 */
function addCoarserLayerConstraints(
  map: CrossLayerEdgeMap,
  editLevel: number,
  editGridInfo: LevelGridInfo,
  coarseLevel: number,
  coarseTiles: Tile[],
  coarseGridInfo: LevelGridInfo,
  baseColumns: number,
  baseRows: number,
  getConnectionsForTile: (tile: Tile) => (boolean | null)[] | null
): void {
  const editCellSize = Math.pow(2, editLevel - 1);
  const coarseCellSize = Math.pow(2, coarseLevel - 1);
  const scale = coarseCellSize / editCellSize;
  if (scale < 2 || !Number.isInteger(scale)) return;

  const cardinalEdges: Array<0 | 2 | 4 | 6> = [0, 2, 4, 6];

  for (let coarseIdx = 0; coarseIdx < coarseGridInfo.cells.length; coarseIdx++) {
    const coarseBounds = coarseGridInfo.cells[coarseIdx];
    const coarseTile = coarseTiles[coarseIdx];
    if (!coarseTile || coarseTile.imageIndex < 0) continue;
    const coarseConns = getConnectionsForTile(coarseTile);
    if (!coarseConns) continue;

    // --- Cardinal edges ---
    // Only false (wall) constrains fine cells. true = permissive, skip.
    for (const edge of cardinalEdges) {
      const cardinalConn = coarseConns[edge];
      if (cardinalConn !== false) continue; // only walls constrain

      const crossing = cardinalCrossingDiags[edge];

      for (let p = 0; p < scale; p++) {
        const { insideL1Row, insideL1Col, outsideL1Row, outsideL1Col } =
          getEdgeInsideOutsideL1(coarseBounds, edge, p, editCellSize);

        // Inside fine cell: cardinal direction outward is blocked
        const insideEditIdx = findCellContaining(editGridInfo, insideL1Row, insideL1Col);
        if (insideEditIdx >= 0) {
          mergeConstraint(map, insideEditIdx, edge, false);
          // Also block diagonal directions that cross through this face
          for (const diagDir of crossing.inside) {
            mergeConstraint(map, insideEditIdx, diagDir, false);
          }
        }

        // Outside fine cell: cardinal direction inward is blocked
        if (outsideL1Row >= 0 && outsideL1Row < baseRows &&
            outsideL1Col >= 0 && outsideL1Col < baseColumns) {
          const outsideEditIdx = findCellContaining(editGridInfo, outsideL1Row, outsideL1Col);
          if (outsideEditIdx >= 0) {
            mergeConstraint(map, outsideEditIdx, oppositeDir[edge], false);
            // Also block diagonal directions that cross through this face from outside
            for (const diagDir of crossing.outside) {
              mergeConstraint(map, outsideEditIdx, diagDir, false);
            }
          }
        }
      }
    }

    // --- Diagonal corners ---
    // Only false (wall) constrains. true = permissive, skip.
    const diagDirs: number[] = [1, 3, 5, 7]; // NE, SE, SW, NW
    for (const dir of diagDirs) {
      const diagConn = coarseConns[dir];
      if (diagConn !== false) continue; // only walls constrain

      const corner = getCornerFineCell(coarseBounds, dir);

      // Inside fine cell at corner: diagonal outward is blocked
      const insideEditIdx = findCellContaining(editGridInfo, corner.l1Row, corner.l1Col);
      if (insideEditIdx >= 0) {
        mergeConstraint(map, insideEditIdx, dir, false);
      }

      // Outside fine cell at diagonal: diagonal inward is blocked
      const outsideL1Row = corner.l1Row + dirDr[dir];
      const outsideL1Col = corner.l1Col + dirDc[dir];
      if (outsideL1Row >= 0 && outsideL1Row < baseRows &&
          outsideL1Col >= 0 && outsideL1Col < baseColumns) {
        const outsideEditIdx = findCellContaining(editGridInfo, outsideL1Row, outsideL1Col);
        if (outsideEditIdx >= 0) {
          mergeConstraint(map, outsideEditIdx, oppositeDir[dir], false);
        }
      }
    }
  }
}

/**
 * Get L1 coordinates for the inside and outside positions at slot `p` of a coarse cell's edge.
 * Inside = the L1 cell on the edge within the coarse cell.
 * Outside = the L1 cell one step outward from that edge.
 */
function getEdgeInsideOutsideL1(
  bounds: { minRow: number; maxRow: number; minCol: number; maxCol: number },
  edge: 0 | 2 | 4 | 6,
  p: number,
  editCellSize: number
): { insideL1Row: number; insideL1Col: number; outsideL1Row: number; outsideL1Col: number } {
  switch (edge) {
    case 0: // North: positions left to right
      return {
        insideL1Row: bounds.minRow,
        insideL1Col: bounds.minCol + p * editCellSize,
        outsideL1Row: bounds.minRow - 1,
        outsideL1Col: bounds.minCol + p * editCellSize,
      };
    case 4: // South: positions left to right
      return {
        insideL1Row: bounds.maxRow,
        insideL1Col: bounds.minCol + p * editCellSize,
        outsideL1Row: bounds.maxRow + 1,
        outsideL1Col: bounds.minCol + p * editCellSize,
      };
    case 2: // East: positions top to bottom
      return {
        insideL1Row: bounds.minRow + p * editCellSize,
        insideL1Col: bounds.maxCol,
        outsideL1Row: bounds.minRow + p * editCellSize,
        outsideL1Col: bounds.maxCol + 1,
      };
    case 6: // West: positions top to bottom
      return {
        insideL1Row: bounds.minRow + p * editCellSize,
        insideL1Col: bounds.minCol,
        outsideL1Row: bounds.minRow + p * editCellSize,
        outsideL1Col: bounds.minCol - 1,
      };
    default:
      return { insideL1Row: 0, insideL1Col: 0, outsideL1Row: 0, outsideL1Col: 0 };
  }
}

/**
 * A finer layer constrains the coarser editing layer.
 *
 * Constraint model:
 * - Cardinal connection: fine cells' cardinal inward connections along the edge
 *   determine whether the coarse tile needs that cardinal connection.
 *   If ANY fine cell has inward cardinal = true, coarse must have it.
 * - Diagonal connection: the corner fine cell's diagonal inward connection
 *   determines whether the coarse tile needs that diagonal.
 */
function addFinerLayerConstraints(
  map: CrossLayerEdgeMap,
  editLevel: number,
  editGridInfo: LevelGridInfo,
  fineLevel: number,
  fineTiles: Tile[],
  fineGridInfo: LevelGridInfo,
  baseColumns: number,
  baseRows: number,
  getConnectionsForTile: (tile: Tile) => (boolean | null)[] | null
): void {
  const editCellSize = Math.pow(2, editLevel - 1);
  const fineCellSize = Math.pow(2, fineLevel - 1);
  const scale = editCellSize / fineCellSize;
  if (scale < 2 || !Number.isInteger(scale)) return;

  const cardinalEdges: Array<0 | 2 | 4 | 6> = [0, 2, 4, 6];

  for (let editIdx = 0; editIdx < editGridInfo.cells.length; editIdx++) {
    const editBounds = editGridInfo.cells[editIdx];

    // --- Cardinal edges ---
    for (const edge of cardinalEdges) {
      let anyCardinalTrue = false;
      let anyCardinalFalse = false;
      let anyFinePresent = false;

      // Check all fine cells just outside this edge for their inward CARDINAL connection
      for (let p = 0; p < scale; p++) {
        const { outsideL1Row, outsideL1Col } =
          getEdgeInsideOutsideL1(editBounds, edge, p, fineCellSize);

        if (outsideL1Row < 0 || outsideL1Row >= baseRows ||
            outsideL1Col < 0 || outsideL1Col >= baseColumns) {
          continue;
        }

        const fineIdx = findCellContaining(fineGridInfo, outsideL1Row, outsideL1Col);
        if (fineIdx < 0) continue;

        const fineTile = fineTiles[fineIdx];
        if (!fineTile || fineTile.imageIndex < 0) continue;

        const fineConns = getConnectionsForTile(fineTile);
        if (!fineConns) continue;

        anyFinePresent = true;

        // The fine tile's inward CARDINAL connection (opposite of the edge direction)
        const inwardCardinal = fineConns[oppositeDir[edge]];
        if (inwardCardinal === true) anyCardinalTrue = true;
        else if (inwardCardinal === false) anyCardinalFalse = true;
      }

      if (anyFinePresent && anyCardinalTrue) {
        mergeConstraint(map, editIdx, edge, true);
      } else if (anyFinePresent && anyCardinalFalse && !anyCardinalTrue) {
        mergeConstraint(map, editIdx, edge, false);
      }
    }

    // --- Diagonal corners ---
    const diagDirs: number[] = [1, 3, 5, 7];
    for (const dir of diagDirs) {
      const corner = getCornerFineCell(editBounds, dir);
      const outsideL1Row = corner.l1Row + dirDr[dir];
      const outsideL1Col = corner.l1Col + dirDc[dir];

      if (outsideL1Row < 0 || outsideL1Row >= baseRows ||
          outsideL1Col < 0 || outsideL1Col >= baseColumns) {
        continue;
      }

      const fineIdx = findCellContaining(fineGridInfo, outsideL1Row, outsideL1Col);
      if (fineIdx < 0) continue;

      const fineTile = fineTiles[fineIdx];
      if (!fineTile || fineTile.imageIndex < 0) continue;

      const fineConns = getConnectionsForTile(fineTile);
      if (!fineConns) continue;

      // The fine tile's inward DIAGONAL connection
      const inwardDiag = fineConns[oppositeDir[dir]];
      if (inwardDiag === null || inwardDiag === undefined) continue;

      mergeConstraint(map, editIdx, dir, inwardDiag as boolean);
    }
  }
}

/** Get the corner level-1 cell for a diagonal direction */
function getCornerFineCell(
  bounds: { minRow: number; maxRow: number; minCol: number; maxCol: number },
  diagDir: number
): { l1Row: number; l1Col: number } {
  switch (diagDir) {
    case 1: // NE
      return { l1Row: bounds.minRow, l1Col: bounds.maxCol };
    case 3: // SE
      return { l1Row: bounds.maxRow, l1Col: bounds.maxCol };
    case 5: // SW
      return { l1Row: bounds.maxRow, l1Col: bounds.minCol };
    case 7: // NW
      return { l1Row: bounds.minRow, l1Col: bounds.minCol };
    default:
      return { l1Row: bounds.minRow, l1Col: bounds.minCol };
  }
}

/** Find which cell in a grid info contains a given level-1 coordinate. Returns -1 if not found. */
function findCellContaining(
  gridInfo: LevelGridInfo,
  l1Row: number,
  l1Col: number
): number {
  const { levelCols, levelRows, cells } = gridInfo;
  if (cells.length === 0) return -1;

  const firstCell = cells[0];
  const cellWidth = firstCell.maxCol - firstCell.minCol + 1;
  const cellHeight = firstCell.maxRow - firstCell.minRow + 1;

  const lastCell = cells[cells.length - 1];
  if (l1Row < firstCell.minRow || l1Row > lastCell.maxRow ||
      l1Col < firstCell.minCol || l1Col > lastCell.maxCol) {
    return -1;
  }

  const cellRow = Math.floor((l1Row - firstCell.minRow) / cellHeight);
  const cellCol = Math.floor((l1Col - firstCell.minCol) / cellWidth);

  if (cellRow < 0 || cellRow >= levelRows || cellCol < 0 || cellCol >= levelCols) {
    return -1;
  }

  const idx = cellRow * levelCols + cellCol;
  if (idx < 0 || idx >= cells.length) return -1;

  const cell = cells[idx];
  if (l1Row >= cell.minRow && l1Row <= cell.maxRow &&
      l1Col >= cell.minCol && l1Col <= cell.maxCol) {
    return idx;
  }

  return -1;
}
