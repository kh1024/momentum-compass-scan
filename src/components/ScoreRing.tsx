export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const color =
    score >= 85 ? "var(--color-buy-now)" :
    score >= 75 ? "var(--color-watch)" :
    score >= 65 ? "var(--color-aggressive)" :
    score >= 50 ? "var(--color-lotto)" :
    "var(--color-avoid)";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-border)" strokeWidth="4" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="4" fill="none"
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <span className="absolute mono text-sm font-bold" style={{ color }}>{score}</span>
    </div>
  );
}
