import { createContext, useContext } from 'react';

export const TAB_BAR_HEIGHT = 48;

type TabBarVisibleContextValue = {
  tabBarVisible: boolean;
  hideTabBarOverModify: boolean;
  setHideTabBarOverModify: (hide: boolean) => void;
  hideTabBarOverOverlay: boolean;
  setHideTabBarOverOverlay: (hide: boolean) => void;
};

const TabBarVisibleContext = createContext<TabBarVisibleContextValue>({
  tabBarVisible: false,
  hideTabBarOverModify: false,
  setHideTabBarOverModify: () => {},
  hideTabBarOverOverlay: false,
  setHideTabBarOverOverlay: () => {},
});

export function TabBarVisibleProvider({
  children,
  tabBarVisible,
  hideTabBarOverModify,
  setHideTabBarOverModify,
  hideTabBarOverOverlay,
  setHideTabBarOverOverlay,
}: {
  children: React.ReactNode;
  tabBarVisible: boolean;
  hideTabBarOverModify: boolean;
  setHideTabBarOverModify: (hide: boolean) => void;
  hideTabBarOverOverlay: boolean;
  setHideTabBarOverOverlay: (hide: boolean) => void;
}) {
  return (
    <TabBarVisibleContext.Provider
      value={{
        tabBarVisible,
        hideTabBarOverModify,
        setHideTabBarOverModify,
        hideTabBarOverOverlay,
        setHideTabBarOverOverlay,
      }}
    >
      {children}
    </TabBarVisibleContext.Provider>
  );
}

export function useTabBarVisible(): TabBarVisibleContextValue {
  return useContext(TabBarVisibleContext);
}
