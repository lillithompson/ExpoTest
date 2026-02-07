/**
 * Pure helpers for the tile-canvas preview system. Used when opening files,
 * deciding when to show the cached preview image vs the live grid, and when
 * saving preview/thumb paths. Tests in __tests__/preview-state.test.ts
 * guard this behavior so the "cached preview during load" flow stays correct.
 */

export type FileWithPreviewUri = {
  previewUri?: string | null;
  thumbnailUri?: string | null;
};

/** URI to show when opening a file: prefer full preview, fallback to thumbnail. */
export function getFilePreviewUri(file: FileWithPreviewUri | null): string | null {
  if (!file) return null;
  return file.previewUri ?? file.thumbnailUri ?? null;
}

/**
 * Whether the file list should show the cached thumbnail image (not the live grid).
 * True when file has thumbnailUri or previewUri. Used so we always show the cached
 * thumbnail when present (no platform- or tiles-based branching).
 */
export function hasCachedThumbnail(file: FileWithPreviewUri | null): boolean {
  if (!file) return false;
  return Boolean(file.thumbnailUri || file.previewUri);
}

/** Whether we have any preview image to show (from load or from clear capture). */
export function hasPreview(
  loadPreviewUri: string | null,
  clearPreviewUri: string | null
): boolean {
  return Boolean(loadPreviewUri || clearPreviewUri);
}

/**
 * Whether to show the cached preview image. Show when we have a preview and
 * either we're clearing or the live grid is not yet visible.
 */
export function showPreview(
  hasPreviewValue: boolean,
  gridVisible: boolean,
  isClearing: boolean
): boolean {
  return hasPreviewValue && (isClearing || !gridVisible);
}

/**
 * True only when uri is under previewDir. Used before deleting old preview
 * files so we never delete URIs outside our cache directory.
 */
export function isOwnPreviewUri(uri: string, previewDir: string): boolean {
  return uri.startsWith(previewDir);
}

export type PreviewPathKind = 'full' | 'thumb';

/**
 * Builds a unique preview/thumb path so each save gets a new URI and the
 * image cache shows the latest state, not a stale cached image.
 */
export function buildPreviewPath(
  previewDir: string,
  fileId: string,
  kind: PreviewPathKind,
  timestamp: number
): string {
  const suffix = kind === 'full' ? '-full.png' : '-thumb.png';
  return `${previewDir}${fileId}-${timestamp}${suffix}`;
}
