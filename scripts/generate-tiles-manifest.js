#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const tilesDir = path.join(root, 'assets', 'images', 'tiles');
const outputPath = path.join(tilesDir, 'manifest.ts');
const connectionCountsPath = path.join(tilesDir, 'connection-counts.ts');
const imageExt = /\.(png|jpg|jpeg|webp|svg)$/i;
const TILE_NAME_PATTERN = /^.+_([01]{8})\.(png|jpe?g|webp|svg)$/i;

function getConnectionCount(fileName) {
  const match = fileName.match(TILE_NAME_PATTERN);
  if (!match) return 0;
  let count = 0;
  const digits = match[1];
  for (let i = 0; i < 8; i++) if (digits[i] === '1') count++;
  return count;
}

if (!fs.existsSync(tilesDir)) {
  console.error('Tiles directory not found:', tilesDir);
  process.exit(1);
}

const THUMBNAIL_FILENAME = 'thumbnail.svg';

const directories = fs
  .readdirSync(tilesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const manifestEntries = [];
const thumbnailEntries = [];
const connectionCounts = {};

for (const dirName of directories) {
  const dirPath = path.join(tilesDir, dirName);
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => imageExt.test(file))
    .sort();

  const tileFiles = files.filter((file) => file.toLowerCase() !== THUMBNAIL_FILENAME.toLowerCase());
  const hasThumbnail = files.some((f) => f.toLowerCase() === THUMBNAIL_FILENAME.toLowerCase());

  tileFiles.forEach((file) => {
    connectionCounts[file] = getConnectionCount(file);
  });

  const tileEntries = tileFiles
    .map(
      (file) =>
        `    { name: ${JSON.stringify(
          file
        )}, source: require('@/assets/images/tiles/${dirName}/${file}') }`
    )
    .join(',\n');

  manifestEntries.push(`  ${JSON.stringify(dirName)}: [\n${tileEntries}\n  ]`);

  if (hasThumbnail) {
    thumbnailEntries.push(
      `  ${JSON.stringify(dirName)}: { name: ${JSON.stringify(THUMBNAIL_FILENAME)}, source: require('@/assets/images/tiles/${dirName}/${THUMBNAIL_FILENAME}') }`
    );
  } else {
    thumbnailEntries.push(`  ${JSON.stringify(dirName)}: null`);
  }
}

const output = `export const TILE_MANIFEST = {\n${manifestEntries.join(',\n')}\n} as const;\n\n/** Thumbnail for each built-in tile set; null if directory has no thumbnail.svg. Not included as a tile option. */\nexport const TILE_CATEGORY_THUMBNAILS: Record<keyof typeof TILE_MANIFEST, { name: string; source: unknown } | null> = {\n${thumbnailEntries.join(',\n')}\n};\n\nexport type TileCategory = keyof typeof TILE_MANIFEST;\nexport type TileSource = (typeof TILE_MANIFEST)[TileCategory][number];\nexport const TILE_CATEGORIES = Object.keys(TILE_MANIFEST) as TileCategory[];\n`;

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Generated tile manifest at ${path.relative(root, outputPath)}`);

const connectionCountsJson = JSON.stringify(connectionCounts, null, 0);
const connectionCountsOutput = `/** Precomputed at build time by scripts/generate-tiles-manifest.js. Used for fast palette ordering. */\nexport const TILE_CONNECTION_COUNTS: Record<string, number> = ${connectionCountsJson};\n`;
fs.writeFileSync(connectionCountsPath, connectionCountsOutput, 'utf8');
console.log(`Generated connection counts at ${path.relative(root, connectionCountsPath)}`);
