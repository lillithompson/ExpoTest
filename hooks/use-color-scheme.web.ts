/**
 * Web always uses light mode so colors look correct regardless of device dark mode.
 */
export function useColorScheme() {
  return 'light' as const;
}
