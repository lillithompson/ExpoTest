import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import 'react-native-reanimated';

import { MobileTabBar } from '@/components/mobile-tab-bar';
import { TabBarVisibleProvider } from '@/contexts/tab-bar-visible';
import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';

function useShowMobileTabBar(): boolean {
  const isMobileWeb = useIsMobileWeb();
  return Platform.OS === 'ios' || isMobileWeb;
}

export default function RootLayout() {
  const showMobileTabBar = useShowMobileTabBar();
  const [hideTabBarOverModify, setHideTabBarOverModify] = useState(false);

  return (
    <ThemeProvider value={DefaultTheme}>
      <TabBarVisibleProvider
        tabBarVisible={showMobileTabBar}
        hideTabBarOverModify={hideTabBarOverModify}
        setHideTabBarOverModify={setHideTabBarOverModify}
      >
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="tileSetCreator/index" options={{ headerShown: false }} />
              <Stack.Screen name="tileSetCreator/editor" options={{ headerShown: false }} />
              <Stack.Screen name="tileSetCreator/modifyTile" options={{ headerShown: false }} />
              <Stack.Screen name="manual" options={{ title: 'Manual' }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
            </Stack>
          </View>
          {showMobileTabBar && (
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <MobileTabBar />
            </View>
          )}
        </View>
      </TabBarVisibleProvider>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
