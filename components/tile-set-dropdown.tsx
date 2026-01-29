import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type Props = {
  categories: string[];
  selected: string;
  onSelect: (category: string) => void;
};

export function TileSetDropdown({ categories, selected, onSelect }: Props) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <ThemedView>
      <Pressable
        onPress={() => setShowMenu((prev) => !prev)}
        style={styles.dropdown}
        accessibilityRole="button"
        accessibilityLabel="Select tile set"
      >
        <ThemedText type="defaultSemiBold">{selected}</ThemedText>
      </Pressable>
      {showMenu && (
        <ThemedView style={styles.menu}>
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => {
                onSelect(category);
                setShowMenu(false);
              }}
              style={styles.menuItem}
            >
              <ThemedText type="defaultSemiBold">{category}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
  },
  menu: {
    borderWidth: 1,
    borderColor: '#1f1f1f',
    borderRadius: 6,
    marginTop: 8,
    overflow: 'hidden',
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
