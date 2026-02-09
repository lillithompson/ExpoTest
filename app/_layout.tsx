import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import 'react-native-reanimated';

import { MobileWebBanner } from '@/components/mobile-web-banner';

export default function RootLayout() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <View style={{ flex: 1 }}>
        <MobileWebBanner />
        <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/index" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/editor" options={{ headerShown: false }} />
            <Stack.Screen name="tileSetCreator/modifyTile" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        </View>
      </View>
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
