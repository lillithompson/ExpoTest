/**
 * Dev-only profiling for tile palette load. In __DEV__, timings are collected and logged after each render.
 * To enable in production build: set window.ENABLE_PALETTE_PROFILE = true before load.
 */
const isProfileEnabled = (): boolean => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (typeof window !== 'undefined' && (window as unknown as { ENABLE_PALETTE_PROFILE?: boolean }).ENABLE_PALETTE_PROFILE) return true;
  return false;
};

export type PaletteProfileTimings = {
  connectionCountByIndexMs: number;
  tileEntriesMs: number;
  simpleOrderedEntriesMs: number;
  fullOrderedEntriesMs: number;
  displayOrderedEntriesMs: number;
  tileCount: number;
  useFullOrder: boolean;
  renderId: number;
};

const timingsBuffer: Partial<PaletteProfileTimings>[] = [];
const MAX_BUFFER = 5;

export function paletteProfileMeasure<T>(label: keyof PaletteProfileTimings, fn: () => T): T {
  if (!isProfileEnabled()) return fn();
  const t0 = performance.now();
  const result = fn();
  const ms = performance.now() - t0;
  const last = timingsBuffer[timingsBuffer.length - 1];
  if (last) (last as Record<string, number>)[label] = ms;
  return result;
}

export function paletteProfileStartRender(tileCount: number, useFullOrder: boolean, renderId: number): void {
  if (!isProfileEnabled()) return;
  while (timingsBuffer.length >= MAX_BUFFER) timingsBuffer.shift();
  timingsBuffer.push({ tileCount, useFullOrder, renderId });
}

export function paletteProfileLog(): void {
  if (!isProfileEnabled() || timingsBuffer.length === 0) return;
  const t = timingsBuffer[timingsBuffer.length - 1] as PaletteProfileTimings;
  const total =
    (t.connectionCountByIndexMs ?? 0) +
    (t.tileEntriesMs ?? 0) +
    (t.simpleOrderedEntriesMs ?? 0) +
    (t.fullOrderedEntriesMs ?? 0) +
    (t.displayOrderedEntriesMs ?? 0);
  console.warn(
    '[PaletteProfile]',
    `tiles=${t.tileCount}`,
    `useFullOrder=${t.useFullOrder}`,
    `renderId=${t.renderId}`,
    '|',
    `connectionCountByIndex=${(t.connectionCountByIndexMs ?? 0).toFixed(2)}ms`,
    `tileEntries=${(t.tileEntriesMs ?? 0).toFixed(2)}ms`,
    `simpleOrder=${(t.simpleOrderedEntriesMs ?? 0).toFixed(2)}ms`,
    `fullOrder=${(t.fullOrderedEntriesMs ?? 0).toFixed(2)}ms`,
    `displayOrder=${(t.displayOrderedEntriesMs ?? 0).toFixed(2)}ms`,
    `| total useMemos≈${total.toFixed(2)}ms`
  );
}

/** Log parent timings (call from index.tsx or wherever paletteSources is built). */
export function paletteProfileLogParent(label: string, ms: number, detail?: string): void {
  if (!isProfileEnabled()) return;
  console.warn(`[PaletteProfile] parent: ${label} ${ms.toFixed(2)}ms${detail ? ` ${detail}` : ''}`);
}
