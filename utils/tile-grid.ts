export type Tile = {
  imageIndex: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  source?: unknown;
  name?: string;
  baseConnections?: boolean[] | null;
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

export const buildInitialTiles = (count: number) => {
  if (count <= 0) {
    return [] as Tile[];
  }
  return Array.from({ length: count }, () => ({
    imageIndex: -1,
    rotation: 0,
    mirrorX: false,
    mirrorY: false,
  }));
};

export const normalizeTiles = (
  currentTiles: Tile[],
  cellCount: number,
  _sourcesLength: number
) => {
  if (cellCount <= 0) {
    return [] as Tile[];
  }
  if (currentTiles.length === 0) {
    return buildInitialTiles(cellCount);
  }
  if (currentTiles.length === cellCount) {
    return currentTiles;
  }
  if (currentTiles.length < cellCount) {
    const next = [...currentTiles];
    for (let i = currentTiles.length; i < cellCount; i += 1) {
      const source = currentTiles[i % currentTiles.length];
      next.push({
        imageIndex: source.imageIndex,
        rotation: source.rotation,
        mirrorX: source.mirrorX,
        mirrorY: source.mirrorY,
      });
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

  const evenColumns = best.columns % 2 === 0 ? best.columns : best.columns + 1;
  const evenRows = best.rows % 2 === 0 ? best.rows : best.rows + 1;
  const widthPerTile =
    (availableWidth - gridGap * (evenColumns - 1)) / evenColumns;
  const heightPerTile = (availableHeight - gridGap * (evenRows - 1)) / evenRows;
  const evenTileSize = Math.floor(Math.min(widthPerTile, heightPerTile));

  return { columns: evenColumns, rows: evenRows, tileSize: evenTileSize };
};
