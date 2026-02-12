import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type AppSettings = {
  preferredTileSize: number;
  showDebug: boolean;
  allowEdgeConnections: boolean;
  mirrorHorizontal: boolean;
  mirrorVertical: boolean;
  backgroundColor: string;
  backgroundLineColor: string;
  backgroundLineWidth: number;
  tileSetCategories?: string[];
  tileSetIds?: string[];
  tileModifyCategories?: string[];
};

const STORAGE_KEY = 'tile-settings-v1';

export const getDefaultSettings = (): AppSettings => ({
  preferredTileSize: 45,
  showDebug: false,
  allowEdgeConnections: true,
  mirrorHorizontal: false,
  mirrorVertical: false,
  backgroundColor: '#050408',
  backgroundLineColor: '#2B2D30',
  backgroundLineWidth: 1,
  tileSetCategories: [],
  tileSetIds: [],
  tileModifyCategories: [],
});

type SetSettings = (updater: AppSettings | ((prev: AppSettings) => AppSettings)) => void;

export const usePersistedSettings = () => {
  const defaults = useMemo(getDefaultSettings, []);
  const [settings, setSettingsState] = useState<AppSettings>(defaults);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          return;
        }
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        if (!isMounted || !parsed) {
          return;
        }
        setSettingsState((prev) => ({
          ...prev,
          ...parsed,
          allowEdgeConnections:
            typeof parsed.allowEdgeConnections === 'boolean'
              ? parsed.allowEdgeConnections
              : true,
        }));
      } catch (error) {
        console.warn('Failed to load settings', error);
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const persist = useCallback(async (next: AppSettings) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Failed to save settings', error);
    }
  }, []);

  const setSettings: SetSettings = useCallback(
    (updater) => {
      setSettingsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const reload = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (!parsed) return;
      setSettingsState((prev) => ({
        ...prev,
        ...parsed,
        allowEdgeConnections:
          typeof parsed.allowEdgeConnections === 'boolean'
            ? parsed.allowEdgeConnections
            : true,
      }));
    } catch (error) {
      console.warn('Failed to reload settings', error);
    }
  }, []);

  return { settings, setSettings, reload };
};
