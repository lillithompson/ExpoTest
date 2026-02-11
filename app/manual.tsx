import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useThemeColor } from '@/hooks/use-theme-color';

const ICON_SIZE = 28;
const ICON_COLOR = 'rgba(42, 42, 42, 0.9)';

function ToolRow({
  icon,
  label,
  description,
}: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  description: string;
}) {
  const color = useThemeColor({ light: '#374151', dark: '#9CA3AF' }, 'text');
  return (
    <View style={toolRowStyles.toolRow}>
      <View style={toolRowStyles.toolIconWrap}>
        <MaterialCommunityIcons name={icon} size={ICON_SIZE} color={color} />
      </View>
      <View style={toolRowStyles.toolTextWrap}>
        <ThemedText type="defaultSemiBold">{label}</ThemedText>
        <ThemedText type="default" style={toolRowStyles.toolDesc}>{description}</ThemedText>
      </View>
    </View>
  );
}

const toolRowStyles = StyleSheet.create({
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  toolIconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  toolTextWrap: { flex: 1 },
  toolDesc: { marginTop: 2 },
});

export default function ManualScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ThemedView style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText type="title">Manual</ThemedText>
        <Pressable
          onPress={() => router.back()}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel="Close manual"
        >
          <ThemedText type="defaultSemiBold">Close</ThemedText>
        </Pressable>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator
      >
        <ThemedText type="default" style={styles.intro}>
          Welcome! This app lets you create and edit tile-based designs. You can work with files (full tile canvases), manage tile sets (collections of tile graphics), and use a variety of brushes and tools to paint and edit.
        </ThemedText>

        <ThemedText type="subtitle" style={styles.sectionTitle}>Views</ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>File view</ThemedText>
        <ThemedText type="default" style={styles.para}>
          The File view is your home screen. It shows all your saved designs as a grid of cards. Tap a card to open that design in the Modify view. Long press a card for the file options menu: Download, Download SVG (web), Duplicate, or Delete. New File (＋) creates a new design (you choose a tile size 25–200 px). Select Mode lets you select multiple files to delete. Settings (gear) opens app settings. The File title at the top is tappable and takes you to the Tile Sets area.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Modify view</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Where you edit a single design. &lt; Modify (top left) saves and returns to the File view. The toolbar has Reset, Flood, Reconcile, and Mirror (cycling button). The brush panel at the bottom shows the tile palette and brush modes: Random, palette tiles, Clone, Erase, and Pattern. Double tap or long press the Random tile to open the Tile Set chooser. Settings (gear) opens Modify-view settings including Download PNG.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Tile Sets list</ThemedText>
        <ThemedText type="default" style={styles.para}>
          From File view, tap File to open the Tile Sets list. Tap a tile set card to open it in the Tile Set Editor. Long press (on web) for download. Create starts a new tile set (name + resolution 2, 3, or 4). Select Mode lets you delete multiple sets. Tap the Tile Sets title to go back to the File view.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Tile Set Editor</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Inside a tile set you see all its tiles. Tap a tile to open the Modify Tile view and edit that tile’s graphic. Add Tile adds a new tile. Select Mode lets you delete (or duplicate/download on web) multiple tiles. Settings lets you rename the tile set.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Modify Tile view</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Single-tile editor. Same toolbar and brush panel as the main Modify view. Changes are part of the tile set; go back to the Tile Set Editor when done.
        </ThemedText>

        <ThemedText type="subtitle" style={styles.sectionTitle}>Tools</ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Toolbar (Modify and Modify Tile)</ThemedText>
        <ThemedText type="default" style={styles.para}>
          The toolbar at the top of the canvas uses these icons:
        </ThemedText>
        <ToolRow
          icon="refresh"
          label="Reset"
          description="Clears the entire grid (or whole tile in Modify Tile)."
        />
        <ToolRow
          icon="format-color-fill"
          label="Flood"
          description="Tap: fills the whole grid with the current brush. Long press: Flood Complete — fills only empty cells."
        />
        <ToolRow
          icon="puzzle"
          label="Reconcile"
          description="Tap: fixes invalid tile connections. Long press: Controlled Randomize."
        />
        <ToolRow
          icon="flip-horizontal"
          label="Mirror"
          description="Tap to cycle: off → horizontal → horizontal + vertical → vertical → off. Icon is blue when any mirroring is on (matches guide lines); guide lines show axes."
        />

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Brush panel</ThemedText>
        <ThemedText type="default" style={styles.para}>
          The strip at the bottom shows the tile palette and these brush modes (same icons as in the app):
        </ThemedText>
        <ToolRow
          icon="dice-multiple"
          label="Random"
          description="Tap to place a random compatible tile. Double tap or long press to open the Tile Set chooser."
        />
        <ThemedText type="default" style={styles.para}>
          Palette tiles — Tap to select, then tap on the grid to place. Double tap a palette tile to cycle rotation and mirror; long press to add/remove from Favorites.
        </ThemedText>
        <ToolRow
          icon="content-copy"
          label="Clone"
          description="Tap a cell to set the source, then tap or drag elsewhere to paint a copy. Long press on the grid to set a new clone source."
        />
        <ToolRow
          icon="eraser"
          label="Erase"
          description="Tap a cell to clear it. Flood with Erase selected clears the whole grid."
        />
        <ToolRow
          icon="view-grid"
          label="Pattern"
          description="Long press or double tap to open the pattern picker; create, select, or manage patterns. Pattern can use mirror and 90° rotation in the picker."
        />

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Pattern creation</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Enter pattern mode and drag on the grid to select a region. Save stores the pattern in the chosen category; Cancel exits without saving. Saved patterns appear in the pattern picker.
        </ThemedText>

        <ThemedText type="defaultSemiBold" style={styles.subsection}>Tile Set chooser</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Opened by double tap or long press on the Random brush. At the top: Allow Border Connections — when on, tiles at the grid edge can use connections as if they had neighbors; when off, edges behave as empty. Shows built-in categories and your user tile sets. Select one or more to define the active palette. Selected items have a green border. Confirm to update the palette.
        </ThemedText>

        <ThemedText type="subtitle" style={styles.sectionTitle}>Settings</ThemedText>
        <ThemedText type="default" style={styles.para}>
          View manual — Opens this manual. Show Debug — shows a debug overlay on the grid. Download PNG (Modify view only) — downloads the current canvas. Background Color, Background Line Color, Line Width — customize the grid look. Delete all local data — permanently deletes all files, tile sets, patterns, and favorites and resets all settings to their defaults (with confirmation). Settings are saved automatically.
        </ThemedText>

        <ThemedText type="subtitle" style={styles.sectionTitle}>Tips</ThemedText>
        <ThemedText type="default" style={styles.para}>
          Your work is auto-saved while you edit. Favorites keep your most-used tiles at the front of the palette. Use Reconcile after big changes if you see error or broken connections. Use Flood Complete (long press Flood) to fill only empty cells. On web, you can download a file as PNG or SVG from the file options (long press) or from Modify-view Settings.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  close: {
    padding: 8,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  intro: {
    marginBottom: 20,
  },
  sectionTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  subsection: {
    marginTop: 12,
    marginBottom: 4,
  },
  para: {
    marginBottom: 8,
  },
});
