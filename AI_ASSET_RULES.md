# AI Asset Rules

## Tile naming convention
- Each tile image may optionally follow this filename format: `tile_00000000.png`
- The 8 digits encode connection points, ordered clockwise starting at **North**:
  1. North (top middle)
  2. NorthEast (top right corner)
  3. East (right middle)
  4. SouthEast (bottom right corner)
  5. South (bottom middle)
  6. SouthWest (bottom left corner)
  7. West (left middle)
  8. NorthWest (top left corner)
- Each digit is `1` if the tile has a connection at that point, otherwise `0`.
- Examples:
  - `tile_10101010.png` connects at the middle of each edge, not corners.
  - `tile_00000000.png` has no connections at any edge or corner.

## Placement rules
- Tiles **without** a conforming filename can be placed anywhere (no constraints).
- Tiles **with** a conforming filename must satisfy connection matching with adjacent tiles:
  - For any shared edge/corner between two tiles, the corresponding connection digits must match.
  - Uninitialized tiles may be adjacent to anything.

## Notes / interpretation
- “Uninitialized” means a tile has no enforced connections until it is set/placed.
- Matching is checked against the **adjacent tile in that direction** (e.g., North of the current tile checks the current tile’s North digit vs. the neighbor’s South digit).
