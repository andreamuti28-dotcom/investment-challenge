import { useEffect, useState, type ReactNode } from "react";

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = Date.parse(to) - now;
  if (ms <= 0) return <span>closed</span>;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return <span>{d > 0 ? `${d}d ` : ""}{h}h {m}m</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Notice({ kind = "", children }: { kind?: "" | "warn" | "err" | "ok"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`notice ${kind}`} role={kind === "err" ? "alert" : undefined}>{children}</div>;
}

export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value ${className}`}>{value}</div>
    </div>
  );
}

export const Loading = () => <p className="muted">Loading…</p>;
