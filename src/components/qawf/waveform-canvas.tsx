"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface WaveformCanvasProps {
  waveform: number[];
  confidence: number;
  height?: number;
}

export function WaveformCanvas({ waveform, confidence, height = 64 }: WaveformCanvasProps) {
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

    if (waveform.length < 2) {
      // Flat dashed placeholder
      ctx.strokeStyle = "rgba(108,99,255,0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const data = waveform;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 6;

    const points = data.map((v, i) => ({
      x: (i / (data.length - 1)) * W,
      y: pad + ((1 - (v - min) / range) * (H - 2 * pad)),
    }));

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    const alpha = (confidence / 100) * 0.35;
    grad.addColorStop(0, `rgba(108,99,255,${alpha})`);
    grad.addColorStop(0.5, `rgba(56,189,248,${alpha * 0.5})`);
    grad.addColorStop(1, "rgba(108,99,255,0)");

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

    // Glow stroke
    ctx.shadowColor = "#6c63ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      const cp = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 };
      ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, cp.x, cp.y);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    // Gradient stroke: purple → cyan
    const strokeGrad = ctx.createLinearGradient(0, 0, W, 0);
    strokeGrad.addColorStop(0, "#6c63ff");
    strokeGrad.addColorStop(0.5, "#818cf8");
    strokeGrad.addColorStop(1, "#38bdf8");
    ctx.strokeStyle = strokeGrad;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [waveform, confidence]);

  return (
    <div className="flex flex-col gap-1 px-3 pb-2">
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-semibold tracking-widest uppercase"
          style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.6)" }}
        >
          {t("waveform.title")}
        </span>
        <span className="text-[10px]" style={{ fontFamily: "var(--font-ibm-plex-mono)", color: "#38bdf8" }}>
          {confidence}%
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={height}
        className="w-full rounded-lg"
        style={{
          height: `${height}px`,
          background: "rgba(108,99,255,0.04)",
          border: "1px solid rgba(108,99,255,0.14)",
        }}
      />
    </div>
  );
}
