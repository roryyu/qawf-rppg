"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface WaveformCanvasProps {
  waveform: number[];   // recent rPPG samples
  confidence: number;  // 0–100
  height?: number;
}

export function WaveformCanvas({ waveform, confidence, height = 72 }: WaveformCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "rgba(233,233,232,0)";
    ctx.fillRect(0, 0, W, H);

    if (waveform.length < 2) {
      // Draw flat line as placeholder
      ctx.strokeStyle = "rgba(33,39,37,.15)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    // Normalize waveform
    const data = waveform;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 8;

    // Map samples to canvas coords
    const points = data.map((v, i) => ({
      x: (i / (data.length - 1)) * W,
      y: pad + ((1 - (v - min) / range) * (H - 2 * pad)),
    }));

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, `rgba(59,56,235,${(confidence / 100) * 0.3})`);
    grad.addColorStop(1, "rgba(59,56,235,0)");

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const cp = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 };
      ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, cp.x, cp.y);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const cp = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 };
      ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, cp.x, cp.y);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.strokeStyle = "#3B38EB";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Channel labels (CHROM strip)
    const channels = ["CHROM", "POS", "PCA", "FUSED"];
    const accentColors = ["#3B38EB", "#87B163", "#DDDEA1", "#212725"];
    channels.forEach((ch, i) => {
      const x = 8 + i * 56;
      ctx.fillStyle = accentColors[i];
      ctx.font = "bold 8px 'IBM Plex Mono', monospace";
      ctx.fillText(ch, x, H - 4);
    });
  }, [waveform, confidence]);

  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ fontFamily: "var(--font-barlow)", color: "#5C6264" }}
        >
          {t("waveform.title")}
        </span>
        <span
          className="text-[10px]"
          style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#3B38EB" }}
        >
          {confidence}%
        </span>
      </div>

      {/* Waveform */}
      <canvas
        ref={canvasRef}
        width={800}
        height={height}
        className="w-full rounded-[6px]"
        style={{
          height: `${height}px`,
          background: "rgba(59,56,235,0.04)",
          border: "1px solid rgba(59,56,235,0.12)",
        }}
      />
    </div>
  );
}
