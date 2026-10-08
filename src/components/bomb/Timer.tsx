/** Counts UP the time a flag has sat at 100% — the fuse keeps burning. */
export function Timer({ days, elapsed, armed }: { days: number; elapsed: number; armed: boolean }) {
  const total = days * 86400 + elapsed;
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const p = (n: number) => n.toString().padStart(2, "0");
  return (
    <span className={`font-mono tabular-nums ${armed ? "text-destructive" : "text-muted-foreground"}`}>
      {d}d {p(h)}:{p(m)}
      <span className={armed ? "animate-blink" : ""}>:{p(s)}</span>
    </span>
  );
}
