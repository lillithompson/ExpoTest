import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { type TileSource } from '@/assets/images/tiles/manifest';
import { buildTileAtlas, type TileAtlas } from '@/utils/tile-atlas';

const atlasCache = new Map<string, TileAtlas>();
const atlasInflight = new Map<string, Promise<TileAtlas | null>>();

const getSourceUriKey = (source: unknown) => {
  if (typeof source === 'string') {
    return source;
  }
  if ((source as { uri?: string }).uri) {
    return (source as { uri?: string }).uri ?? '';
  }
  return String(source ?? '');
};

const buildAtlasKey = (
  tileSources: TileSource[],
  tileSize: number,
  strokeColor?: string,
  strokeWidth?: number,
  strokeScaleByName?: Map<string, number>
) => {
  if (!tileSources.length || tileSize <= 0) {
    return '';
  }
  const sourcesKey = tileSources
    .map((source) => {
      const uri = getSourceUriKey(source.source);
      const scale = strokeScaleByName?.get(source.name) ?? 1;
      return `${source.name}:${uri}:${scale}`;
    })
    .join('|');
  return `${tileSize}|${strokeColor ?? ''}|${strokeWidth ?? ''}|${sourcesKey}`;
};

export const useTileAtlas = ({
  tileSources,
  tileSize,
  strokeColor,
  strokeWidth,
  strokeScaleByName,
}: {
  tileSources: TileSource[];
  tileSize: number;
  strokeColor?: string;
  strokeWidth?: number;
  strokeScaleByName?: Map<string, number>;
}) => {
  const atlasKey = useMemo(
    () =>
      buildAtlasKey(
        tileSources,
        tileSize,
        strokeColor,
        strokeWidth,
        strokeScaleByName
      ),
    [tileSources, tileSize, strokeColor, strokeWidth, strokeScaleByName]
  );
  const [atlas, setAtlas] = useState<TileAtlas | null>(() =>
    atlasKey ? atlasCache.get(atlasKey) ?? null : null
  );

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setAtlas(null);
      return;
    }
    if (!atlasKey) {
      setAtlas(null);
      return;
    }
    const cached = atlasCache.get(atlasKey);
    if (cached) {
      setAtlas(cached);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const inflight = atlasInflight.get(atlasKey);
      if (inflight) {
        const result = await inflight;
        if (!cancelled) {
          setAtlas(result ?? null);
        }
        return;
      }
      const promise = buildTileAtlas({
        tileSources,
        tileSize,
        strokeColor,
        strokeWidth,
        strokeScaleByName,
      }).then((result) => {
        if (result) {
          atlasCache.set(atlasKey, result);
        }
        atlasInflight.delete(atlasKey);
        return result;
      });
      atlasInflight.set(atlasKey, promise);
      const result = await promise;
      if (!cancelled) {
        setAtlas(result ?? null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [atlasKey, tileSources, tileSize, strokeColor, strokeWidth, strokeScaleByName]);

  return atlas;
};
