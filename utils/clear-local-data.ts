import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage keys for tile files (must match use-tile-files). */
const FILES_KEY = 'tile-files-v1';
const ACTIVE_KEY = 'tile-files-active-v1';
/** AsyncStorage keys for tile sets (must match use-tile-sets). */
const TILE_SETS_KEY = 'tile-sets-v1';
const TILE_SETS_BAKES_KEY = 'tile-sets-bakes-v1';
/** AsyncStorage key for brush favorites (must match tile-brush-panel). */
const FAVORITES_KEY = 'tile-brush-favorites-v1';
/** AsyncStorage key for patterns (must match use-tile-patterns). */
const PATTERNS_KEY = 'tile-patterns-v1';

/**
 * Removes all local data from AsyncStorage: saved files, tile sets (and bakes), favorites, and patterns.
 * Callers should then reset in-memory state (e.g. clearAllFiles, reloadTileSets, clearFavorites, clearAllPatterns).
 */
export async function clearAllLocalData(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(FILES_KEY),
    AsyncStorage.removeItem(ACTIVE_KEY),
    AsyncStorage.removeItem(TILE_SETS_KEY),
    AsyncStorage.removeItem(TILE_SETS_BAKES_KEY),
    AsyncStorage.removeItem(FAVORITES_KEY),
    AsyncStorage.removeItem(PATTERNS_KEY),
  ]);
}
