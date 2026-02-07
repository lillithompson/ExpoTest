/**
 * Helpers for tile source URIs. Used so UGC file URIs on native bypass
 * the shared SVG cache and always load from disk (avoids wrong-tile display bug).
 */

/**
 * Returns true when the URI is a local file path for a user-generated (UGC) tile
 * under the app's tile-sets directory. On native (non-web), such URIs must never
 * use the shared svgXmlCache/svgOverrideCache so we always read from disk and
 * never show a cached built-in tile for a UGC placement.
 */
export function isUgcTileFileUri(
  uri: string | null,
  platform: string
): boolean {
  if (platform === 'web') {
    return false;
  }
  if (typeof uri !== 'string' || !uri.startsWith('file:')) {
    return false;
  }
  return uri.includes('/tile-sets/');
}
