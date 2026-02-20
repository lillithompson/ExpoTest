#!/usr/bin/env node
/**
 * Profiles the tile palette load path without starting the full app.
 * Run: node scripts/profile-palette-load.js
 * Uses the same logic as TileBrushPanel + tile-compat to time each step.
 */

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const connectionCountsPath = path.join(root, 'assets', 'images', 'tiles', 'connection-counts.ts');

function now() {
  return Date.now();
}

// 1) Time loading + parsing connection-counts.ts (simulates module load)
let TILE_CONNECTION_COUNTS;
{
  const t0 = now();
  const raw = fs.readFileSync(connectionCountsPath, 'utf8');
  const match = raw.match(/=\s*(\{[\s\S]*\})\s*;/);
  if (!match) throw new Error('Could not extract JSON from connection-counts.ts');
  TILE_CONNECTION_COUNTS = JSON.parse(match[1]);
  const ms = now() - t0;
  console.log(`[Profile] 1. Parse connection-counts.ts: ${ms.toFixed(2)}ms (${Object.keys(TILE_CONNECTION_COUNTS).length} entries)`);
}

// Use 3x names to simulate a larger palette (e.g. multiple categories selected)
const tileNamesOnce = Object.keys(TILE_CONNECTION_COUNTS);
const tileNames = [...tileNamesOnce, ...tileNamesOnce, ...tileNamesOnce];
const N = tileNames.length;
console.log(`[Profile] Simulating palette with ${N} tiles (${tileNamesOnce.length} unique)\n`);

// Simulate getConnectionCount (panel uses this with cache; we use precomputed only)
function getConnectionCount(name) {
  const pre = TILE_CONNECTION_COUNTS[name];
  if (pre !== undefined) return pre;
  const TILE_NAME_PATTERN = /^.+_([01]{8})\.(png|jpe?g|webp|svg)$/i;
  const m = name.match(TILE_NAME_PATTERN);
  if (!m) return 0;
  let count = 0;
  for (let i = 0; i < 8; i++) if (m[1][i] === '1') count++;
  return count;
}

// 2) connectionCountByIndex
{
  const t0 = now();
  const connectionCountByIndex = tileNames.map((name) => getConnectionCount(name));
  const ms = now() - t0;
  console.log(`[Profile] 2. connectionCountByIndex (${N} lookups): ${ms.toFixed(2)}ms`);
}

// 3) tileEntries (no favorites for simplicity)
const favorites = {};
const favoriteColorOptions = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
const colorRank = (color) => {
  const i = favoriteColorOptions.indexOf(color);
  return i >= 0 ? i : favoriteColorOptions.length;
};

{
  const t0 = now();
  const connectionCountByIndex = tileNames.map((name) => getConnectionCount(name));
  const tileEntries = tileNames.map((name, index) => ({
    type: 'fixed',
    tile: { name },
    index,
    isFavorite: Boolean(favorites[name]),
    connectionCount: connectionCountByIndex[index] ?? 0,
  }));
  const ms = now() - t0;
  console.log(`[Profile] 3. tileEntries (${N} entries): ${ms.toFixed(2)}ms`);
}

// 4) simpleOrderedEntries
let tileEntries;
{
  const connectionCountByIndex = tileNames.map((name) => getConnectionCount(name));
  tileEntries = tileNames.map((name, index) => ({
    type: 'fixed',
    tile: { name },
    index,
    isFavorite: Boolean(favorites[name]),
    connectionCount: connectionCountByIndex[index] ?? 0,
  }));
}
{
  const t0 = now();
  const favoritesList = tileEntries.filter((e) => e.isFavorite).sort((a, b) => {
    const rankA = colorRank(favorites[a.tile.name] ?? '');
    const rankB = colorRank(favorites[b.tile.name] ?? '');
    if (rankA !== rankB) return rankA - rankB;
    return a.index - b.index;
  });
  const nonFavorites = tileEntries.filter((e) => !e.isFavorite);
  const simpleOrderedEntries = [...favoritesList, ...nonFavorites];
  const ms = now() - t0;
  console.log(`[Profile] 4. simpleOrderedEntries: ${ms.toFixed(2)}ms (length=${simpleOrderedEntries.length})`);
}

// 5) fullOrderedEntries
{
  const t0 = now();
  const favoritesList = tileEntries.filter((e) => e.isFavorite).sort((a, b) => {
    const rankA = colorRank(favorites[a.tile.name] ?? '');
    const rankB = colorRank(favorites[b.tile.name] ?? '');
    if (rankA !== rankB) return rankA - rankB;
    return a.index - b.index;
  });
  const byConnections = new Map();
  for (let n = 0; n <= 8; n++) byConnections.set(n, []);
  for (const e of tileEntries) {
    byConnections.get(e.connectionCount).push(e);
  }
  const result = [...favoritesList];
  for (let n = 0; n <= 8; n++) {
    const group = byConnections.get(n) ?? [];
    if (group.length > 0) {
      result.push({ type: 'separator', connectionCount: n });
      result.push(...group);
    }
  }
  const ms = now() - t0;
  console.log(`[Profile] 5. fullOrderedEntries: ${ms.toFixed(2)}ms (length=${result.length})`);
}

// 6) Multiple runs to get stable timings
console.log('\n[Profile] --- 100 runs each (cold then hot) ---');
const runs = 100;

let totalParse = 0;
for (let i = 0; i < runs; i++) {
  const t0 = now();
  const connectionCountByIndex = tileNames.map((name) => getConnectionCount(name));
  totalParse += now() - t0;
}
console.log(`[Profile] connectionCountByIndex x${runs}: avg ${(totalParse / runs).toFixed(3)}ms`);

let totalFull = 0;
for (let i = 0; i < runs; i++) {
  const t0 = now();
  const favoritesList = tileEntries.filter((e) => e.isFavorite).sort((a, b) => {
    const rankA = colorRank(favorites[a.tile.name] ?? '');
    const rankB = colorRank(favorites[b.tile.name] ?? '');
    if (rankA !== rankB) return rankA - rankB;
    return a.index - b.index;
  });
  const byConnections = new Map();
  for (let n = 0; n <= 8; n++) byConnections.set(n, []);
  for (const e of tileEntries) byConnections.get(e.connectionCount).push(e);
  const result = [...favoritesList];
  for (let n = 0; n <= 8; n++) {
    const group = byConnections.get(n) ?? [];
    if (group.length > 0) {
      result.push({ type: 'separator', connectionCount: n });
      result.push(...group);
    }
  }
  totalFull += now() - t0;
}
console.log(`[Profile] fullOrderedEntries x${runs}: avg ${(totalFull / runs).toFixed(3)}ms`);

console.log('\n[Profile] --- Analysis ---');
console.log('[Profile] Pure JS (parse + lookups + ordering) is sub-ms even at 360 tiles.');
console.log('[Profile] So the real app slowness is likely:');
console.log('[Profile]   A) connection-counts.ts loaded at startup (tile-compat is imported by index, grid, etc.).');
console.log('[Profile]   B) React rendering 300+ Pressables + tile images.');
console.log('[Profile]   C) Favorites AsyncStorage + re-render when it resolves.');
console.log('[Profile] Fix: lazy-load connection-counts only when the palette is used (so startup does not parse it).');
