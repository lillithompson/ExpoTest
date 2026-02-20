/**
 * Pattern transform: matches the thumbnail (pattern-thumbnail.tsx).
 * Thumbnail draws pattern in natural order (H rows × W cols) then applies:
 * 1) mirror (scaleX -1 in pattern space), 2) rotate (rotationCW degrees).
 *
 * Forward: pattern (pr, pc) -> display (dR, dC).
 * Inverse: display (dR, dC) -> pattern (sourceRow, sourceCol).
 */

const ROTATIONS = [0, 90, 180, 270] as const;

export type PatternTransform = {
  width: number;
  height: number;
  rotationCW: number;
  mirrorX: boolean;
};

/**
 * Dimensions of the repeating pattern block on the canvas (same as thumbnail outer view).
 * 0/180: height rows × width cols; 90/270: width rows × height cols.
 */
export function getRotatedDimensions(rotationCW: number, width: number, height: number) {
  const normalized = ((rotationCW % 360) + 360) % 360;
  const rotW = normalized % 180 === 0 ? width : height;
  const rotH = normalized % 180 === 0 ? height : width;
  return { rotW, rotH };
}

/**
 * Forward: which display cell (dR, dC) does pattern cell (pr, pc) land in?
 * Inner grid: pattern (pr, pc) is at inner (pr, mirror ? W-1-pc : pc). Then rotate.
 */
export function patternCellToDisplay(
  patternRow: number,
  patternCol: number,
  width: number,
  height: number,
  rotationCW: number,
  mirrorX: boolean
): { displayRow: number; displayCol: number } {
  const W = width;
  const H = height;
  const rot = ((rotationCW % 360) + 360) % 360;
  const ic = mirrorX ? W - 1 - patternCol : patternCol;
  const ir = patternRow;
  if (rot === 0) return { displayRow: ir, displayCol: ic };
  if (rot === 90) return { displayRow: ic, displayCol: H - 1 - ir };
  if (rot === 180) return { displayRow: H - 1 - ir, displayCol: W - 1 - ic };
  // 270
  return { displayRow: W - 1 - ic, displayCol: ir };
}

/**
 * Inverse of patternCellToDisplay: display (dR, dC) -> pattern (sourceRow, sourceCol).
 */
export function displayToPatternCell(
  displayRow: number,
  displayCol: number,
  width: number,
  height: number,
  rotationCW: number,
  mirrorX: boolean
): { sourceRow: number; sourceCol: number } | null {
  const W = width;
  const H = height;
  const rot = ((rotationCW % 360) + 360) % 360;
  if (!ROTATIONS.includes(rot as (typeof ROTATIONS)[number])) {
    return null;
  }

  let ir: number;
  let ic: number;
  if (rot === 0) {
    ir = displayRow;
    ic = displayCol;
  } else if (rot === 90) {
    // display (dR, dC) = (ic, H-1-ir) -> ir = H-1-dC, ic = dR
    ir = H - 1 - displayCol;
    ic = displayRow;
  } else if (rot === 180) {
    // display (dR, dC) = (H-1-ir, W-1-ic) -> ir = H-1-dR, ic = W-1-dC
    ir = H - 1 - displayRow;
    ic = W - 1 - displayCol;
  } else {
    // 270: display (dR, dC) = (W-1-ic, ir) -> ir = dC, ic = W-1-dR
    ir = displayCol;
    ic = W - 1 - displayRow;
  }
  const sourceRow = ir;
  const sourceCol = mirrorX ? W - 1 - ic : ic;

  if (sourceRow < 0 || sourceRow >= H || sourceCol < 0 || sourceCol >= W) {
    return null;
  }
  return { sourceRow, sourceCol };
}
