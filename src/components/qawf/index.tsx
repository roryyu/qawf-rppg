"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRppg } from "@/lib/rppg/use-rppg";
import { CameraPanel } from "@/components/qawf/camera-panel";
import { MetricsGrid } from "@/components/qawf/metrics-grid";
import { WaveformCanvas } from "@/components/qawf/waveform-canvas";
import { DisclaimerBanner } from "@/components/qawf/disclaimer-banner";
import { LocaleToggle } from "@/components/qawf/locale-toggle";
import { TipsModal } from "@/components/qawf/tips-modal";
import type { Metrics8 } from "@/lib/rppg/rppg-worker";

/** Returns true only when all 8 metrics have a numeric value */
/**
 * 判定「8项指标已就绪」，可以展示生成 Tips 按钮。
 * lfhf 不计入必要条件（它仍需 60s+ 且 IBI 数量够，可能较晚出值）；
 * fi / mwi 已有降级路径，rmssd 有值时它们就会出值。
 */
function allMetricsReady(m: Metrics8 | null): m is Metrics8 {
  if (!m) return false;
  return (
    m.hr    !== null &&
    m.rr    !== null &&
    m.spo2  !== null &&
    m.rmssd !== null &&
    m.si    !== null &&
    m.fi    !== null &&
    m.mwi   !== null
  );
}

