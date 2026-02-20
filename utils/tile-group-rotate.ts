/**
 * Reusable logic for rotating a group of tiles (same as selection-tool "Rotate region").
 * When a rectangular region is rotated 90° CW, each cell (r, c) moves to (c, height - 1 - r),
 * and each tile's transform is updated: rotation += 90, mirrorX/mirrorY swapped.
 * This module provides the position mapping and tile-transform rules for 0/90/180/270.
 */

/** Rotation in degrees clockwise: 0, 90, 180, 270 */
export type RotationCW = 0 | 90 | 180 | 270;

/**
 * For a rectangle of size (height × width), map cell (r, c) to its position after
 * rotating the rectangle by rotationCW. Same convention as rotate region: 90° CW
 * sends (r, c) -> (c, height - 1 - r).
 */
export function rotateCell(
  r: number,
  c: number,
  height: number,
  width: number,
  rotationCW: RotationCW
): { newR: number; newC: number } {
  if (rotationCW === 0) return { newR: r, newC: c };
  if (rotationCW === 90) return { newR: c, newC: height - 1 - r };
  if (rotationCW === 180) return { newR: height - 1 - r, newC: width - 1 - c };
  // 270 CW
  return { newR: width - 1 - c, newC: r };
}

/**
 * Inverse of rotateCell: given (newR, newC) in the rotated rectangle (which has
 * dimensions swapped for 90/270: width×height), return (r, c) in the original.
 */
export function unrotateCell(
  newR: number,
  newC: number,
  height: number,
  width: number,
  rotationCW: RotationCW
): { r: number; c: number } {
  if (rotationCW === 0) return { r: newR, c: newC };
  if (rotationCW === 90) return { r: height - 1 - newC, c: newR };
  if (rotationCW === 180) return { r: height - 1 - newR, c: width - 1 - newC };
  return { r: newC, c: width - 1 - newR };
}

/**
 * When a tile is part of a group rotated by rotationCW, update its transform
 * so it "rotates with" the group (same as selection-tool rotate region).
 * - 90° CW: rotation += 90, mirrorX ↔ mirrorY
 * - 180°: rotation += 180, mirrors unchanged
 * - 270° CW: rotation += 270, mirrorX ↔ mirrorY
 */
export function applyGroupRotationToTile(
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean,
  rotationCW: RotationCW
): { rotation: number; mirrorX: boolean; mirrorY: boolean } {
  const rot = ((rotation + rotationCW) % 360 + 360) % 360;
  if (rotationCW === 0) return { rotation: rot, mirrorX, mirrorY };
  if (rotationCW === 180) return { rotation: rot, mirrorX, mirrorY };
  // 90 and 270: swap mirrors (same as rotate region)
  return { rotation: rot, mirrorX: mirrorY, mirrorY: mirrorX };
}

export function normalizeRotationCW(degrees: number): RotationCW {
  const n = ((degrees % 360) + 360) % 360;
  if (n === 0) return 0;
  if (n === 90) return 90;
  if (n === 180) return 180;
  if (n === 270) return 270;
  return 0;
}
