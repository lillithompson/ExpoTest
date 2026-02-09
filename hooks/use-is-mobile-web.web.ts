import { useEffect, useState } from 'react';
import { getIsMobileWebForWindow } from '@/utils/is-mobile-web';

export function useIsMobileWeb(): boolean {
  const [isMobileWeb, setIsMobileWeb] = useState(false);

  useEffect(() => {
    const win = typeof window !== 'undefined' ? window : undefined;
    const update = () => setIsMobileWeb(getIsMobileWebForWindow(win));

    update();
    win?.addEventListener('resize', update);
    return () => win?.removeEventListener('resize', update);
  }, []);

  return isMobileWeb;
}
