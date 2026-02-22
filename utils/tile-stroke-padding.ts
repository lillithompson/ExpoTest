/**
 * Padding so that strokes on tile edges and diagonals are not clipped.
 * For axis-aligned lines, half-stroke (strokeWidth/2) is enough; for diagonals
 * the stroke extends (strokeWidth/2)*sqrt(2) at corners, so we use that.
 */
export function getStrokePadding(strokeWidth: number | undefined): number {
  const w = strokeWidth ?? 0;
  const half = w / 2;
  const diagonalPadding = half * Math.SQRT2;
  return Math.max(1, Math.ceil(diagonalPadding));
}

/**
 * Expand an SVG's viewBox by padding so that when the SVG is rasterized or
 * rendered, strokes on edges/diagonals are not clipped. Content is left in
 * place; only the viewBox is expanded (min minus pad, size plus 2*pad).
 * Returns the modified SVG XML, or the original if padding is 0 or parsing fails.
 */
export function expandSvgViewBoxForStroke(
  xml: string,
  paddingPixels: number,
  tileSizePixels: number
): string {
  if (paddingPixels <= 0 || tileSizePixels <= 0) {
    return xml;
  }
  const cleaned = xml
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .trim();
  const viewBoxMatch = cleaned.match(/viewBox=["']([^"']+)["']/i);
  const widthMatch = cleaned.match(/\bwidth=["']([^"']+)["']/i);
  const heightMatch = cleaned.match(/\bheight=["']([^"']+)["']/i);
  let minX = 0;
  let minY = 0;
  let vbWidth: number;
  let vbHeight: number;
  if (viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1].trim().split(/\s+/).map((p) => Number(p));
    if (parts.length >= 4 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
      minX = parts[0];
      minY = parts[1];
      vbWidth = parts[2];
      vbHeight = parts[3];
    } else if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      vbWidth = parts[0];
      vbHeight = parts[1];
    } else {
      return xml;
    }
  } else if (widthMatch?.[1] && heightMatch?.[1]) {
    vbWidth = parseFloat(widthMatch[1]);
    vbHeight = parseFloat(heightMatch[1]);
    if (!Number.isFinite(vbWidth) || !Number.isFinite(vbHeight) || vbWidth <= 0 || vbHeight <= 0) {
      return xml;
    }
  } else {
    return xml;
  }
  const pad = paddingPixels * (vbWidth / tileSizePixels);
  const newMinX = minX - pad;
  const newMinY = minY - pad;
  const newWidth = vbWidth + 2 * pad;
  const newHeight = vbHeight + 2 * pad;
  const newViewBox = `${newMinX} ${newMinY} ${newWidth} ${newHeight}`;
  const innerMatch = cleaned.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!innerMatch) {
    return xml;
  }
  const attrs = innerMatch[1];
  const inner = innerMatch[2];
  let newAttrs = attrs
    .replace(/viewBox=["'][^"']*["']/gi, `viewBox="${newViewBox}"`)
    .replace(/\bwidth=["'][^"']*["']/gi, '')
    .replace(/\bheight=["'][^"']*["']/gi, '');
  if (!/viewBox=/.test(newAttrs)) {
    newAttrs += ` viewBox="${newViewBox}"`;
  }
  newAttrs += ` width="${newWidth}" height="${newHeight}"`;
  return cleaned.replace(
    /<svg\b[^>]*>[\s\S]*?<\/svg>/i,
    `<svg${newAttrs}>${inner}</svg>`
  );
}
