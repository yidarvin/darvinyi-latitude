export function SkeletonLine({ width = '100%', height = 14, style }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: 2, ...style }}
    />
  );
}

export function SkeletonBlock({ width = '100%', height = 80, style }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, ...style }}
    />
  );
}
