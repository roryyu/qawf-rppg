"use client";

import { useTranslation } from "react-i18next";
import type { Metrics8 } from "@/lib/rppg/rppg-worker";

// ────────────────────────────────────────────────────────────────────────────
// Metric config
// ────────────────────────────────────────────────────────────────────────────
type MetricKey = keyof Omit<Metrics8, "confidence">;

interface MetricConfig {
  key: MetricKey;
  i18nKey: string;
  minGate: number;   // seconds needed before showing value
  isExperimental?: boolean;
  isHeuristic?: boolean;
  format?: (v: number) => string;
  color?: string;    // accent override
}

const METRICS: MetricConfig[] = [
  { key: "hr",    i18nKey: "metrics.hr",    minGate: 0,   color: "#e05454", format: (v) => `${Math.round(v)}` },
  { key: "rr",    i18nKey: "metrics.rr",    minGate: 0,   format: (v) => `${v.toFixed(1)}` },
  { key: "spo2",  i18nKey: "metrics.spo2",  minGate: 0,   isExperimental: true, format: (v) => `${v.toFixed(1)}` },
  { key: "rmssd", i18nKey: "metrics.rmssd", minGate: 30,  format: (v) => `${v.toFixed(1)}` },
  { key: "lfhf",  i18nKey: "metrics.lfhf",  minGate: 180, format: (v) => `${v.toFixed(2)}` },
  { key: "si",    i18nKey: "metrics.si",    minGate: 120, format: (v) => `${v.toFixed(1)}` },
  { key: "fi",    i18nKey: "metrics.fi",    minGate: 180, isHeuristic: true, format: (v) => `${Math.round(v)}` },
  { key: "mwi",   i18nKey: "metrics.mwi",   minGate: 180, isHeuristic: true, format: (v) => `${Math.round(v)}` },
];

// ────────────────────────────────────────────────────────────────────────────
// Confidence ring (SVG)
// ────────────────────────────────────────────────────────────────────────────
interface ConfidenceRingProps {
  confidence: number; // 0–100
  size?: number;
}

export function ConfidenceRing({ confidence, size = 40 }: ConfidenceRingProps) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, confidence));
  const dash = (pct / 100) * circ;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(33,39,37,.12)" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#3B38EB" strokeWidth={3}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 400ms ease" }}
      />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Single metric card
// ────────────────────────────────────────────────────────────────────────────
interface MetricCardProps {
  cfg: MetricConfig;
  value: number | null;
  elapsed: number; // seconds
  isActive: boolean;
}

function MetricCard({ cfg, value, elapsed, isActive }: MetricCardProps) {
  const { t } = useTranslation();
  const gated = elapsed < cfg.minGate;
  const remaining = Math.max(0, Math.ceil(cfg.minGate - elapsed));
  const accentColor = cfg.color ?? "#3B38EB";

  return (
    <div
      className="relative flex flex-col p-3 rounded-[10px] overflow-hidden"
      style={{
        background: "rgba(233,233,232,0.88)",
        border: "1px solid rgba(33,39,37,.15)",
        boxShadow: "0 8px 24px rgba(33,39,37,.08)",
        transition: "box-shadow 240ms cubic-bezier(.2,.8,.2,1)",
      }}
    >
      {/* Left accent strip */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px]"
        style={{ background: isActive && !gated ? accentColor : "rgba(33,39,37,.12)" }}
      />

      <div className="pl-2 flex flex-col gap-0.5">
        {/* Label row */}
        <div className="flex items-center gap-1">
          <span
            className="text-[10px] font-semibold tracking-wider uppercase"
            style={{ fontFamily: "var(--font-barlow)", color: "#5C6264" }}
          >
            {t(`${cfg.i18nKey}.abbr`)}
          </span>
          {cfg.isExperimental && (
            <span className="text-[9px] px-1 rounded-sm" style={{ background: "#DDDEA1", color: "#212725" }}>
              EXP
            </span>
          )}
          {cfg.isHeuristic && (
            <span className="text-[9px] px-1 rounded-sm" style={{ background: "#DDDEA1", color: "#212725" }}>
              ~
            </span>
          )}
        </div>

        {/* Value */}
        <div className="flex items-baseline gap-1">
          {gated && isActive ? (
            <span className="text-base font-mono text-brand-muted">
              {remaining > 0 ? t("metrics.gating_label", { seconds: remaining }) : t("metrics.pending")}
            </span>
          ) : (
            <>
              <span
                className="text-2xl font-bold leading-none"
                style={{
                  fontFamily: "var(--font-ibm-plex-mono)",
                  color: value !== null ? accentColor : "#5C6264",
                  transition: "color 240ms ease",
                }}
              >
                {value !== null ? (cfg.format ? cfg.format(value) : String(value)) : t("metrics.pending")}
              </span>
              {value !== null && (
                <span className="text-[10px] text-brand-muted" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
                  {t(`${cfg.i18nKey}.unit`)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Full label */}
        <span className="text-[11px]" style={{ color: "#5C6264" }}>
          {t(`${cfg.i18nKey}.label`)}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Metrics grid (8 cards)
// ────────────────────────────────────────────────────────────────────────────
interface MetricsGridProps {
  metrics: Metrics8 | null;
  elapsed: number;  // ms
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
