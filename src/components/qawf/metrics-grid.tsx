"use client";

import { useState } from "react";
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
  { key: "rmssd", i18nKey: "metrics.rmssd", minGate: 20,  accentFrom: "#818cf8", accentTo: "#a78bfa", format: (v) => `${v.toFixed(1)}` },
  { key: "lfhf",  i18nKey: "metrics.lfhf",  minGate: 60,  accentFrom: "#6c63ff", accentTo: "#818cf8", format: (v) => `${v.toFixed(2)}` },
  { key: "si",    i18nKey: "metrics.si",    minGate: 60,  accentFrom: "#fbbf24", accentTo: "#fcd34d", format: (v) => `${v.toFixed(1)}` },
  { key: "fi",    i18nKey: "metrics.fi",    minGate: 20,  isHeuristic: true,     accentFrom: "#fb923c", accentTo: "#fbbf24", format: (v) => `${Math.round(v)}` },
  { key: "mwi",   i18nKey: "metrics.mwi",   minGate: 20,  isHeuristic: true,     accentFrom: "#c084fc", accentTo: "#e879f9", format: (v) => `${Math.round(v)}` },
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
  const [flipped, setFlipped] = useState(false);

  const gated = elapsed < cfg.minGate;
  const remaining = Math.max(0, Math.ceil(cfg.minGate - elapsed));
  const hasValue = value !== null && (!gated || !isActive);

  const desc = t(`${cfg.i18nKey}.desc`, { defaultValue: "" });

  return (
    <div
      className="relative"
      style={{ perspective: "600px", minHeight: "88px" }}
    >
      {/* ── flip container ── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          minHeight: "88px",
          transformStyle: "preserve-3d",
          transition: "transform 380ms cubic-bezier(0.4,0,0.2,1)",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* ───── FRONT ───── */}
        <div
          className="absolute inset-0 flex flex-col p-3 rounded-xl overflow-hidden"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(108,99,255,0.14)",
            backdropFilter: "blur(8px)",
            boxShadow: hasValue ? `0 0 20px rgba(108,99,255,0.08)` : "none",
            transition: "box-shadow 400ms ease",
          }}
        >
          {/* Top gradient bar */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
            style={{
              background: hasValue
                ? `linear-gradient(90deg, ${cfg.accentFrom}, ${cfg.accentTo})`
                : "rgba(108,99,255,0.12)",
              transition: "background 400ms ease",
            }}
          />

          <div className="flex flex-col gap-0.5 mt-0.5 flex-1">
            {/* Abbr + badge + info button */}
            <div className="flex items-center gap-1">
              <span
                className="text-[9px] font-bold tracking-widest uppercase flex-1"
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
              {/* ⓘ info button — only show when desc exists */}
              {desc && (
                <button
                  onClick={() => setFlipped(true)}
                  aria-label="查看指标说明"
                  className="flex items-center justify-center w-4 h-4 rounded-full transition-all duration-200"
                  style={{
                    background: "rgba(108,99,255,0.10)",
                    border: "1px solid rgba(108,99,255,0.22)",
                    color: "rgba(129,140,248,0.6)",
                    fontSize: "9px",
                    lineHeight: 1,
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(108,99,255,0.22)";
                    (e.currentTarget as HTMLButtonElement).style.color = "#818cf8";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(108,99,255,0.10)";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(129,140,248,0.6)";
                  }}
                >
                  ⓘ
                </button>
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

        {/* ───── BACK ───── */}
        <div
          className="absolute inset-0 flex flex-col p-3 rounded-xl overflow-hidden"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: "rgba(14,12,40,0.92)",
            border: `1px solid ${cfg.accentFrom}44`,
            backdropFilter: "blur(12px)",
            boxShadow: `0 0 24px ${cfg.accentFrom}1a`,
          }}
        >
          {/* Top accent bar */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px] rounded-t-xl"
            style={{ background: `linear-gradient(90deg, ${cfg.accentFrom}, ${cfg.accentTo})` }}
          />

          {/* Close button */}
          <button
            onClick={() => setFlipped(false)}
            aria-label="返回"
            className="absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full transition-all duration-200"
            style={{
              background: "rgba(108,99,255,0.12)",
              border: "1px solid rgba(108,99,255,0.2)",
              color: "rgba(129,140,248,0.7)",
              fontSize: "10px",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(108,99,255,0.25)";
              (e.currentTarget as HTMLButtonElement).style.color = "#a5b4fc";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(108,99,255,0.12)";
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(129,140,248,0.7)";
            }}
          >
            ✕
          </button>

          {/* Abbr */}
          <span
            className="text-[9px] font-bold tracking-widest uppercase mb-1.5"
            style={{
              fontFamily: "var(--font-barlow)",
              background: `linear-gradient(90deg, ${cfg.accentFrom}, ${cfg.accentTo})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t(`${cfg.i18nKey}.abbr`)}
          </span>

          {/* Description text — use wrapper+scale to bypass browser 12px min-font */}
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            <p
              style={{
                fontSize: "12px",
                lineHeight: "1.55",
                color: "rgba(226,228,240,0.72)",
                fontFamily: "var(--font-barlow)",
                transform: "scale(0.8)",
                transformOrigin: "top left",
                width: "125%",   /* compensate for 0.8 scale so text doesn't clip */
                margin: 0,
              }}
            >
              {desc}
            </p>
          </div>
        </div>
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
