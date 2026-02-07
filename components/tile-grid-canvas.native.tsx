import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, Circle, Group, ImageSVG, Rect, Skia } from '@shopify/react-native-skia';

import { getSvgXmlWithOverrides } from '@/components/tile-asset';
import { getTransformedConnectionsForName } from '@/utils/tile-compat';
import { type Tile } from '@/utils/tile-grid';
import { type TileSource } from '@/assets/images/tiles/manifest';

type Props = {
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
  /** Called when the canvas has loaded SVGs and painted (so a cached preview can be hidden). */
  onPaintReady?: () => void;
};

type SvgEntry = {
  key: string;
  name: string;
  xml: string;
};

const DOT_SIZE = 6;
export function TileGridCanvas({
  width,
  height,
  tileSize,
  rows,
  columns,
  tiles,
  tileSources,
  errorSource,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
  showDebug,
  showOverlays,
  cloneSourceIndex,
  cloneSampleIndex,
  cloneAnchorIndex,
  cloneCursorIndex,
  onPaintReady,
}: Props) {
  const paintReadyCalledRef = useRef(false);
  const sources = useMemo(() => {
    const entries: Array<{ key: string; name: string; source: unknown; strokeWidth: number }> = [];
    tileSources.forEach((source) => {
      const scale = Math.max(1, strokeScaleByName?.get(source.name) ?? 1);
      entries.push({
        key: source.name,
        name: source.name,
        source: source.source,
        strokeWidth: strokeWidth * scale,
      });
    });
    entries.push({
      key: '__error__',
      name: '__error__',
      source: errorSource,
      strokeWidth: 4,
    });
    return entries;
  }, [tileSources, strokeScaleByName, strokeWidth, errorSource]);
  const sourceByName = useMemo(() => {
    const map = new Map<string, TileSource>();
    tileSources.forEach((source) => {
      if (!map.has(source.name)) {
        map.set(source.name, source);
      }
    });
    return map;
  }, [tileSources]);

  const [svgMap, setSvgMap] = useState<Map<string, ReturnType<typeof Skia.SVG.MakeFromString>>>(
    new Map()
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = new Map<string, ReturnType<typeof Skia.SVG.MakeFromString>>();
      for (const entry of sources) {
        const xml = await getSvgXmlWithOverrides(entry.source, strokeColor, entry.strokeWidth);
        if (!xml) {
          continue;
        }
        const svg = Skia.SVG.MakeFromString(xml);
        if (svg) {
          next.set(entry.key, svg);
        }
      }
      if (!cancelled) {
        setSvgMap(next);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [sources, strokeColor]);

  useEffect(() => {
    if (sources.length === 0) {
      paintReadyCalledRef.current = false;
      return;
    }
    return () => {
      paintReadyCalledRef.current = false;
    };
  }, [sources.length]);

  useEffect(() => {
    if (!onPaintReady || svgMap.size === 0) {
      return;
    }
    if (paintReadyCalledRef.current) {
      return;
    }
    let raf1: number | null = null;
    let raf2: number | null = null;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!paintReadyCalledRef.current) {
          paintReadyCalledRef.current = true;
          onPaintReady();
        }
      });
    });
    return () => {
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [svgMap.size, onPaintReady]);

  const debugConnections = useMemo(() => {
    if (!showDebug) {
      return [] as Array<{ index: number; connections: boolean[] }>;
    }
    const items: Array<{ index: number; connections: boolean[] }> = [];
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (!tile || tile.imageIndex < 0) {
        continue;
      }
      const tileName = tile.name ?? tileSources[tile.imageIndex]?.name ?? '';
      if (!tileName) {
        continue;
      }
      const connections = getTransformedConnectionsForName(
        tileName,
        tile.rotation,
        tile.mirrorX,
        tile.mirrorY
      );
      if (connections) {
        items.push({ index, connections });
      }
    }
    return items;
  }, [showDebug, tiles, tileSources]);

  const overlayRects = useMemo(() => {
    if (!showOverlays) {
      return [] as Array<{ index: number; color: string; alpha: number } >;
    }
    const overlays: Array<{ index: number; color: string; alpha: number }> = [];
    if (cloneSourceIndex !== null) {
      overlays.push({ index: cloneSourceIndex, color: '#2563eb', alpha: 0.4 });
    }
    if (cloneSampleIndex !== null) {
      overlays.push({ index: cloneSampleIndex, color: '#2563eb', alpha: 0.2 });
    }
    if (cloneAnchorIndex !== null) {
      overlays.push({ index: cloneAnchorIndex, color: '#ef4444', alpha: 0.4 });
    }
    if (cloneCursorIndex !== null) {
      overlays.push({ index: cloneCursorIndex, color: '#ef4444', alpha: 0.2 });
    }
    return overlays;
  }, [showOverlays, cloneSourceIndex, cloneSampleIndex, cloneAnchorIndex, cloneCursorIndex]);

  const drawTiles = useMemo(() => {
    const nodes: Array<JSX.Element> = [];
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index];
      if (!tile || tile.imageIndex < 0) {
        if (tile?.imageIndex === -2) {
          const svg = svgMap.get('__error__');
          if (svg) {
            const row = Math.floor(index / columns);
            const col = index % columns;
            const x = col * tileSize;
            const y = row * tileSize;
            nodes.push(
              <ImageSVG
                key={`error-${index}`}
                svg={svg}
                x={x}
                y={y}
                width={tileSize}
                height={tileSize}
              />
            );
          }
        }
        continue;
      }
      const tileName = tile.name ?? tileSources[tile.imageIndex]?.name ?? '';
      const sourceEntry =
        (tileName ? sourceByName.get(tileName) : null) ?? tileSources[tile.imageIndex];
      const svg = sourceEntry ? svgMap.get(sourceEntry.name) : null;
      if (!svg) {
        continue;
      }
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = col * tileSize;
      const y = row * tileSize;
      const cx = x + tileSize / 2;
      const cy = y + tileSize / 2;
      nodes.push(
        <Group
          key={`tile-${index}`}
          transform={[
            { translateX: cx },
            { translateY: cy },
            { rotate: (tile.rotation * Math.PI) / 180 },
            { scaleX: tile.mirrorX ? -1 : 1 },
            { scaleY: tile.mirrorY ? -1 : 1 },
            { translateX: -cx },
            { translateY: -cy },
          ]}
        >
          <ImageSVG svg={svg} x={x} y={y} width={tileSize} height={tileSize} />
        </Group>
      );
    }
    return nodes;
  }, [tiles, tileSources, svgMap, columns, tileSize]);

  const debugDots = useMemo(() => {
    if (!showDebug) {
      return [] as Array<JSX.Element>;
    }
    const dots: Array<JSX.Element> = [];
    debugConnections.forEach(({ index, connections }) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = col * tileSize;
      const y = row * tileSize;
      const positions = [
        { x: x + tileSize / 2, y: y },
        { x: x + tileSize, y: y },
        { x: x + tileSize, y: y + tileSize / 2 },
        { x: x + tileSize, y: y + tileSize },
        { x: x + tileSize / 2, y: y + tileSize },
        { x: x, y: y + tileSize },
        { x: x, y: y + tileSize / 2 },
        { x: x, y: y },
      ];
      connections.forEach((connected, i) => {
        const pos = positions[i];
        dots.push(
          <Circle
            key={`dot-${index}-${i}`}
            cx={pos.x}
            cy={pos.y}
            r={DOT_SIZE / 2}
            color={connected ? '#4ade80' : 'rgba(239,68,68,0.35)'}
          />
        );
      });
    });
    return dots;
  }, [showDebug, debugConnections, columns, tileSize]);

  const overlayNodes = useMemo(() => {
    if (!showOverlays) {
      return [] as Array<JSX.Element>;
    }
    return overlayRects.map((overlay, idx) => {
      const row = Math.floor(overlay.index / columns);
      const col = overlay.index % columns;
      const x = col * tileSize;
      const y = row * tileSize;
      return (
        <Rect
          key={`overlay-${idx}-${overlay.index}`}
          x={x}
          y={y}
          width={tileSize}
          height={tileSize}
          color={overlay.color}
          opacity={overlay.alpha}
        />
      );
    });
  }, [overlayRects, columns, tileSize, showOverlays]);

  return (
    <Canvas style={{ width, height }}>
      {drawTiles}
      {overlayNodes}
      {debugDots}
    </Canvas>
  );
}
