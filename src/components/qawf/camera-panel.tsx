"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ROIRect, MeasureStatus } from "@/lib/rppg/use-rppg";

interface CameraPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  rois: ROIRect[];
  fps: number;
  confidence: number;
  elapsed: number;
  status: MeasureStatus;
}

export function CameraPanel({ videoRef, overlayRef, rois, fps, confidence, elapsed, status }: CameraPanelProps) {
  const { t } = useTranslation();
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    function draw() {
      const canvas = overlayRef.current;
      const video = videoRef.current;
      if (!canvas || !video) { animRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(draw); return; }

      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      canvas.width = vw;
      canvas.height = vh;
      ctx.clearRect(0, 0, vw, vh);

      // Subtle scan-line
      ctx.fillStyle = "rgba(108,99,255,0.025)";
      for (let y = 0; y < vh; y += 3) ctx.fillRect(0, y, vw, 1);

      // ROI boxes
      const roiColors = ["#6c63ff", "#38bdf8", "#a78bfa"];
      rois.forEach((roi, idx) => {
        const c = roiColors[idx % roiColors.length];
        // Dashed rect
        ctx.strokeStyle = c + "99";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.setLineDash([]);

        // Corner brackets
        const cL = 10;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        [
          [roi.x, roi.y, cL, 0, 0, cL],
          [roi.x + roi.w, roi.y, -cL, 0, 0, cL],
          [roi.x, roi.y + roi.h, cL, 0, 0, -cL],
          [roi.x + roi.w, roi.y + roi.h, -cL, 0, 0, -cL],
        ].forEach(([x, y, , , , dy2]) => {
          const dx1 = (x === roi.x) ? cL : -cL;
          ctx.beginPath();
          ctx.moveTo(x + dx1, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + dy2);
          ctx.stroke();
        });

        // Glowing dot at top-left corner
        ctx.beginPath();
        ctx.arc(roi.x, roi.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.shadowColor = c;
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Detecting cross-hair
      if (rois.length === 0 && status === "detecting") {
        const cx = vw / 2, cy = vh / 2;
        ctx.strokeStyle = "rgba(108,99,255,0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(cx - 40, cy); ctx.lineTo(cx + 40, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 40); ctx.lineTo(cx, cy + 40); ctx.stroke();
        ctx.setLineDash([]);
        // Circle
        ctx.strokeStyle = "rgba(108,99,255,0.3)";
        ctx.beginPath(); ctx.arc(cx, cy, 60, 0, Math.PI * 2); ctx.stroke();
      }

      animRef.current = requestAnimationFrame(draw);
    }
    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current); };
  }, [rois, status, videoRef, overlayRef]);

  const elapsedSec = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: "#0c0c22" }}
    >
      {/* Video */}
      <video
        ref={videoRef}
        autoPlay playsInline muted
        className="w-full h-full object-cover"
        style={{ transform: "scaleX(-1)", display: status === "idle" ? "none" : "block" }}
      />

      {/* ROI overlay */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Idle placeholder */}
      {status === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          {/* Animated rings */}
          <div className="relative w-16 h-16">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: "1px solid rgba(108,99,255,0.3)",
                animation: "ping 2s cubic-bezier(0,0,0.2,1) infinite",
              }}
            />
            <div
              className="absolute inset-2 rounded-full"
              style={{ border: "1px solid rgba(56,189,248,0.4)" }}
            />
            <div
              className="absolute inset-[22px] rounded-full"
              style={{ background: "linear-gradient(135deg,#6c63ff,#38bdf8)", boxShadow: "0 0 16px rgba(108,99,255,0.6)" }}
            />
          </div>
          <span
            className="text-xs tracking-widest uppercase"
            style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.7)" }}
          >
            {t("camera.start")}
          </span>
        </div>
      )}

      {/* Top status bar */}
      {status !== "idle" && (
        <div
          className="absolute top-0 left-0 right-0 px-3 py-1.5 flex items-center justify-between"
          style={{
            background: "linear-gradient(to bottom, rgba(7,7,26,0.85), transparent)",
            backdropFilter: "blur(2px)",
          }}
        >
          <div className="flex items-center gap-1.5">
            {/* Pulsing dot */}
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: status === "measuring" ? "#6c63ff" : "#38bdf8",
                boxShadow: `0 0 6px ${status === "measuring" ? "#6c63ff" : "#38bdf8"}`,
                display: "inline-block",
              }}
            />
            <span
              className="text-[10px] tracking-widest uppercase font-semibold"
              style={{ fontFamily: "var(--font-barlow)", color: "#818cf8" }}
            >
              {t(`status.${status}`)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#38bdf8" }}>
              {fps} fps
            </span>
            <span className="text-[10px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "rgba(226,228,240,0.7)" }}>
              {mm}:{ss}
            </span>
          </div>
        </div>
      )}

      {/* Bottom confidence bar */}
      {status === "measuring" && (
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-2 flex items-center gap-2"
          style={{
            background: "linear-gradient(to top, rgba(7,7,26,0.85), transparent)",
          }}
        >
          <span className="text-[9px] shrink-0 tracking-widest uppercase" style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.6)" }}>
            {t("camera.confidence")}
          </span>
          <div className="flex-1 h-[3px] rounded-full" style={{ background: "rgba(108,99,255,0.15)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${confidence}%`,
                background: confidence > 60
                  ? "linear-gradient(90deg,#6c63ff,#38bdf8)"
                  : confidence > 30
                    ? "linear-gradient(90deg,#a78bfa,#6c63ff)"
                    : "#f87171",
                transition: "width 400ms ease",
                boxShadow: confidence > 60 ? "0 0 8px rgba(56,189,248,0.5)" : "none",
              }}
            />
          </div>
          <span className="text-[10px] shrink-0" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#818cf8" }}>
            {confidence}%
          </span>
        </div>
      )}

      {/* No face warning */}
      {status === "measuring" && rois.length === 0 && (
        <div
          className="absolute bottom-10 left-0 right-0 text-center text-[10px] tracking-wider"
          style={{ color: "#38bdf8", fontFamily: "var(--font-barlow)" }}
        >
          {t("status.no_face")}
        </div>
      )}
    </div>
  );
}
