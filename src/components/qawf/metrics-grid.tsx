"use client";

import { useTranslation } from "react-i18next";
import type { Metrics8 } from "@/lib/rppg/rppg-worker";

type MetricKey = keyof Omit<Metrics8, "confidence">;

interface MetricConfig {
  key: MetricKey;
  i18nKey: string;
  minGate: number;
  isExperimental?: boolean;
  isHeuristic?: boolean;
  format?: (v: number) => string;
  accentFrom: string;
  accentTo: string;
}

const METRICS: MetricConfig[] = [
  { key: "hr",    i18nKey: "metrics.hr",    minGate: 0,   accentFrom: "#f472b6", accentTo: "#fb7185", format: (v) => `${Math.round(v)}` },
  { key: "rr",    i18nKey: "metrics.rr",    minGate: 0,   accentFrom: "#38bdf8", accentTo: "#67e8f9", format: (v) => `${v.toFixed(1)}` },
  { key: "spo2",  i18nKey: "metrics.spo2",  minGate: 0,   isExperimental: true,  accentFrom: "#34d399", accentTo: "#6ee7b7", format: (v) => `${v.toFixed(1)}` },
  { key: "rmssd", i18nKey: "metrics.rmssd", minGate: 30,  accentFrom: "#818cf8", accentTo: "#a78bfa", format: (v) => `${v.toFixed(1)}` },
  { key: "lfhf",  i18nKey: "metrics.lfhf",  minGate: 180, accentFrom: "#6c63ff", accentTo: "#818cf8", format: (v) => `${v.toFixed(2)}` },
  { key: "si",    i18nKey: "metrics.si",    minGate: 120, accentFrom: "#fbbf24", accentTo: "#fcd34d", format: (v) => `${v.toFixed(1)}` },
  { key: "fi",    i18nKey: "metrics.fi",    minGate: 180, isHeuristic: true,     accentFrom: "#fb923c", accentTo: "#fbbf24", format: (v) => `${Math.round(v)}` },
  { key: "mwi",   i18nKey: "metrics.mwi",   minGate: 180, isHeuristic: true,     accentFrom: "#c084fc", accentTo: "#e879f9", format: (v) => `${Math.round(v)}` },
];

// ── Confidence ring ──────────────────────────────────────────────────────────
interface ConfidenceRingProps { confidence: number; size?: number; }
export function ConfidenceRing({ confidence, size = 40 }: ConfidenceRingProps) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, confidence)) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(108,99,255,0.12)" strokeWidth={3} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke="url(#cring)" strokeWidth={3}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 400ms ease" }}
      />
      <defs>
        <linearGradient id="cring" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6c63ff" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Single metric card ───────────────────────────────────────────────────────
interface MetricCardProps {
  cfg: MetricConfig;
  value: number | null;
  elapsed: number;
  isActive: boolean;
}

function MetricCard({ cfg, value, elapsed, isActive }: MetricCardProps) {
  const { t } = useTranslation();
  const gated = elapsed < cfg.minGate;
  const remaining = Math.max(0, Math.ceil(cfg.minGate - elapsed));
  const hasValue = value !== null && (!gated || !isActive);

  return (
    <div
      className="relative flex flex-col p-3 rounded-xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(108,99,255,0.14)",
        backdropFilter: "blur(8px)",
        boxShadow: hasValue ? `0 0 20px rgba(108,99,255,0.08)` : "none",
        transition: "box-shadow 400ms ease",
      }}
    >
      {/* Top gradient bar */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: hasValue
            ? `linear-gradient(90deg, ${cfg.accentFrom}, ${cfg.accentTo})`
            : "rgba(108,99,255,0.12)",
          transition: "background 400ms ease",
        }}
      />

      <div className="flex flex-col gap-0.5 mt-0.5">
        {/* Abbr + badge */}
        <div className="flex items-center gap-1">
          <span
            className="text-[9px] font-bold tracking-widest uppercase"
            style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.6)" }}
          >
            {t(`${cfg.i18nKey}.abbr`)}
          </span>
          {cfg.isExperimental && (
            <span
              className="text-[8px] px-1 rounded font-bold"
              style={{ background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}
            >
              EXP
            </span>
          )}
          {cfg.isHeuristic && (
            <span
              className="text-[8px] px-1 rounded font-bold"
              style={{ background: "rgba(192,132,252,0.12)", color: "#c084fc", border: "1px solid rgba(192,132,252,0.2)" }}
            >
              ~
            </span>
          )}
        </div>

        {/* Value */}
        <div className="flex items-baseline gap-1">
          {gated && isActive ? (
            <span className="text-[11px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "rgba(129,140,248,0.4)" }}>
              {remaining > 0 ? `+${remaining}s` : "--"}
            </span>
          ) : (
            <>
              <span
                className="text-2xl font-bold leading-none"
                style={{
                  fontFamily: "var(--font-ibm-plex-mono)",
                  background: value !== null
                    ? `linear-gradient(135deg, ${cfg.accentFrom}, ${cfg.accentTo})`
                    : "none",
                  WebkitBackgroundClip: value !== null ? "text" : "unset",
                  WebkitTextFillColor: value !== null ? "transparent" : "rgba(129,140,248,0.3)",
                  transition: "all 240ms ease",
                }}
              >
                {value !== null ? (cfg.format ? cfg.format(value) : String(value)) : "--"}
              </span>
              {value !== null && (
                <span
                  className="text-[9px]"
                  style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "rgba(129,140,248,0.5)" }}
                >
                  {t(`${cfg.i18nKey}.unit`)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Label */}
        <span className="text-[10px]" style={{ color: "rgba(226,228,240,0.4)" }}>
          {t(`${cfg.i18nKey}.label`)}
        </span>
      </div>
    </div>
  );
}

// ── Metrics grid ─────────────────────────────────────────────────────────────
interface MetricsGridProps {
  metrics: Metrics8 | null;
  elapsed: number;
  isActive: boolean;
}

export function MetricsGrid({ metrics, elapsed, isActive }: MetricsGridProps) {
  const elapsedSec = elapsed / 1000;
  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {METRICS.map((cfg) => (
        <MetricCard
          key={cfg.key}
          cfg={cfg}
          value={metrics ? (metrics[cfg.key] as number | null) : null}
          elapsed={elapsedSec}
          isActive={isActive}
        />
      ))}
    </div>
  );
}
