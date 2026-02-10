import { usePathname, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';

const FILES_ROUTE = '/';
const TILE_SETS_ROUTE = '/tileSetCreator';

function isFilesRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === FILES_ROUTE;
}

function isTileSetsRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === TILE_SETS_ROUTE;
}

export function DesktopNavTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const isMobileWeb = useIsMobileWeb();

  if (Platform.OS !== 'web' || isMobileWeb) {
    return null;
  }

  const filesActive = isFilesRoute(pathname);
  const tileSetsActive = isTileSetsRoute(pathname);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => !filesActive && router.replace(FILES_ROUTE)}
        style={styles.tab}
        accessibilityRole="tab"
        accessibilityLabel="Files"
        accessibilityState={{ selected: filesActive }}
      >
        <ThemedText
          type="title"
          style={[styles.tabLabel, filesActive && styles.tabLabelActive]}
        >
          Files
        </ThemedText>
      </Pressable>
      <ThemedText type="default" style={styles.separator}>
        {' '}
        |{' '}
      </ThemedText>
      <Pressable
        onPress={() => !tileSetsActive && router.replace(TILE_SETS_ROUTE)}
        style={styles.tab}
        accessibilityRole="tab"
        accessibilityLabel="Tile Sets"
        accessibilityState={{ selected: tileSetsActive }}
      >
        <ThemedText
          type="title"
          style={[styles.tabLabel, tileSetsActive && styles.tabLabelActive]}
        >
          Tile Sets
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tab: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  tabLabel: {
    color: '#6b7280',
  },
  tabLabelActive: {
    color: '#fff',
  },
  separator: {
    color: '#6b7280',
    paddingHorizontal: 2,
    fontWeight: '300',
    fontSize: 24,
    marginBottom: 6,
  },
});
