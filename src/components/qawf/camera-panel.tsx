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

/** Draws ROI rectangles onto the overlay canvas, scaled to canvas display size */
export function CameraPanel({
  videoRef,
  overlayRef,
  rois,
  fps,
  confidence,
  elapsed,
  status,
}: CameraPanelProps) {
  const { t } = useTranslation();
  const animRef = useRef<number | null>(null);

  // ROI overlay draw loop
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

      // Scan-line effect
      ctx.fillStyle = "rgba(59,56,235,0.03)";
      for (let y = 0; y < vh; y += 4) {
        ctx.fillRect(0, y, vw, 1);
      }

      // ROI boxes
      rois.forEach((roi, idx) => {
        const colors = ["#DDDEA1", "#3B38EB", "#87B163"];
        const c = colors[idx % colors.length];
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.setLineDash([]);

        // Corner marks
        const cLen = 8;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        [
          [roi.x, roi.y, cLen, 0, 0, cLen],
          [roi.x + roi.w, roi.y, -cLen, 0, 0, cLen],
          [roi.x, roi.y + roi.h, cLen, 0, 0, -cLen],
          [roi.x + roi.w, roi.y + roi.h, -cLen, 0, 0, -cLen],
        ].forEach(([x, y, dx1, dy1, dx2, dy2]) => {
          ctx.beginPath();
          ctx.moveTo(x + dx1, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + dy2);
          ctx.stroke();
          void dx2; void dy1;
        });
      });

      // Face detection cross-hair
      if (rois.length === 0 && status === "detecting") {
        const cx = vw / 2, cy = vh / 2;
        ctx.strokeStyle = "rgba(59,56,235,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(cx - 30, cy); ctx.lineTo(cx + 30, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy + 30); ctx.stroke();
        ctx.setLineDash([]);
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
    <div className="relative w-full h-full overflow-hidden" style={{ background: "#212725" }}>
      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{ transform: "scaleX(-1)", display: status === "idle" ? "none" : "block" }}
      />

      {/* Overlay canvas for ROI rects */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Idle placeholder */}
      {status === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" stroke="#3B38EB" strokeWidth="1.5" strokeDasharray="4 4" />
            <circle cx="24" cy="24" r="10" stroke="#3B38EB" strokeWidth="1.5" />
            <circle cx="24" cy="24" r="3" fill="#3B38EB" />
          </svg>
          <span className="text-xs text-brand-muted" style={{ fontFamily: "var(--font-barlow)" }}>
            {t("camera.start")}
          </span>
        </div>
      )}

      {/* Status bar — top */}
      {status !== "idle" && (
        <div
          className="absolute top-0 left-0 right-0 px-3 py-1.5 flex items-center justify-between"
          style={{ background: "rgba(33,39,37,0.7)", backdropFilter: "blur(4px)" }}
        >
          <span
            className="text-[10px] tracking-wider uppercase font-semibold"
            style={{ fontFamily: "var(--font-barlow)", color: "#DDDEA1" }}
          >
            {t(`status.${status}`)}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#87B163" }}>
              {fps} {t("camera.fps")}
            </span>
            <span className="text-[10px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#E9E9E8" }}>
              {mm}:{ss}
            </span>
          </div>
        </div>
      )}

      {/* Confidence bar — bottom */}
      {status === "measuring" && (
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-1.5 flex items-center gap-2"
          style={{ background: "rgba(33,39,37,0.7)", backdropFilter: "blur(4px)" }}
        >
          <span className="text-[10px] shrink-0" style={{ fontFamily: "var(--font-barlow)", color: "#5C6264" }}>
            {t("camera.confidence")}
          </span>
          <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,.15)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${confidence}%`,
                background: confidence > 60 ? "#87B163" : confidence > 30 ? "#DDDEA1" : "#e05454",
                transition: "width 400ms ease",
              }}
            />
          </div>
          <span className="text-[10px] shrink-0" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#E9E9E8" }}>
            {confidence}%
          </span>
        </div>
      )}

      {/* No face warning */}
      {status === "measuring" && rois.length === 0 && (
        <div
          className="absolute bottom-10 left-0 right-0 px-3 py-1 text-center text-[11px]"
          style={{ color: "#DDDEA1", fontFamily: "var(--font-barlow)" }}
        >
          {t("status.no_face")}
        </div>
      )}
    </div>
  );
}
