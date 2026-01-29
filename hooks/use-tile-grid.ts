import { useEffect, useMemo, useRef, useState } from 'react';

import {
  buildInitialTiles,
  computeGridLayout,
  normalizeTiles,
  pickNewIndex,
  pickRotation,
  type GridLayout,
  type Tile,
} from '@/utils/tile-grid';

type Params = {
  tileSourcesLength: number;
  availableWidth: number;
  availableHeight: number;
  gridGap: number;
};

type Result = {
  gridLayout: GridLayout;
  tiles: Tile[];
  handlePress: (cellIndex: number) => void;
  totalCells: number;
};

export const useTileGrid = ({
  tileSourcesLength,
  availableWidth,
  availableHeight,
  gridGap,
}: Params): Result => {
  const gridLayout = useMemo(
    () =>
      computeGridLayout(tileSourcesLength, availableWidth, availableHeight, gridGap),
    [availableHeight, availableWidth, gridGap, tileSourcesLength]
  );
  const totalCells = gridLayout.rows * gridLayout.columns;
  const [tiles, setTiles] = useState<Tile[]>(() =>
    buildInitialTiles(Math.max(totalCells, tileSourcesLength), tileSourcesLength)
  );
  const lastPressRef = useRef<{
    cellIndex: number;
    imageIndex: number;
    rotation: number;
    time: number;
  } | null>(null);

  const renderTiles = useMemo(
    () => normalizeTiles(tiles, totalCells, tileSourcesLength),
    [tiles, totalCells, tileSourcesLength]
  );

  useEffect(() => {
    setTiles(
      buildInitialTiles(Math.max(totalCells, tileSourcesLength), tileSourcesLength)
    );
  }, [tileSourcesLength, totalCells]);

  useEffect(() => {
    setTiles((prev) => normalizeTiles(prev, totalCells, tileSourcesLength));
  }, [totalCells, tileSourcesLength]);

  const handlePress = (cellIndex: number) => {
    const current = renderTiles[cellIndex];
    if (!current) {
      return;
    }
    const now = Date.now();
    const cached =
      lastPressRef.current &&
      lastPressRef.current.cellIndex === cellIndex &&
      now - lastPressRef.current.time < 150
        ? lastPressRef.current
        : null;

    if (tileSourcesLength <= 0) {
      return;
    }
    const nextImageIndex = cached
      ? cached.imageIndex
      : pickNewIndex(current.imageIndex, tileSourcesLength);
    const nextRotation = cached ? cached.rotation : pickRotation();

    lastPressRef.current = {
      cellIndex,
      imageIndex: nextImageIndex,
      rotation: nextRotation,
      time: now,
    };

    setTiles((prev) =>
      normalizeTiles(prev, totalCells, tileSourcesLength).map((tile, index) =>
        index === cellIndex
          ? { imageIndex: nextImageIndex, rotation: nextRotation }
          : tile
      )
    );
  };

  return { gridLayout, tiles: renderTiles, handlePress, totalCells };
};
