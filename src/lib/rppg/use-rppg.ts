/**
 * use-rppg.ts
 *
 * Orchestrates:
 *  1. getUserMedia camera stream
 *  2. TF.js FaceMesh landmark detection (throttled to ~10 Hz)
 *  3. ROI pixel sampling every animation frame (OffscreenCanvas)
 *  4. Circular buffer → dispatch to Web Worker every 5s
 *  5. Returns live metrics, waveform, confidence, FPS, elapsed time
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Metrics8, RGBSample } from "@/lib/rppg/rppg-worker";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────
export type MeasureStatus =
  | "idle"
  | "requesting"
  | "detecting"
  | "measuring"
  | "done"
  | "error";

export interface ROIRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface RppgState {
  status: MeasureStatus;
  metrics: Metrics8 | null;
  waveform: number[];
  confidence: number;  // 0–100
  fps: number;
  elapsed: number;     // ms
  rois: ROIRect[];
  errorMsg: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const BUFFER_MAX = 180 * 30;     // 180s × 30fps
const WORKER_INTERVAL_MS = 5000; // dispatch to worker every 5s
const FACE_THROTTLE_MS = 100;    // FaceMesh detection throttle ~10Hz

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf: any;
    faceLandmarksDetection: {
      createDetector: (model: string, config: object) => Promise<FaceLandmarkDetector>;
      SupportedModels: { MediaPipeFaceMesh: string };
    };
  }
}

interface FaceLandmarkDetector {
  estimateFaces: (video: HTMLVideoElement) => Promise<FaceLandmark[]>;
}
interface FaceLandmark {
  keypoints: { x: number; y: number; z?: number; name?: string }[];
  box: { xMin: number; yMin: number; xMax: number; yMax: number; width: number; height: number };
}

// ────────────────────────────────────────────────────────────────────────────
// ROI extraction helpers
// ────────────────────────────────────────────────────────────────────────────
function computeROIs(face: FaceLandmark, videoW: number, videoH: number): ROIRect[] {
  const { xMin, yMin, width: w, height: h } = face.box;
  return [
    { x: xMin + 0.30 * w, y: yMin + 0.05 * h, w: 0.40 * w, h: 0.13 * h, label: "forehead" },
    { x: xMin + 0.15 * w, y: yMin + 0.55 * h, w: 0.18 * w, h: 0.15 * h, label: "left-cheek" },
    { x: xMin + 0.67 * w, y: yMin + 0.55 * h, w: 0.18 * w, h: 0.15 * h, label: "right-cheek" },
  ].map((roi) => ({
    ...roi,
    x: Math.max(0, Math.min(roi.x, videoW)),
    y: Math.max(0, Math.min(roi.y, videoH)),
    w: Math.min(roi.w, videoW - roi.x),
    h: Math.min(roi.h, videoH - roi.y),
  }));
}

function sampleROI(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, roi: ROIRect): { r: number; g: number; b: number } {
  const iw = Math.max(1, Math.round(roi.w));
  const ih = Math.max(1, Math.round(roi.h));
  const data = ctx.getImageData(Math.round(roi.x), Math.round(roi.y), iw, ih).data;
  let r = 0, g = 0, b = 0;
  const len = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return { r: r / len / 255, g: g / len / 255, b: b / len / 255 };
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────
export function useRppg(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<RppgState>({
    status: "idle",
    metrics: null,
    waveform: [],
    confidence: 0,
    fps: 0,
    elapsed: 0,
    rois: [],
    errorMsg: null,
  });

  const workerRef    = useRef<Worker | null>(null);
  const bufferRef    = useRef<RGBSample[]>([]);
  const rafRef       = useRef<number | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const offCtxRef    = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const offCanRef    = useRef<OffscreenCanvas | null>(null);
  const faceDetRef   = useRef<FaceLandmarkDetector | null>(null);
  const lastFaceTime = useRef<number>(0);
  const lastWorkerDispatch = useRef<number>(0);
  const startTime    = useRef<number>(0);
  const frameCount   = useRef<number>(0);
  const fpsTime      = useRef<number>(0);
  const roiRef       = useRef<ROIRect[]>([]);
  const running      = useRef<boolean>(false);
  const statusRef    = useRef<MeasureStatus>("idle");

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    running.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
    bufferRef.current = [];
  }, []);

  // ── Main frame loop ───────────────────────────────────────────────────────
  const frameLoop = useCallback(async () => {
    if (!running.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(frameLoop);
      return;
    }

    const now = performance.now();

    // ── FPS ──────────────────────────────────────────────────────────────
    frameCount.current++;
    if (now - fpsTime.current >= 1000) {
      const fps = Math.round((frameCount.current * 1000) / (now - fpsTime.current));
      frameCount.current = 0;
      fpsTime.current = now;
      setState((prev) => ({ ...prev, fps, elapsed: now - startTime.current }));
    }

    // ── FaceMesh (throttled) ──────────────────────────────────────────────
    if (faceDetRef.current && now - lastFaceTime.current > FACE_THROTTLE_MS) {
      lastFaceTime.current = now;
      try {
        const faces = await faceDetRef.current.estimateFaces(video);
        if (faces.length > 0) {
          lastFaceRef.current = faces[0];
          roiRef.current = computeROIs(faces[0], video.videoWidth, video.videoHeight);
          if (statusRef.current === "detecting") {
            statusRef.current = "measuring";
            setState((prev) => ({ ...prev, status: "measuring", rois: roiRef.current }));
          }
        } else {
          lastFaceRef.current = null;
          roiRef.current = [];
        }
      } catch {
        // face detection may fail briefly — tolerate
      }
    }

    // ── Sample ROI pixels ─────────────────────────────────────────────────
    if (roiRef.current.length > 0) {
      const oc = offCanRef.current;
      const ctx = offCtxRef.current;
      if (oc && ctx) {
        oc.width = video.videoWidth;
        oc.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, oc.width, oc.height);

        let r = 0, g = 0, b = 0;
        for (const roi of roiRef.current) {
          const pixel = sampleROI(ctx, roi);
          r += pixel.r; g += pixel.g; b += pixel.b;
        }
        r /= roiRef.current.length;
        g /= roiRef.current.length;
        b /= roiRef.current.length;

        bufferRef.current.push({ t: now, r, g, b });
        if (bufferRef.current.length > BUFFER_MAX) {
          bufferRef.current.splice(0, bufferRef.current.length - BUFFER_MAX);
        }

        // ── Dispatch to worker every 5s ─────────────────────────────────
        if (
          workerRef.current &&
          bufferRef.current.length >= 30 &&
          now - lastWorkerDispatch.current >= WORKER_INTERVAL_MS
        ) {
          lastWorkerDispatch.current = now;
          workerRef.current.postMessage({
            type: "samples",
            data: [...bufferRef.current],
            elapsed: now - startTime.current,
          });
        }
      }
    }

    rafRef.current = requestAnimationFrame(frameLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);
  // ── Load TF.js & FaceMesh from CDN ───────────────────────────────────────
  async function loadFaceMesh() {
    if (typeof window === "undefined") return;
    if (!window.tf) {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
    }
    if (!window.faceLandmarksDetection) {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection@1.0.6/dist/face-landmarks-detection.js");
    }
    await window.tf.ready();
    const detector = await window.faceLandmarksDetection.createDetector(
      window.faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
      { runtime: "tfjs", refineLandmarks: false, maxFaces: 1 }
    );
    return detector;
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    stopAll();
    setState({
      status: "requesting",
      metrics: null,
      waveform: [],
      confidence: 0,
      fps: 0,
      elapsed: 0,
      rois: [],
      errorMsg: null,
    });

    // Camera
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
      });
      // Try to lock exposure & white balance
      const track = stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({
          advanced: [{ exposureMode: "manual" } as MediaTrackConstraintSet],
        });
      } catch { /* not supported — ok */ }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMsg: (err as Error).name === "NotAllowedError"
          ? "permission_denied"
          : "not_supported",
      }));
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }

    // OffscreenCanvas
    try {
      const oc = new OffscreenCanvas(640, 480);
      offCanRef.current = oc;
      offCtxRef.current = oc.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
    } catch {
      // Fallback: use a regular canvas
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      offCanRef.current = canvas as unknown as OffscreenCanvas;
      offCtxRef.current = canvas.getContext("2d", { willReadFrequently: true }) as unknown as OffscreenCanvasRenderingContext2D;
    }

    // Worker
    workerRef.current = new Worker(
      new URL("@/lib/rppg/rppg-worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current.onmessage = (e) => {
      if (e.data?.type === "result") {
        setState((prev) => ({
          ...prev,
          metrics: e.data.metrics,
          waveform: e.data.waveform ?? [],
          confidence: e.data.confidence ?? 0,
          elapsed: e.data.elapsed ?? prev.elapsed,
        }));
      }
    };

    setState((prev) => ({ ...prev, status: "detecting" }));
    statusRef.current = "detecting";
    running.current = true;
    startTime.current = performance.now();
    fpsTime.current = performance.now();
    frameCount.current = 0;
    lastWorkerDispatch.current = 0;
    bufferRef.current = [];

    // Load FaceMesh
    try {
      faceDetRef.current = (await loadFaceMesh()) ?? null;
    } catch {
      // FaceMesh unavailable — continue without ROI tracking
      faceDetRef.current = null;
    }

    rafRef.current = requestAnimationFrame(frameLoop);
  }, [stopAll, videoRef, frameLoop]);

  const stop = useCallback(() => {
    stopAll();
    setState((prev) => ({ ...prev, status: "done" }));
  }, [stopAll]);

  // Cleanup on unmount
  useEffect(() => () => { stopAll(); }, [stopAll]);

  return { state, start, stop };
}

// ────────────────────────────────────────────────────────────────────────────
// Utility: load external script
// ────────────────────────────────────────────────────────────────────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
