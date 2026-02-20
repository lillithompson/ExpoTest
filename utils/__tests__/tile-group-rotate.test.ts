import {
  applyGroupRotationToTile,
  rotateCell,
  unrotateCell,
} from '../tile-group-rotate';

describe('tile-group-rotate', () => {
  const H = 2;
  const W = 3;

  describe('rotateCell', () => {
    it('90° CW: (r,c) -> (c, H-1-r) like selection rotate region', () => {
      expect(rotateCell(0, 0, H, W, 90)).toEqual({ newR: 0, newC: 1 });
      expect(rotateCell(1, 0, H, W, 90)).toEqual({ newR: 0, newC: 0 });
      expect(rotateCell(0, 1, H, W, 90)).toEqual({ newR: 1, newC: 1 });
    });

    it('unrotateCell inverts rotateCell for 90°', () => {
      const { newR, newC } = rotateCell(0, 0, H, W, 90);
      expect(unrotateCell(newR, newC, H, W, 90)).toEqual({ r: 0, c: 0 });
    });
  });

  describe('applyGroupRotationToTile', () => {
    it('90°: rotation +90, mirrorX↔mirrorY (same as rotate region)', () => {
      const t = applyGroupRotationToTile(0, false, true, 90);
      expect(t.rotation).toBe(90);
      expect(t.mirrorX).toBe(true);
      expect(t.mirrorY).toBe(false);
    });

    it('180°: rotation +180, mirrors unchanged', () => {
      const t = applyGroupRotationToTile(90, true, false, 180);
      expect(t.rotation).toBe(270);
      expect(t.mirrorX).toBe(true);
      expect(t.mirrorY).toBe(false);
    });

    it('270°: rotation +270, mirrorX↔mirrorY', () => {
      const t = applyGroupRotationToTile(0, true, false, 270);
      expect(t.rotation).toBe(270);
      expect(t.mirrorX).toBe(false);
      expect(t.mirrorY).toBe(true);
    });
  });
});
