#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = process.cwd();
const tilesDir = path.join(root, 'assets', 'images', 'tiles');

if (!fs.existsSync(tilesDir)) {
  console.error('Tiles directory not found:', tilesDir);
  process.exit(1);
}

let pending = false;
let running = false;

const runGenerator = () => {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const proc = spawn('node', [path.join(root, 'scripts', 'generate-tiles-manifest.js')], {
    stdio: 'inherit',
  });
  proc.on('exit', () => {
    running = false;
    if (pending) {
      pending = false;
      runGenerator();
    }
  });
};

console.log(`Watching ${tilesDir} for changes...`);
runGenerator();

fs.watch(
  tilesDir,
  { recursive: true },
  (eventType, filename) => {
    if (!filename) {
      return;
    }
    if (filename.toLowerCase().endsWith('manifest.ts')) {
      return;
    }
    runGenerator();
  }
);
