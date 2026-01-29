import { StyleSheet, View } from 'react-native';

type Props = {
  connections: boolean[] | null;
};

export function TileDebugOverlay({ connections }: Props) {
  if (!connections) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.container}>
      {connections.map((connected, index) => (
        <View
          key={`conn-${index}`}
          style={[styles.dot, styles.positions[index], connected ? styles.on : styles.off]}
        />
      ))}
    </View>
  );
}

const DOT_SIZE = 6;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginLeft: 0,
    marginTop: 0,
  },
  on: {
    backgroundColor: '#4ade80',
  },
  off: {
    backgroundColor: '#ef4444',
    opacity: 0.35,
  },
  positions: [
    { left: '50%', top: 0, transform: [{ translateX: -DOT_SIZE / 2 }] }, // N
    {
      left: '100%',
      top: 0,
      transform: [{ translateX: -DOT_SIZE }, { translateY: -DOT_SIZE / 2 }],
    }, // NE
    {
      left: '100%',
      top: '50%',
      transform: [{ translateX: -DOT_SIZE }, { translateY: -DOT_SIZE / 2 }],
    }, // E
    {
      left: '100%',
      top: '100%',
      transform: [{ translateX: -DOT_SIZE }, { translateY: -DOT_SIZE }],
    }, // SE
    {
      left: '50%',
      top: '100%',
      transform: [{ translateX: -DOT_SIZE / 2 }, { translateY: -DOT_SIZE }],
    }, // S
    {
      left: 0,
      top: '100%',
      transform: [{ translateX: -DOT_SIZE / 2 }, { translateY: -DOT_SIZE }],
    }, // SW
    {
      left: 0,
      top: '50%',
      transform: [{ translateX: -DOT_SIZE / 2 }, { translateY: -DOT_SIZE / 2 }],
    }, // W
    {
      left: 0,
      top: 0,
      transform: [{ translateX: -DOT_SIZE / 2 }, { translateY: -DOT_SIZE / 2 }],
    }, // NW
  ],
});
