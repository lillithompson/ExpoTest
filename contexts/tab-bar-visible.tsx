import { createContext, useContext } from 'react';

export const TAB_BAR_HEIGHT = 48;

type TabBarVisibleContextValue = {
  tabBarVisible: boolean;
};

const TabBarVisibleContext = createContext<TabBarVisibleContextValue>({
  tabBarVisible: false,
});

export function TabBarVisibleProvider({
  children,
  tabBarVisible,
}: {
  children: React.ReactNode;
  tabBarVisible: boolean;
}) {
  return (
    <TabBarVisibleContext.Provider value={{ tabBarVisible }}>
      {children}
    </TabBarVisibleContext.Provider>
  );
}

export function useTabBarVisible(): TabBarVisibleContextValue {
  return useContext(TabBarVisibleContext);
}
