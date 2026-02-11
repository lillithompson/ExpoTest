/**
 * Draw stroke validation: when a stroke is done,
 * 1) the first tile has exactly one connection,
 * 2) every other tile has exactly two connections (only toward stroke neighbors).
 */
import type { Tile } from '../tile-grid';
import type { TileConnections } from '../tile-compat';
import {
  getDirectionFromTo,
  getStrokeNeighborDirections,
  validateDrawStroke,
  type GetConnectionsForPlacement,
} from '../draw-stroke';

const columns = 3;

function connFromPattern(pattern: string): TileConnections {
  const digits = pattern.split('').map((c) => c === '1');
  return digits as TileConnections;
}

describe('getDirectionFromTo', () => {
  it('returns E (2) from cell 0 to cell 1 when columns=3', () => {
    expect(getDirectionFromTo(0, 1, columns)).toBe(2);
  });
  it('returns W (6) from cell 1 to cell 0', () => {
    expect(getDirectionFromTo(1, 0, columns)).toBe(6);
  });
  it('returns -1 when not adjacent', () => {
    expect(getDirectionFromTo(0, 5, columns)).toBe(-1);
  });
});

describe('getStrokeNeighborDirections', () => {
  it('first tile (index 0) has only direction to next', () => {
    const stroke = [0, 1];
    const allowed = getStrokeNeighborDirections(0, stroke, 0, columns);
    expect(allowed.size).toBe(1);
    expect(allowed.has(2)).toBe(true);
  });
  it('middle tile has directions to prev and next', () => {
    const stroke = [0, 1, 2];
    const allowed = getStrokeNeighborDirections(1, stroke, 1, columns);
    expect(allowed.size).toBe(2);
    expect(allowed.has(6)).toBe(true);
    expect(allowed.has(2)).toBe(true);
  });
  it('last tile has only direction to prev', () => {
    const stroke = [0, 1, 2];
    const allowed = getStrokeNeighborDirections(2, stroke, 2, columns);
    expect(allowed.size).toBe(1);
    expect(allowed.has(6)).toBe(true);
  });
});

describe('validateDrawStroke', () => {
  const getConnections: GetConnectionsForPlacement = (
    imageIndex: number,
    _rotation: number,
    _mirrorX: boolean,
    _mirrorY: boolean
  ) => {
    const mock: Record<number, TileConnections> = {
      0: connFromPattern('00100000'),
      1: connFromPattern('00100010'),
      2: connFromPattern('10000010'),
    };
    return mock[imageIndex] ?? null;
  };

  it('valid stroke: first 1 conn, middle 2 conn, last 2 conn (one to prev, one free)', () => {
    const strokeOrder = [0, 1, 2];
    const tilesState: Tile[] = [];
    tilesState[0] = {
      imageIndex: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    };
    tilesState[1] = {
      imageIndex: 1,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    };
    tilesState[2] = {
      imageIndex: 2,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
    };
    const valid = validateDrawStroke(strokeOrder, tilesState, columns, getConnections);
    expect(valid).toBe(true);
  });

  it('invalid when first tile has 0 connections', () => {
    const getConnectionsZeroFirst: GetConnectionsForPlacement = (imageIndex) => {
      if (imageIndex === 0) return connFromPattern('00000000');
      if (imageIndex === 1) return connFromPattern('00100100');
      return connFromPattern('00000100');
    };
    const strokeOrder = [0, 1];
    const tilesState: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    expect(validateDrawStroke(strokeOrder, tilesState, columns, getConnectionsZeroFirst)).toBe(
      false
    );
  });

  it('invalid when first tile has 2 connections', () => {
    const getConnectionsTwoFirst: GetConnectionsForPlacement = (imageIndex) => {
      if (imageIndex === 0) return connFromPattern('10100000');
      return connFromPattern('00100100');
    };
    const strokeOrder = [0, 1];
    const tilesState: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    expect(validateDrawStroke(strokeOrder, tilesState, columns, getConnectionsTwoFirst)).toBe(
      false
    );
  });

  it('invalid when middle tile has 1 connection', () => {
    const getConnectionsOneMiddle: GetConnectionsForPlacement = (imageIndex) => {
      if (imageIndex === 0) return connFromPattern('00100000');
      if (imageIndex === 1) return connFromPattern('00000100');
      return connFromPattern('00000100');
    };
    const strokeOrder = [0, 1, 2];
    const tilesState: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 2, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    expect(validateDrawStroke(strokeOrder, tilesState, columns, getConnectionsOneMiddle)).toBe(
      false
    );
  });

  it('invalid when tile has connection in non-neighbor direction', () => {
    const getConnectionsWrongDir: GetConnectionsForPlacement = (imageIndex) => {
      if (imageIndex === 0) return connFromPattern('00100000');
      if (imageIndex === 1) return connFromPattern('00100101');
      return connFromPattern('10000010');
    };
    const strokeOrder = [0, 1, 2];
    const tilesState: Tile[] = [
      { imageIndex: 0, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 1, rotation: 0, mirrorX: false, mirrorY: false },
      { imageIndex: 2, rotation: 0, mirrorX: false, mirrorY: false },
    ];
    expect(validateDrawStroke(strokeOrder, tilesState, columns, getConnectionsWrongDir)).toBe(
      false
    );
  });
});
