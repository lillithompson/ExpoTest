import { type Tile } from '@/utils/tile-grid';
import { type TileSource } from '@/assets/images/tiles/manifest';

// Web uses the existing React tile grid rendering in app/index.tsx.
// This component is a no-op to keep imports consistent on web.
export function TileGridCanvas(_props: {
  width: number;
  height: number;
  tileSize: number;
  rows: number;
  columns: number;
  tiles: Tile[];
  tileSources: TileSource[];
  errorSource: unknown;
  strokeColor: string;
  strokeWidth: number;
  strokeScaleByName?: Map<string, number>;
  showDebug: boolean;
  showOverlays: boolean;
  cloneSourceIndex: number | null;
  cloneSampleIndex: number | null;
  cloneAnchorIndex: number | null;
  cloneCursorIndex: number | null;
}) {
  return null;
}
