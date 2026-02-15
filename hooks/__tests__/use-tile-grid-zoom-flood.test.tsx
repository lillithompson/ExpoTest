/**
 * Tests that flood operations when zoomed never modify tiles outside the zoom region.
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { useTileGrid } from '../use-tile-grid';
import { getSpiralCellOrderInRect } from '@/utils/tile-grid';
import type { Tile } from '@/utils/tile-grid';

const MIN_ROW = 1;
const MIN_COL = 1;
const MAX_ROW = 4;
const MAX_COL = 4;
const GRID_COLUMNS = 6;
const GRID_ROWS = 6;
const TOTAL_CELLS = GRID_COLUMNS * GRID_ROWS;

const ZOOM_REGION = {
  minRow: MIN_ROW,
  maxRow: MAX_ROW,
  minCol: MIN_COL,
  maxCol: MAX_COL,
};

const SENTINEL_INDEX = 99;

function getZoomIndices(): Set<number> {
  return new Set(
    getSpiralCellOrderInRect(
      ZOOM_REGION.minRow,
      ZOOM_REGION.minCol,
      ZOOM_REGION.maxRow,
      ZOOM_REGION.maxCol,
      GRID_COLUMNS
    )
  );
}

function createInitialTiles(): Tile[] {
  return Array.from({ length: TOTAL_CELLS }, () => ({
    imageIndex: SENTINEL_INDEX,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
  }));
}

const mockTileSources = [{ name: 'test', source: {} }] as unknown as Parameters<typeof useTileGrid>[0]['tileSources'];

const baseParams = {
  tileSources: mockTileSources,
  availableWidth: 400,
  availableHeight: 400,
  gridGap: 2,
  preferredTileSize: 40,
  allowEdgeConnections: false,
  fixedRows: GRID_ROWS,
  fixedColumns: GRID_COLUMNS,
  brush: { mode: 'erase' as const },
  mirrorHorizontal: false,
  mirrorVertical: false,
  pattern: null,
  zoomRegion: ZOOM_REGION,
};

describe('useTileGrid zoomed flood', () => {
  it('floodFill (erase) when zoomed does not change tiles outside zoom region', () => {
    const zoomIndices = getZoomIndices();
    const { result } = renderHook(() => useTileGrid(baseParams as Parameters<typeof useTileGrid>[0]));

    act(() => {
      result.current.loadTiles(createInitialTiles());
    });

    act(() => {
      result.current.floodFill();
    });

    const after = result.current.fullTilesForSave;
    expect(after).toHaveLength(TOTAL_CELLS);
    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      if (!zoomIndices.has(index)) {
        expect(after[index].imageIndex).toBe(SENTINEL_INDEX);
      }
    }
  });

  it('floodComplete (erase) when zoomed does not change tiles outside zoom region', () => {
    const zoomIndices = getZoomIndices();
    const { result } = renderHook(() => useTileGrid(baseParams as Parameters<typeof useTileGrid>[0]));

    act(() => {
      result.current.loadTiles(createInitialTiles());
    });

    act(() => {
      result.current.floodComplete();
    });

    const after = result.current.fullTilesForSave;
    expect(after).toHaveLength(TOTAL_CELLS);
    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      if (!zoomIndices.has(index)) {
        expect(after[index].imageIndex).toBe(SENTINEL_INDEX);
      }
    }
  });

  it('floodFill (random) when zoomed does not change tiles outside zoom region', () => {
    const zoomIndices = getZoomIndices();
    const { result } = renderHook(() =>
      useTileGrid({ ...baseParams, brush: { mode: 'random' } } as Parameters<typeof useTileGrid>[0])
    );

    act(() => {
      result.current.loadTiles(createInitialTiles());
    });

    act(() => {
      result.current.floodFill();
    });

    const after = result.current.fullTilesForSave;
    expect(after).toHaveLength(TOTAL_CELLS);
    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      if (!zoomIndices.has(index)) {
        expect(after[index].imageIndex).toBe(SENTINEL_INDEX);
      }
    }
  });

  it('floodFill (fixed) when zoomed does not change tiles outside zoom region', () => {
    const zoomIndices = getZoomIndices();
    const { result } = renderHook(() =>
      useTileGrid({
        ...baseParams,
        brush: {
          mode: 'fixed',
          index: 0,
          rotation: 0,
          mirrorX: false,
          mirrorY: false,
        },
      } as Parameters<typeof useTileGrid>[0])
    );

    act(() => {
      result.current.loadTiles(createInitialTiles());
    });

    act(() => {
      result.current.floodFill();
    });

    const after = result.current.fullTilesForSave;
    expect(after).toHaveLength(TOTAL_CELLS);
    for (let index = 0; index < TOTAL_CELLS; index += 1) {
      if (!zoomIndices.has(index)) {
        expect(after[index].imageIndex).toBe(SENTINEL_INDEX);
      }
    }
  });
});
