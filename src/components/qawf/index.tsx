"use client";

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useRppg } from "@/lib/rppg/use-rppg";
import { CameraPanel } from "@/components/qawf/camera-panel";
import { MetricsGrid } from "@/components/qawf/metrics-grid";
import { WaveformCanvas } from "@/components/qawf/waveform-canvas";
import { DisclaimerBanner } from "@/components/qawf/disclaimer-banner";
import { LocaleToggle } from "@/components/qawf/locale-toggle";

export function QawfScreen() {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const { state, start, stop } = useRppg(videoRef);

  const isActive = state.status === "measuring" || state.status === "detecting";
  const canStart = state.status === "idle" || state.status === "done" || state.status === "error";

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: "#E9E9E8", color: "#212725" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{
          borderBottom: "1px solid rgba(33,39,37,.12)",
          background: "#E9E9E8",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Brand mark */}
          <div
            className="w-5 h-5 rounded-sm flex items-center justify-center"
            style={{ background: "#3B38EB" }}
          >
            <span className="text-[8px] font-bold text-white" style={{ fontFamily: "var(--font-ibm-plex-mono)" }}>
              QW
            </span>
          </div>
          <span
            className="text-sm font-semibold tracking-widest uppercase"
            style={{ fontFamily: "var(--font-barlow)", color: "#212725" }}
          >
            QAWF
          </span>
          <span
            className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-sm"
            style={{
              background: "#DDDEA1",
              color: "#212725",
              fontFamily: "var(--font-barlow)",
              letterSpacing: "0.05em",
            }}
          >
            rPPG
          </span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <LocaleToggle />
          {canStart ? (
            <button
              onClick={start}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-[6px] text-white"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "#3B38EB",
                letterSpacing: "0.05em",
                transition: "opacity 200ms ease",
              }}
            >
              {t("camera.start")}
            </button>
          ) : isActive ? (
            <button
              onClick={stop}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-[6px]"
              style={{
                fontFamily: "var(--font-barlow)",
                border: "1px solid rgba(33,39,37,.3)",
                color: "#212725",
              }}
            >
              {t("camera.stop")}
            </button>
          ) : null}
        </div>
      </header>

      {/* ── Main content — split-asymmetric ─────────────────────────────────── */}
      <main className="flex flex-1 overflow-hidden">
        {/* Left panel — Camera (40%) */}
        <div
          className="relative shrink-0"
          style={{
            width: "40%",
            minWidth: 200,
            borderRight: "2px solid rgba(33,39,37,.10)",
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

        {/* Right panel — Data (60%) */}
        <div
          className="flex flex-col flex-1 overflow-y-auto"
          style={{ background: "#E9E9E8" }}
        >
          {/* Waveform bridge */}
          <div
            style={{
              borderBottom: "1px solid rgba(33,39,37,.10)",
              paddingTop: 8,
            }}
          >
            <WaveformCanvas
              waveform={state.waveform}
              confidence={state.confidence}
              height={72}
            />
          </div>

          {/* Algorithm channel strip */}
          <div className="flex items-center gap-2 px-3 py-1.5 overflow-x-auto"
            style={{ borderBottom: "1px solid rgba(33,39,37,.08)" }}
          >
            {["CHROM", "POS", "PCA", "WIENER", "FUSED"].map((ch, i) => {
              const colors = ["#3B38EB", "#87B163", "#DDDEA1", "#5C6264", "#212725"];
              return (
                <span
                  key={ch}
                  className="shrink-0 text-[9px] font-bold px-2 py-0.5 rounded-sm"
                  style={{
                    fontFamily: "var(--font-ibm-plex-mono)",
                    background: `${colors[i]}18`,
                    color: colors[i],
                    border: `1px solid ${colors[i]}44`,
                  }}
                >
                  {ch}
                </span>
              );
            })}
            <span className="ml-auto shrink-0 text-[9px]" style={{ color: "#5C6264", fontFamily: "var(--font-barlow)" }}>
              QA-WF FUSION
            </span>
          </div>

          {/* 8-metric grid */}
          <div className="flex-1">
            <MetricsGrid
              metrics={state.metrics}
              elapsed={state.elapsed}
              isActive={isActive}
            />
          </div>

          {/* Error message */}
          {state.status === "error" && state.errorMsg && (
            <div className="mx-3 mb-3 px-3 py-2 rounded-[6px]"
              style={{ background: "rgba(224,84,84,.1)", border: "1px solid rgba(224,84,84,.3)", color: "#e05454" }}
            >
              <span className="text-[11px]">{t(`camera.${state.errorMsg}`)}</span>
            </div>
          )}
        </div>
      </main>

      {/* ── Disclaimer footer ─────────────────────────────────────────────── */}
      <DisclaimerBanner />
    </div>
  );
}
