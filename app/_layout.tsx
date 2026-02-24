import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import 'react-native-reanimated';

import { TabBarVisibleProvider } from '@/contexts/tab-bar-visible';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.style.colorScheme = 'light';
    }
  }, []);

  return (
    <ThemeProvider value={DefaultTheme}>
      <TabBarVisibleProvider
        tabBarVisible={false}
        hideTabBarOverModify={false}
        setHideTabBarOverModify={() => {}}
        hideTabBarOverOverlay={false}
        setHideTabBarOverOverlay={() => {}}
      >
        <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/index" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/editor" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/modifyTile" options={{ headerShown: false }} />
            <Stack.Screen name="manual" options={{ title: 'Manual' }} />
          </Stack>
        </View>
      </TabBarVisibleProvider>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
