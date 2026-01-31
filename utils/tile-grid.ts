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
  availableWidth: number,
  availableHeight: number,
  gridGap: number,
  preferredTileSize: number
): GridLayout => {
  if (availableWidth <= 0 || availableHeight <= 0 || preferredTileSize <= 0) {
    return { columns: 0, rows: 0, tileSize: 0 };
  }

  const maxColumns = Math.max(
    1,
    Math.floor((availableWidth + gridGap) / (Math.max(1, preferredTileSize) + gridGap))
  );
  const candidates: GridLayout[] = [];

  for (let columns = 2; columns <= maxColumns; columns += 1) {
    if (columns % 2 === 1) {
      continue;
    }
    const tileSize = (availableWidth - gridGap * (columns - 1)) / columns;
    if (tileSize <= 0) {
      continue;
    }
    let rows = Math.max(
      1,
      Math.floor((availableHeight + gridGap) / (tileSize + gridGap))
    );
    if (rows > 1 && rows % 2 === 1) {
      rows -= 1;
    }
    if (rows < 2) {
      continue;
    }
    candidates.push({ columns, rows, tileSize });
  }

  if (candidates.length === 0) {
    const columns = Math.max(1, maxColumns);
    const tileSize = (availableWidth - gridGap * (columns - 1)) / columns;
    const rows = Math.max(
      1,
      Math.floor((availableHeight + gridGap) / (tileSize + gridGap))
    );
    return { columns, rows, tileSize };
  }

  candidates.sort(
    (a, b) => Math.abs(a.tileSize - preferredTileSize) - Math.abs(b.tileSize - preferredTileSize)
  );
  return candidates[0];
};
