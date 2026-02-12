/**
 * Load sample file, pattern, and tile set contents for first-time users.
 * Contents are embedded at build time by scripts/embed-sample-assets.js.
 */

import {
  SAMPLE_FILE_CONTENTS,
  SAMPLE_PATTERN_CONTENTS,
  SAMPLE_TILESET_CONTENTS,
} from '@/utils/sample-assets-content';

/** True after we've run the sample-load check once this app session. Survives component unmount. */
let sampleLoadAttemptedThisSession = false;

/**
 * Returns true only the first time per app launch. Use to run sample load only on app load,
 * not after "Delete all local data" (which can unmount/remount and would otherwise re-trigger).
 */
export function shouldLoadSamplesThisSession(): boolean {
  if (sampleLoadAttemptedThisSession) return false;
  sampleLoadAttemptedThisSession = true;
  return true;
}

export async function loadSampleFileContents(): Promise<string[]> {
  return Promise.resolve(SAMPLE_FILE_CONTENTS);
}

export async function loadSamplePatternContents(): Promise<string[]> {
  return Promise.resolve(SAMPLE_PATTERN_CONTENTS);
}

export async function loadSampleTileSetContents(): Promise<string[]> {
  return Promise.resolve(SAMPLE_TILESET_CONTENTS);
}
