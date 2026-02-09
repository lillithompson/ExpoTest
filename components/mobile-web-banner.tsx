import { StyleSheet, Text, View } from 'react-native';

import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';

const BANNER_MESSAGE = 'Mobile web partially supported. Use a desktop browser';

export function MobileWebBanner() {
  const isMobileWeb = useIsMobileWeb();

  if (!isMobileWeb) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{BANNER_MESSAGE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#facc15',
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#1f1f1f',
    fontSize: 14,
    fontWeight: '500',
  },
});
