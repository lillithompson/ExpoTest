/**
 * Parse UGC baked tile filenames so we can resolve "legacy" names (old timestamp)
 * to the current baked source for the same tile (setId + tileId).
 * Used when a file was saved with an old baked name (e.g. due to timing) and
 * we need to resolve it to the current baked asset.
 */

export type ParsedBakedName = { tileId: string; bits: string };

/**
 * Parses a baked name (with or without setId prefix).
 * Handles: "tileId_timestamp_bits.svg" and "tileId_bits.svg".
 */
export function parseBakedName(name: string): ParsedBakedName | null {
  const legacy = name.includes(':') ? name.split(':').slice(1).join(':') : name;
  const matchWithTimestamp = legacy.match(/^(.*)_\d+_([01]{8})\.svg$/);
  if (matchWithTimestamp) {
    return { tileId: matchWithTimestamp[1], bits: matchWithTimestamp[2] };
  }
  const match = legacy.match(/^(.*)_([01]{8})\.svg$/);
  if (!match) {
    return null;
  }
  return { tileId: match[1], bits: match[2] };
}

/**
 * Returns setId and tileId from a qualified UGC name like "setId:tileId_123_00000000.svg".
 * Use with parseBakedName for the part after the colon.
 */
export function getSetIdAndLegacyFromQualifiedName(
  qualifiedName: string
): { setId: string; legacy: string } | null {
  if (!qualifiedName.includes(':')) {
    return null;
  }
  const colon = qualifiedName.indexOf(':');
  const setId = qualifiedName.slice(0, colon);
  const legacy = qualifiedName.slice(colon + 1);
  return setId && legacy ? { setId, legacy } : null;
}
