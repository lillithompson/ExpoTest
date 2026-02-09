import { Platform } from 'react-native';

const MOBILE_WEB_WIDTH_MAX = 768;

/**
 * Returns true when running on web and viewport is narrow or user agent indicates mobile.
 * Used by useIsMobileWeb hook; safe to call with undefined on native.
 */
export function getIsMobileWebForWindow(
  win: { innerWidth: number; navigator: { userAgent: string } } | undefined
): boolean {
  if (Platform.OS !== 'web' || win == null) return false;
  const mobileUa = /Mobile|Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    win.navigator.userAgent
  );
  return win.innerWidth < MOBILE_WEB_WIDTH_MAX || mobileUa;
}
