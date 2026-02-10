import { MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTabBarVisible } from '@/contexts/tab-bar-visible';

const FILES_ROUTE = '/';
const TILE_SETS_ROUTE = '/tileSetCreator';

type TabId = 'files' | 'tileSets';

function isTabBarRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === FILES_ROUTE || normalized === TILE_SETS_ROUTE;
}

function getActiveTab(pathname: string): TabId {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return normalized === TILE_SETS_ROUTE ? 'tileSets' : 'files';
}

export function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hideTabBarOverModify } = useTabBarVisible();

  if (!isTabBarRoute(pathname)) {
    return null;
  }
  const normalized = pathname.replace(/\/$/, '') || '/';
  if (normalized === FILES_ROUTE && hideTabBarOverModify) {
    return null;
  }

  const activeTab = getActiveTab(pathname);

  const onFiles = () => {
    if (activeTab === 'files') return;
    router.replace(FILES_ROUTE);
  };

  const onTileSets = () => {
    if (activeTab === 'tileSets') return;
    router.replace(TILE_SETS_ROUTE);
  };

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, 4),
          paddingTop: 4,
        },
      ]}
    >
      <Pressable
        style={[styles.tab, activeTab === 'files' && styles.tabActive]}
        onPress={onFiles}
        accessibilityRole="tab"
        accessibilityLabel="Files"
        accessibilityState={{ selected: activeTab === 'files' }}
      >
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name="file-document-multiple-outline"
            size={26}
            color={activeTab === 'files' ? '#fff' : '#9ca3af'}
          />
        </View>
        <ThemedText
          type="defaultSemiBold"
          style={[styles.label, activeTab === 'files' && styles.labelActive]}
        >
          Files
        </ThemedText>
      </Pressable>
      <Pressable
        style={[styles.tab, activeTab === 'tileSets' && styles.tabActive]}
        onPress={onTileSets}
        accessibilityRole="tab"
        accessibilityLabel="Tile Sets"
        accessibilityState={{ selected: activeTab === 'tileSets' }}
      >
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name="view-grid-outline"
            size={26}
            color={activeTab === 'tileSets' ? '#fff' : '#9ca3af'}
          />
        </View>
        <ThemedText
          type="defaultSemiBold"
          style={[styles.label, activeTab === 'tileSets' && styles.labelActive]}
        >
          Tile Sets
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(30, 30, 30, 0.98)' : '#1e1e1e',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
    minHeight: 48,
  },
  iconWrap: {
    marginTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
  },
  tabActive: {},
  label: {
    fontSize: 11,
    color: '#9ca3af',
  },
  labelActive: {
    color: '#fff',
  },
});
