import * as FileSystem from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import ViewShot from 'react-native-view-shot';
import { SvgXml } from 'react-native-svg';

const RASTER_DIR = `${FileSystem.cacheDirectory ?? ''}tile-raster/`;

type RasterJob = {
  key: string;
  xml: string;
  size: number;
  resolve: (uri: string) => void;
  reject: (error: Error) => void;
};

const jobQueue: RasterJob[] = [];
const listeners = new Set<() => void>();
const memoryCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const enqueueJob = (job: RasterJob) => {
  jobQueue.push(job);
  notify();
};

const dequeueJob = () => jobQueue.shift() ?? null;

const hashKey = (value: string) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

export const requestSvgRaster = async (key: string, xml: string, size: number) => {
  if (!xml || size <= 0) {
    throw new Error('Invalid raster request');
  }
  const cached = memoryCache.get(key);
  if (cached) {
    return cached;
  }
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const promise = new Promise<string>((resolve, reject) => {
    enqueueJob({ key, xml, size, resolve, reject });
  });
  inflight.set(key, promise);
  return promise;
};

const resolveRasterPath = (key: string) => `${RASTER_DIR}${hashKey(key)}.png`;

export function SvgRasterizerHost() {
  const [job, setJob] = useState<RasterJob | null>(null);
  const viewShotRef = useRef<ViewShot>(null);

  useEffect(() => {
    const handler = () => {
      if (!job) {
        setJob(dequeueJob());
      }
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [job]);

  useEffect(() => {
    if (!job) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        await FileSystem.makeDirectoryAsync(RASTER_DIR, { intermediates: true });
      } catch {
        // ignore
      }
      const target = resolveRasterPath(job.key);
      try {
        const info = await FileSystem.getInfoAsync(target);
        if (info.exists) {
          memoryCache.set(job.key, target);
          inflight.delete(job.key);
          if (!cancelled) {
            job.resolve(target);
            setJob(null);
          }
          return;
        }
      } catch {
        // ignore
      }
      try {
        const uri = await viewShotRef.current?.capture?.({
          format: 'png',
          quality: 1,
          result: 'tmpfile',
          width: job.size,
          height: job.size,
        });
        if (!uri) {
          throw new Error('Raster capture failed');
        }
        try {
          await FileSystem.deleteAsync(target, { idempotent: true });
        } catch {
          // ignore
        }
        await FileSystem.copyAsync({ from: uri, to: target });
        memoryCache.set(job.key, target);
        inflight.delete(job.key);
        if (!cancelled) {
          job.resolve(target);
          setJob(null);
        }
      } catch (error) {
        inflight.delete(job.key);
        if (!cancelled) {
          job.reject(error as Error);
          setJob(null);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [job]);

  const xml = useMemo(() => job?.xml ?? '', [job?.xml]);
  const size = job?.size ?? 0;
  if (!job || size <= 0) {
    return null;
  }

  return (
    <ViewShot
      ref={viewShotRef}
      style={{ position: 'absolute', width: size, height: size, opacity: 0 }}
      options={{ format: 'png', quality: 1, result: 'tmpfile' }}
    >
      <SvgXml xml={xml} width={size} height={size} />
    </ViewShot>
  );
}
