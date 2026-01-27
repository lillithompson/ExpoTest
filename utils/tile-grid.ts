export type Tile = {
  imageIndex: number;
  rotation: number;
};

export type GridLayout = {
  columns: number;
  rows: number;
  tileSize: number;
};

export const pickRotation = () => {
  const options = [0, 90, 180, 270];
  return options[Math.floor(Math.random() * options.length)];
};

export const pickNewIndex = (currentIndex: number, sourcesLength: number) => {
  if (sourcesLength <= 1) {
    return currentIndex;
  }

  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * sourcesLength);
  }
  return nextIndex;
};

export const buildInitialTiles = (count: number, sourcesLength: number) => {
  if (count <= 0 || sourcesLength <= 0) {
    return [] as Tile[];
  }
  const base = Array.from({ length: sourcesLength }, (_, index) => index);
  const filled =
    count <= base.length
      ? base.slice(0, count)
      : [
          ...base,
          ...Array.from({ length: count - base.length }, () =>
            Math.floor(Math.random() * sourcesLength)
          ),
        ];
  return filled.map((imageIndex) => ({
    imageIndex,
    rotation: pickRotation(),
  }));
};

export const normalizeTiles = (
  currentTiles: Tile[],
  cellCount: number,
  sourcesLength: number
) => {
  if (cellCount <= 0 || sourcesLength <= 0) {
    return [] as Tile[];
  }
  if (currentTiles.length === 0) {
    return buildInitialTiles(cellCount, sourcesLength);
  }
  if (currentTiles.length === cellCount) {
    return currentTiles;
  }
  if (currentTiles.length < cellCount) {
    const next = [...currentTiles];
    for (let i = currentTiles.length; i < cellCount; i += 1) {
      const source = currentTiles[i % currentTiles.length];
      next.push({ imageIndex: source.imageIndex, rotation: source.rotation });
    }
    return next;
  }
  return currentTiles.slice(0, cellCount);
};

export const computeGridLayout = (
  totalTiles: number,
  availableWidth: number,
  availableHeight: number,
  gridGap: number
): GridLayout => {
  if (totalTiles <= 0 || availableWidth <= 0 || availableHeight <= 0) {
    return { columns: 0, rows: 0, tileSize: 0 };
  }

  let best = { columns: 1, rows: totalTiles, tileSize: 0 };

  for (let columns = 1; columns <= totalTiles; columns += 1) {
    const rows = Math.ceil(totalTiles / columns);
    const widthPerTile = (availableWidth - gridGap * (columns - 1)) / columns;
    const heightPerTile = (availableHeight - gridGap * (rows - 1)) / rows;
    const tileSize = Math.floor(Math.min(widthPerTile, heightPerTile));

    if (tileSize > best.tileSize) {
      best = { columns, rows, tileSize };
    }
  }

  return best;
};
