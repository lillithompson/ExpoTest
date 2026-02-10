import { createContext, useContext } from 'react';

export const TAB_BAR_HEIGHT = 48;

type TabBarVisibleContextValue = {
  tabBarVisible: boolean;
  hideTabBarOverModify: boolean;
  setHideTabBarOverModify: (hide: boolean) => void;
};

const TabBarVisibleContext = createContext<TabBarVisibleContextValue>({
  tabBarVisible: false,
  hideTabBarOverModify: false,
  setHideTabBarOverModify: () => {},
});

export function TabBarVisibleProvider({
  children,
  tabBarVisible,
  hideTabBarOverModify,
  setHideTabBarOverModify,
}: {
  children: React.ReactNode;
  tabBarVisible: boolean;
  hideTabBarOverModify: boolean;
  setHideTabBarOverModify: (hide: boolean) => void;
}) {
  return (
    <TabBarVisibleContext.Provider
      value={{ tabBarVisible, hideTabBarOverModify, setHideTabBarOverModify }}
    >
      {children}
    </TabBarVisibleContext.Provider>
  );
}

export function useTabBarVisible(): TabBarVisibleContextValue {
  return useContext(TabBarVisibleContext);
}
