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

export const parseTileConnections = (fileName: string) => {
  const match = fileName.match(TILE_NAME_PATTERN);
  if (!match) {
    return null;
  }
  const digits = match[1].split('');
  const connections = digits.map((digit) => digit === '1') as TileConnections;
  return connections;
};

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
