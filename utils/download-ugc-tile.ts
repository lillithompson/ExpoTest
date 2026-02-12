/**
 * Download or share a UGC file (tile set or pattern).
 * Caller passes the full filename including extension (e.g. TileSet_MySet.tileset, Pattern_0.tilepattern).
 * Web: blob download; native: write to cache and share.
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function downloadUgcTileFile(content: string, fileName: string): Promise<void> {
  const fullName = fileName.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export';
  if (Platform.OS === 'web') {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fullName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } else {
    const target = `${FileSystem.cacheDirectory ?? ''}${fullName}`;
    await FileSystem.writeAsStringAsync(target, content, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(target, { mimeType: 'application/json' });
    }
  }
}