export function QawfScreen() {
  const { t } = useTranslation();
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const { state, start, stop } = useRppg(videoRef);

  const [showTips, setShowTips] = useState(false);

  const isActive  = state.status === "measuring" || state.status === "detecting";
  const canStart  = state.status === "idle" || state.status === "done" || state.status === "error";
  const metricsOK = allMetricsReady(state.metrics);

  function handleGenerateTips() {
    // Stop data collection first, then open modal
    if (isActive) stop();
    setShowTips(true);
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "#07071a", color: "#e2e4f0" }}>

      {/* ── Header ── */}
      <header
        className="shrink-0 flex items-center justify-between px-4 py-2.5"
        style={{
          background: "rgba(10,10,30,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(108,99,255,0.18)",
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg,#6c63ff 0%,#38bdf8 100%)",
              boxShadow: "0 0 12px rgba(108,99,255,0.5)",
            }}
          >
            <span className="text-[9px] font-bold text-white tracking-tight" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              LOOK
            </span>
          </div>
          <span
            className="text-sm font-bold tracking-[0.15em] uppercase"
            style={{
              fontFamily: "var(--font-barlow)",
              background: "linear-gradient(90deg,#818cf8,#38bdf8)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            看看你自己
          </span>
          <span
            className="hidden sm:inline text-[9px] px-1.5 py-0.5 rounded font-bold tracking-widest"
            style={{
              fontFamily: "var(--font-ibm-plex-mono)",
              background: "rgba(56,189,248,0.12)",
              color: "#38bdf8",
              border: "1px solid rgba(56,189,248,0.25)",
            }}
          >
            Beta
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <LocaleToggle />
          {canStart ? (
            <button
              onClick={start}
              className="text-[11px] font-bold px-3.5 py-1.5 rounded-lg text-white tracking-wide"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "linear-gradient(135deg,#6c63ff,#38bdf8)",
                boxShadow: "0 0 16px rgba(108,99,255,0.4)",
                letterSpacing: "0.06em",
              }}
            >
              {t("camera.start")}
            </button>
          ) : isActive ? (
            <button
              onClick={stop}
              className="text-[11px] font-bold px-3.5 py-1.5 rounded-lg tracking-wide"
              style={{
                fontFamily: "var(--font-barlow)",
                border: "1px solid rgba(108,99,255,0.4)",
                color: "#818cf8",
                background: "rgba(108,99,255,0.08)",
              }}
            >
              {t("camera.stop")}
            </button>
          ) : null}
        </div>
      </header>

      {/* ── Main — stacked on mobile, split on desktop ── */}
      <main className="flex-1 overflow-hidden flex flex-col md:flex-row">

        {/* Camera — full width on mobile (aspect-video), 40% on desktop */}
        <div
          className="w-full md:w-[40%] md:shrink-0 shrink-0"
          style={{ aspectRatio: "16/9", maxHeight: "40vh" }}
        >
          <style>{`
            @media (min-width: 768px) {
              .camera-wrapper { aspect-ratio: unset !important; max-height: unset !important; height: 100%; }
            }
          `}</style>
          <div
            className="camera-wrapper w-full h-full"
            style={{
              aspectRatio: "16/9",
              maxHeight: "40vh",
              borderRight: "1px solid rgba(108,99,255,0.15)",
            }}
          >
            <CameraPanel
              videoRef={videoRef}
              overlayRef={overlayRef}
              rois={state.rois}
              fps={state.fps}
              confidence={state.confidence}
              elapsed={state.elapsed}
              status={state.status}
            />
          </div>
        </div>

        {/* Data panel */}
        <div className="flex-1 flex flex-col overflow-y-auto" style={{ background: "transparent" }}>

          {/* Waveform strip */}
          <div style={{ borderBottom: "1px solid rgba(108,99,255,0.12)", paddingTop: 6 }}>
            <WaveformCanvas waveform={state.waveform} confidence={state.confidence} height={64} />
          </div>

          {/* Algorithm channel strip */}
          <div
            className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto"
            style={{ borderBottom: "1px solid rgba(108,99,255,0.10)" }}
          >
            {["CHROM", "POS", "PCA", "WIENER", "FUSED"].map((ch, i) => {
              const colors = ["#6c63ff", "#38bdf8", "#a78bfa", "#7dd3fc", "#e0e7ff"];
              return (
                <span
                  key={ch}
                  className="shrink-0 text-[9px] font-bold px-2 py-0.5 rounded"
                  style={{
                    fontFamily: "var(--font-ibm-plex-mono)",
                    background: `${colors[i]}14`,
                    color: colors[i],
                    border: `1px solid ${colors[i]}30`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
            <span
              className="ml-auto shrink-0 text-[9px] font-bold tracking-widest"
              style={{ color: "rgba(129,140,248,0.5)", fontFamily: "var(--font-barlow)" }}
            >
              QA-WF
            </span>
          </div>

          {/* 8-metric grid */}
          <div className="flex-1">
            <MetricsGrid metrics={state.metrics} elapsed={state.elapsed} isActive={isActive} />
          </div>

          {/* ── Generate Tips button — appears when all 8 metrics are ready ── */}
          {metricsOK && (
            <div className="px-3 pb-3 pt-1">
              <button
                onClick={handleGenerateTips}
                className="w-full py-3 rounded-xl font-bold text-sm text-white relative overflow-hidden"
                style={{
                  fontFamily: "var(--font-barlow)",
                  background: "linear-gradient(135deg, #6c63ff 0%, #a78bfa 50%, #38bdf8 100%)",
                  boxShadow: "0 0 28px rgba(108,99,255,0.45), 0 4px 16px rgba(0,0,0,0.3)",
                  letterSpacing: "0.06em",
                  backgroundSize: "200% 200%",
                  animation: "shimmer 3s ease infinite",
                }}
              >
                {/* Shimmer overlay */}
                <span
                  className="absolute inset-0 opacity-20 pointer-events-none"
                  style={{
                    background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%)",
                    animation: "shimmer-slide 2.5s ease-in-out infinite",
                  }}
                />
                <span className="relative z-10">{t("tips.btn")}</span>
              </button>
            </div>
          )}

          {/* Error */}
          {state.status === "error" && state.errorMsg && (
            <div
              className="mx-3 mb-3 px-3 py-2 rounded-xl text-[11px]"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#f87171",
              }}
            >
              {t(`camera.${state.errorMsg}`)}
            </div>
          )}
        </div>
      </main>

      {/* ── Disclaimer ── */}
      <DisclaimerBanner />

      {/* ── Tips Modal ── */}
      {showTips && state.metrics && (
        <TipsModal
          metrics={state.metrics}
          onClose={() => setShowTips(false)}
        />
      )}

      {/* Shimmer animation */}
      <style>{`
        @keyframes shimmer-slide {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(200%);  }
        }
      `}</style>
    </div>
  );
}
