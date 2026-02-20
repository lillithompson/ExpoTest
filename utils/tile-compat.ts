export type TileConnections = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
];

const TILE_NAME_PATTERN = /^.+_([01]{8})\.(png|jpe?g|webp|svg)$/i;

type VariantKey = string;

export type TileVariant = {
  index: number;
  rotation: number;
  mirrorX: boolean;
  mirrorY: boolean;
  connections: TileConnections;
  key: string;
};

export type TileCompatibilityTables = {
  connectionsByIndex: Array<TileConnections | null>;
  variantsByIndex: TileVariant[][];
  variantsByKey: Map<string, TileVariant[]>;
  getConnectionsForPlacement: (
    index: number,
    rotation: number,
    mirrorX: boolean,
    mirrorY: boolean
  ) => TileConnections | null;
};

const compatibilityCache = new Map<string, TileCompatibilityTables>();

const toVariantKey = (rotation: number, mirrorX: boolean, mirrorY: boolean): VariantKey =>
  `${rotation}|${mirrorX ? 1 : 0}|${mirrorY ? 1 : 0}`;

const toConnectionKey = (connections: boolean[] | null) =>
  connections ? connections.map((value) => (value ? '1' : '0')).join('') : null;

const buildSourceKey = (sources: Array<{ name: string }>) =>
  sources.map((source) => source.name).join('|');

export const parseTileConnections = (fileName: string) => {
  const match = fileName.match(TILE_NAME_PATTERN);
  if (!match) {
    return null;
  }
  const digits = match[1].split('');
  const connections = digits.map((digit) => digit === '1') as TileConnections;
  return connections;
};

/** Lightweight 0–8 count from filename; no array allocation. Use for palette ordering. */
export function getConnectionCountFromFileName(fileName: string): number {
  const match = fileName.match(TILE_NAME_PATTERN);
  if (!match) return 0;
  let count = 0;
  const digits = match[1];
  for (let i = 0; i < 8; i++) if (digits[i] === '1') count++;
  return count;
}

export const rotateConnections = (
  connections: TileConnections,
  rotationSteps: number
) => {
  const steps = ((rotationSteps % 4) + 4) % 4;
  if (steps === 0) {
    return connections;
  }
  const shift = steps * 2;
  const rotated = connections.map(
    (_, index) => connections[(index - shift + 8) % 8]
  ) as TileConnections;
  return rotated;
};

export const mirrorConnections = (
  connections: TileConnections,
  mirrorX: boolean,
  mirrorY: boolean
) => {
  let result = connections;

  if (mirrorX) {
    result = [
      result[0],
      result[7],
      result[6],
      result[5],
      result[4],
      result[3],
      result[2],
      result[1],
    ];
  }

  if (mirrorY) {
    result = [
      result[4],
      result[3],
      result[2],
      result[1],
      result[0],
      result[7],
      result[6],
      result[5],
    ];
  }

  return result as TileConnections;
};

export const transformConnections = (
  connections: TileConnections,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean
) => {
  const rotationSteps = ((rotation / 90) % 4 + 4) % 4;
  const rotated = rotateConnections(connections, rotationSteps);
  return mirrorConnections(rotated, mirrorX, mirrorY);
};

export const oppositeDirectionIndex = (index: number) => (index + 4) % 8;

export const getTransformedConnectionsForName = (
  fileName: string,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean
) => {
  const parsed = parseTileConnections(fileName);
  if (!parsed) {
    return null;
  }
  return transformConnections(parsed, rotation, mirrorX, mirrorY);
};

export const buildCompatibilityTables = (
  sources: Array<{ name: string }>
): TileCompatibilityTables => {
  const key = buildSourceKey(sources);
  const cached = compatibilityCache.get(key);
  if (cached) {
    return cached;
  }

  const connectionsByIndex = sources.map((source) =>
    parseTileConnections(source.name)
  );
  const variantsByIndex: TileVariant[][] = connectionsByIndex.map(() => []);
  const variantsByKey = new Map<string, TileVariant[]>();
  const lookupByIndex: Array<Map<VariantKey, TileConnections>> = connectionsByIndex.map(
    () => new Map()
  );
  const rotations = [0, 90, 180, 270];
  const mirrors = [
    { mirrorX: false, mirrorY: false },
    { mirrorX: true, mirrorY: false },
    { mirrorX: false, mirrorY: true },
    { mirrorX: true, mirrorY: true },
  ];

  connectionsByIndex.forEach((connections, index) => {
    if (!connections) {
      return;
    }
    rotations.forEach((rotation) => {
      mirrors.forEach(({ mirrorX, mirrorY }) => {
        const transformed = transformConnections(connections, rotation, mirrorX, mirrorY);
        const key = toConnectionKey(transformed);
        if (!key) {
          return;
        }
        const variant: TileVariant = {
          index,
          rotation,
          mirrorX,
          mirrorY,
          connections: transformed,
          key,
        };
        variantsByIndex[index].push(variant);
        const existing = variantsByKey.get(key);
        if (existing) {
          existing.push(variant);
        } else {
          variantsByKey.set(key, [variant]);
        }
        lookupByIndex[index].set(toVariantKey(rotation, mirrorX, mirrorY), transformed);
      });
    });
  });

  const getConnectionsForPlacement = (
    index: number,
    rotation: number,
    mirrorX: boolean,
    mirrorY: boolean
  ) => {
    const base = connectionsByIndex[index];
    if (!base) {
      return null;
    }
    const lookup = lookupByIndex[index];
    if (!lookup) {
      return base;
    }
    return lookup.get(toVariantKey(rotation, mirrorX, mirrorY)) ?? base;
  };

  const tables: TileCompatibilityTables = {
    connectionsByIndex,
    variantsByIndex,
    variantsByKey,
    getConnectionsForPlacement,
  };
  compatibilityCache.set(key, tables);
  return tables;
};
