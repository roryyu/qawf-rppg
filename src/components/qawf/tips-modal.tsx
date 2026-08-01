"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Metrics8 } from "@/lib/rppg/rppg-worker";

interface TipsModalProps {
  metrics: Metrics8;
  /** base64 JPEG (no data-url prefix) captured during measurement */
  capturedPhoto?: string;
  onClose: () => void;
}

type VoiceState  = "idle" | "listening" | "processing" | "done" | "unsupported" | "error";
type GenState    = "idle" | "loading" | "streaming" | "done" | "error";
type AvatarState = "idle" | "loading" | "done" | "error" | "unavailable";

// ── MediaRecorder support check ───────────────────────────────────────────────
function mediaRecorderSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasMR = typeof (window as any).MediaRecorder !== "undefined";
    const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    return hasMR && hasMic;
  } catch {
    return false;
  }
}

// ── Pick best audio MIME type for the browser ─────────────────────────────────
function bestMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (window as any).MediaRecorder !== "undefined" && (window as any).MediaRecorder.isTypeSupported(t)) return t;
    } catch { /* ignore */ }
  }
  return "";
}

export function TipsModal({ metrics, capturedPhoto, onClose }: TipsModalProps) {
  const { t, i18n } = useTranslation();

  const [mood,         setMood]         = useState("");
  const [voiceState,   setVoiceState]   = useState<VoiceState>(
    mediaRecorderSupported() ? "idle" : "unsupported"
  );
  const [genState,     setGenState]     = useState<GenState>("idle");
  const [tipsText,     setTipsText]     = useState("");
  const [copied,       setCopied]       = useState(false);
  const [avatarState,  setAvatarState]  = useState<AvatarState>(capturedPhoto ? "idle" : "unavailable");
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);

  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const tipsRef     = useRef<HTMLDivElement>(null);

  // ── Generate avatar ───────────────────────────────────────────────────────
  const generateAvatar = useCallback(async () => {
    if (!capturedPhoto) { setAvatarState("unavailable"); return; }
    setAvatarState("loading");
    try {
      const res = await fetch("/api/avatar", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ photo: capturedPhoto }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 503 || body?.error?.includes("not configured")) {
          setAvatarState("unavailable"); return;
        }
        setAvatarState("error"); return;
      }
      const data = await res.json() as { avatarBase64?: string };
      if (data.avatarBase64) { setAvatarBase64(data.avatarBase64); setAvatarState("done"); }
      else setAvatarState("error");
    } catch { setAvatarState("error"); }
  }, [capturedPhoto]);

  // Kick off avatar generation as soon as Modal mounts
  useEffect(() => {
    if (capturedPhoto) generateAvatar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = bestMimeType();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const MR     = (window as any).MediaRecorder as typeof MediaRecorder;
      const rec    = mime ? new MR(stream, { mimeType: mime }) : new MR(stream);

      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      rec.onstop = async () => {
        // Stop all mic tracks to release the mic indicator
        stream.getTracks().forEach((t) => t.stop());

        setVoiceState("processing");

        const blob     = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const formData = new FormData();
        formData.append("audio", blob, "mood.webm");

        try {
          const res = await fetch("/api/asr", { method: "POST", body: formData });
          if (!res.ok) throw new Error(`ASR ${res.status}`);
          const { text } = (await res.json()) as { text: string };
          if (text) setMood((prev) => prev ? `${prev} ${text}` : text);
          setVoiceState("done");
        } catch {
          setVoiceState("error");
        }
      };

      rec.start();
      mediaRecRef.current = rec;
      setVoiceState("listening");
    } catch {
      setVoiceState("error");
    }
  }, []);

  // ── Stop recording ────────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
  }, []);

  const handleMicClick = useCallback(() => {
    if (voiceState === "listening") stopRecording();
    else if (voiceState !== "processing") startRecording();
  }, [voiceState, startRecording, stopRecording]);

  // ── Generate tips via LLM ─────────────────────────────────────────────────
  const generate = useCallback(async () => {
    setGenState("loading");
    setTipsText("");

    const locale = i18n.language === "zh-CN" ? "zh-CN" : "en-US";

    try {
      const res = await fetch("/api/report/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics, mood: mood.trim(), locale }),
      });

      if (!res.ok) { setGenState("error"); return; }

      setGenState("streaming");
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setTipsText(fullText);
        if (tipsRef.current) tipsRef.current.scrollTop = tipsRef.current.scrollHeight;
      }

      // If stream completed but we got nothing meaningful, treat as error
      if (!fullText.trim()) {
        setGenState("error");
        return;
      }

      setGenState("done");
    } catch {
      setGenState("error");
    }
  }, [metrics, mood, i18n.language]);

  // ── Copy ──────────────────────────────────────────────────────────────────
  const copyTips = () => {
    navigator.clipboard.writeText(tipsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Voice hint label ──────────────────────────────────────────────────────
  const voiceHint =
    voiceState === "listening"   ? t("tips.voice_listening")
    : voiceState === "processing"? t("tips.voice_processing")
    : voiceState === "done"      ? t("tips.voice_done")
    : voiceState === "error"     ? t("tips.voice_error")
    : voiceState === "unsupported" ? t("tips.voice_not_supported")
    : t("tips.voice_hint");

  const canGenerate = genState === "idle" || genState === "error" || genState === "done";
  const showMoodInput = genState === "idle" || genState === "error";

  // ── Mic button appearance ─────────────────────────────────────────────────
  const micActive     = voiceState === "listening";
  const micProcessing = voiceState === "processing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(7,7,26,0.88)", backdropFilter: "blur(10px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0f0f2e 0%, #0a0a1a 100%)",
          border: "1px solid rgba(108,99,255,0.25)",
          boxShadow: "0 0 60px rgba(108,99,255,0.2), 0 32px 80px rgba(0,0,0,0.6)",
          maxHeight: "92vh",
        }}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(108,99,255,0.3)" }} />
        </div>

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(108,99,255,0.12)" }}>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <h2 className="text-base font-bold tracking-wide"
                style={{
                  fontFamily: "var(--font-barlow)",
                  background: "linear-gradient(90deg,#818cf8,#38bdf8)",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                }}>
                {t("tips.modal_title")}
              </h2>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(226,228,240,0.45)" }}>
              {t("tips.modal_subtitle")}
            </p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5"
            style={{ background: "rgba(108,99,255,0.1)", color: "rgba(129,140,248,0.7)", border: "1px solid rgba(108,99,255,0.2)" }}>
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Avatar + metric pills row */}
          <div className="flex items-start gap-3">

            {/* ── Avatar panel (hidden when feature unavailable) ── */}
            {avatarState !== "unavailable" && (
              <div
                className="shrink-0 rounded-2xl overflow-hidden flex items-center justify-center"
                style={{
                  width:      "88px",
                  height:     "88px",
                  background: "rgba(108,99,255,0.06)",
                  border:     "1px solid rgba(108,99,255,0.2)",
                  boxShadow:  avatarState === "done"
                    ? "0 0 28px rgba(108,99,255,0.4), 0 0 10px rgba(56,189,248,0.2)"
                    : "none",
                  transition: "box-shadow 600ms ease",
                }}
              >
                {avatarState === "loading" && (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="relative w-9 h-9">
                      <div className="absolute inset-0 rounded-full"
                        style={{ border: "2px solid transparent", borderTop: "2px solid #6c63ff", animation: "spin 1s linear infinite" }} />
                      <div className="absolute inset-[5px] rounded-full"
                        style={{ border: "1.5px solid transparent", borderTop: "1.5px solid #38bdf8", animation: "spin 0.65s linear infinite reverse" }} />
                    </div>
                    <span className="text-[7.5px] text-center leading-tight px-0.5"
                      style={{ color: "rgba(129,140,248,0.5)", fontFamily: "var(--font-barlow)" }}>
                      {t("tips.avatar_generating")}
                    </span>
                  </div>
                )}
                {avatarState === "done" && avatarBase64 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`data:image/png;base64,${avatarBase64}`}
                    alt={t("tips.avatar_alt")}
                    className="w-full h-full object-cover"
                  />
                )}
                {avatarState === "error" && (
                  <div className="flex flex-col items-center gap-1 px-2">
                    <span style={{ fontSize: 22 }}>🎨</span>
                    <button onClick={generateAvatar}
                      className="text-[8px] font-bold text-center"
                      style={{ color: "rgba(129,140,248,0.6)", fontFamily: "var(--font-barlow)" }}>
                      {t("tips.avatar_retry")}
                    </button>
                  </div>
                )}
              </div>
            )}

          {/* Metric pills */}
          <div className="flex flex-wrap gap-1.5 flex-1 content-start">
            {([
              { k: "HR",    v: metrics.hr,    u: " bpm",  c: "#f472b6" },
              { k: "RR",    v: metrics.rr,    u: "/min",  c: "#38bdf8" },
              { k: "SpO₂",  v: metrics.spo2,  u: "%",     c: "#34d399" },
              { k: "RMSSD", v: metrics.rmssd, u: " ms",   c: "#818cf8" },
              { k: "LF/HF", v: metrics.lfhf,  u: "",      c: "#6c63ff" },
              { k: "SI",    v: metrics.si,    u: "",      c: "#fbbf24" },
              { k: "FI",    v: metrics.fi,    u: "/100",  c: "#fb923c" },
              { k: "MWI",   v: metrics.mwi,   u: "/100",  c: "#c084fc" },
            ] as { k: string; v: number | null; u: string; c: string }[]).map(({ k, v, u, c }) => (
              <span key={k} className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ fontFamily: "var(--font-ibm-plex-mono)", background: `${c}12`, color: c, border: `1px solid ${c}28` }}>
                {k} {v !== null
                  ? `${typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v}${u}`
                  : "--"}
              </span>
            ))}
          </div>

          {/* Mood input */}
          {showMoodInput && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold tracking-widest uppercase"
                style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.6)" }}>
                {t("tips.mood_label")}
              </label>

              <div className="flex items-start gap-2">
                {/* Textarea */}
                <textarea
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  placeholder={t("tips.input_placeholder")}
                  rows={3}
                  className="flex-1 rounded-xl px-3 py-2.5 resize-none outline-none text-[13px] leading-relaxed"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(108,99,255,0.2)",
                    color: "#e2e4f0",
                    fontFamily: "var(--font-sans)",
                  }}
                />

                {/* Mic button */}
                {voiceState !== "unsupported" && (
                  <button
                    onClick={handleMicClick}
                    disabled={micProcessing}
                    className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{
                      background: micActive
                        ? "linear-gradient(135deg,#f472b6,#6c63ff)"
                        : micProcessing
                          ? "rgba(108,99,255,0.2)"
                          : "rgba(108,99,255,0.12)",
                      border: micActive ? "none" : "1px solid rgba(108,99,255,0.25)",
                      boxShadow: micActive ? "0 0 20px rgba(244,114,182,0.45)" : "none",
                      transition: "all 280ms ease",
                      cursor: micProcessing ? "not-allowed" : "pointer",
                    }}
                  >
                    {micProcessing ? (
                      /* Spinner */
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="#818cf8" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                    ) : micActive ? (
                      /* Animated bars */
                      <span className="flex items-center gap-[3px]">
                        {[1, 2, 3, 4].map((i) => (
                          <span key={i} className="w-[3px] rounded-full bg-white"
                            style={{
                              height: `${6 + i % 3 * 4}px`,
                              animation: `voiceBar ${0.35 + i * 0.08}s ease-in-out infinite alternate`,
                            }} />
                        ))}
                      </span>
                    ) : (
                      /* Mic icon */
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke={voiceState === "done" ? "#38bdf8" : "#818cf8"}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="2" width="6" height="12" rx="3"/>
                        <path d="M5 10a7 7 0 0 0 14 0"/>
                        <line x1="12" y1="19" x2="12" y2="22"/>
                        <line x1="8" y1="22" x2="16" y2="22"/>
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {/* Voice hint + ASR badge */}
              <div className="flex items-center gap-2">
                <p className="text-[10px] flex-1" style={{ color: "rgba(129,140,248,0.5)" }}>
                  {voiceHint}
                </p>
                {voiceState !== "unsupported" && (
                  <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded"
                    style={{
                      fontFamily: "var(--font-ibm-plex-mono)",
                      background: "rgba(56,189,248,0.08)",
                      color: "#38bdf8",
                      border: "1px solid rgba(56,189,248,0.2)",
                    }}>
                    mimo-v2.5-asr
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Loading */}
          {genState === "loading" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full"
                  style={{
                    background: "linear-gradient(135deg,#6c63ff,#38bdf8)",
                    boxShadow: "0 0 28px rgba(108,99,255,0.5)",
                    animation: "pulse 1.2s ease-in-out infinite",
                  }} />
                <div className="absolute inset-[3px] rounded-full" style={{ background: "#0a0a1a" }} />
                <div className="absolute inset-[8px] rounded-full"
                  style={{ background: "linear-gradient(135deg,#6c63ff,#38bdf8)", opacity: 0.7 }} />
              </div>
              <p className="text-[11px]" style={{ color: "rgba(129,140,248,0.6)" }}>
                {t("tips.generating")}
              </p>
            </div>
          )}

          {/* Tips output */}
          {(genState === "streaming" || genState === "done") && tipsText && (
            <div
              ref={tipsRef}
              className="rounded-xl px-4 py-3 text-sm leading-relaxed overflow-y-auto"
              style={{
                background: "rgba(108,99,255,0.05)",
                border: "1px solid rgba(108,99,255,0.18)",
                color: "#e2e4f0",
                maxHeight: "260px",
                whiteSpace: "pre-wrap",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {tipsText}
              {genState === "streaming" && (
                <span className="inline-block w-[3px] h-[1em] ml-0.5 rounded-sm align-middle"
                  style={{ background: "#818cf8", animation: "pulse 0.9s ease-in-out infinite" }} />
              )}
            </div>
          )}

          {/* Error */}
          {genState === "error" && (
            <p className="text-[12px] text-center py-2" style={{ color: "#f87171" }}>
              {t("tips.tips_error")}
            </p>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-5 py-4 flex items-center gap-2"
          style={{ borderTop: "1px solid rgba(108,99,255,0.1)" }}>

          {canGenerate && (
            <button onClick={generate}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white tracking-wide relative overflow-hidden"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "linear-gradient(135deg,#6c63ff,#38bdf8)",
                boxShadow: "0 0 22px rgba(108,99,255,0.4)",
                letterSpacing: "0.05em",
              }}>
              {genState === "error" ? t("tips.retry") : t("tips.generate")}
            </button>
          )}

          {genState === "done" && tipsText && (
            <button onClick={copyTips}
              className="py-2.5 px-4 rounded-xl font-bold text-[12px]"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "rgba(108,99,255,0.1)",
                color: "#818cf8",
                border: "1px solid rgba(108,99,255,0.25)",
              }}>
              {copied ? t("tips.copied") : t("tips.copy")}
            </button>
          )}

          {(genState === "done" || genState === "streaming") && (
            <button onClick={onClose}
              className="py-2.5 px-4 rounded-xl font-bold text-[12px]"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(226,228,240,0.45)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
              {t("tips.close")}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes voiceBar {
          from { transform: scaleY(0.5); opacity: 0.7; }
          to   { transform: scaleY(1.5); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
