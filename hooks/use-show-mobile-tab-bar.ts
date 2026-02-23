import { Platform } from 'react-native';

import { useIsMobileWeb } from '@/hooks/use-is-mobile-web';

export function useShowMobileTabBar(): boolean {
  const isMobileWeb = useIsMobileWeb();
  return Platform.OS === 'ios' || isMobileWeb;
}
