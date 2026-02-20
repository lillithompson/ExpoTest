import {
  displayToPatternCell,
  getRotatedDimensions,
  patternCellToDisplay,
} from '../pattern-transform';

describe('pattern-transform', () => {
  const W = 3;
  const H = 2;

  function roundTrip(
    pr: number,
    pc: number,
    rot: number,
    mirror: boolean
  ) {
    const fwd = patternCellToDisplay(pr, pc, W, H, rot, mirror);
    const inv = displayToPatternCell(fwd.displayRow, fwd.displayCol, W, H, rot, mirror);
    return inv && inv.sourceRow === pr && inv.sourceCol === pc;
  }

  for (const rot of [0, 90, 180, 270]) {
    for (const mirror of [false, true]) {
      it(`round-trips for ${rot}° mirror=${mirror}`, () => {
        for (let pr = 0; pr < H; pr++) {
          for (let pc = 0; pc < W; pc++) {
            expect(roundTrip(pr, pc, rot, mirror)).toBe(true);
          }
        }
      });
    }
  }

  it('90° display (0,0) is pattern (H-1, 0)', () => {
    const r = displayToPatternCell(0, 0, W, H, 90, false);
    expect(r).toEqual({ sourceRow: H - 1, sourceCol: 0 });
  });

  it('270° display (0,0) is pattern (0, W-1)', () => {
    const r = displayToPatternCell(0, 0, W, H, 270, false);
    expect(r).toEqual({ sourceRow: 0, sourceCol: W - 1 });
  });

  it('rotated dimensions 90/270 swap W and H', () => {
    const d = getRotatedDimensions(90, W, H);
    expect(d.rotW).toBe(H);
    expect(d.rotH).toBe(W);
  });
});
