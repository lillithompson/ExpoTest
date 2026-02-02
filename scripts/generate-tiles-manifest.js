#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const tilesDir = path.join(root, 'assets', 'images', 'tiles');
const outputPath = path.join(tilesDir, 'manifest.ts');
const imageExt = /\.(png|jpg|jpeg|webp|svg)$/i;

if (!fs.existsSync(tilesDir)) {
  console.error('Tiles directory not found:', tilesDir);
  process.exit(1);
}

const directories = fs
  .readdirSync(tilesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const entries = directories.map((dirName) => {
  const dirPath = path.join(tilesDir, dirName);
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => imageExt.test(file))
    .sort();

  const entries = files
    .map(
      (file) =>
        `    { name: ${JSON.stringify(
          file
        )}, source: require('@/assets/images/tiles/${dirName}/${file}') }`
    )
    .join(',\n');

  return `  ${JSON.stringify(dirName)}: [\n${entries}\n  ]`;
});

const output = `export const TILE_MANIFEST = {\n${entries.join(',\n')}\n} as const;\n\nexport type TileCategory = keyof typeof TILE_MANIFEST;\nexport type TileSource = (typeof TILE_MANIFEST)[TileCategory][number];\nexport const TILE_CATEGORIES = Object.keys(TILE_MANIFEST) as TileCategory[];\n`;

fs.writeFileSync(outputPath, output, 'utf8');
console.log(`Generated tile manifest at ${path.relative(root, outputPath)}`);
