"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getResolvedLocale } from "@/lib/i18n/locale";
import type { Metrics8 } from "@/lib/rppg/rppg-worker";

// ── Web Speech API types ──────────────────────────────────────────────────────
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  [i: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  [i: number]: { transcript: string };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface TipsModalProps {
  metrics: Metrics8;
  onClose: () => void;
}

// ── Mic button states ─────────────────────────────────────────────────────────
type VoiceState = "idle" | "listening" | "done" | "unsupported" | "error";

// ── Main component ────────────────────────────────────────────────────────────
export function TipsModal({ metrics, onClose }: TipsModalProps) {
  const { t, i18n } = useTranslation();

  // Mood text
  const [mood, setMood] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);

  // LLM output
  type GenState = "idle" | "loading" | "streaming" | "done" | "error";
  const [genState, setGenState] = useState<GenState>("idle");
  const [tipsText, setTipsText] = useState("");
  const [copied, setCopied] = useState(false);

  // Ref to scroll tips text area
  const tipsRef = useRef<HTMLDivElement>(null);

  // ── Check SpeechRecognition support ────────────────────────────────────────
  const speechSupported =
    typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    if (!speechSupported) setVoiceState("unsupported");
  }, [speechSupported]);

  // ── Start / stop mic ───────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceState("unsupported"); return; }

    const recog = new SR();
    recog.lang = i18n.language === "zh-CN" ? "zh-CN" : "en-US";
    recog.continuous = false;
    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onresult = (e: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setMood(transcript);
    };
    recog.onerror = () => setVoiceState("error");
    recog.onend = () => setVoiceState("done");

    recogRef.current = recog;
    recog.start();
    setVoiceState("listening");
  }, [i18n.language]);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    setVoiceState("done");
  }, []);

  // ── Generate tips ──────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    setGenState("loading");
    setTipsText("");

    const locale = getResolvedLocale();

    try {
      const res = await fetch("/api/report/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metrics, mood: mood.trim() || "", locale }),
      });

      if (!res.ok) {
        setGenState("error");
        return;
      }

      setGenState("streaming");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTipsText((prev) => prev + chunk);
        // Auto-scroll
        if (tipsRef.current) {
          tipsRef.current.scrollTop = tipsRef.current.scrollHeight;
        }
      }
      setGenState("done");
    } catch {
      setGenState("error");
    }
  }, [metrics, mood]);

  // ── Copy tips ──────────────────────────────────────────────────────────────
  const copyTips = () => {
    if (!tipsText) return;
    navigator.clipboard.writeText(tipsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Voice status hint text ─────────────────────────────────────────────────
  const voiceHint =
    voiceState === "listening" ? t("tips.voice_listening")
    : voiceState === "done"    ? t("tips.voice_done")
    : voiceState === "error"   ? t("tips.voice_error")
    : voiceState === "unsupported" ? t("tips.voice_not_supported")
    : t("tips.voice_hint");

  const canGenerate = genState === "idle" || genState === "error" || genState === "done";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(7,7,26,0.85)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card */}
      <div
        className="relative w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: "linear-gradient(160deg, #0f0f2e 0%, #0a0a1a 100%)",
          border: "1px solid rgba(108,99,255,0.25)",
          boxShadow: "0 0 60px rgba(108,99,255,0.2), 0 32px 80px rgba(0,0,0,0.6)",
          maxHeight: "90vh",
        }}
      >
        {/* Drag handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(108,99,255,0.35)" }} />
        </div>

        {/* ── Header ── */}
        <div
          className="flex items-start justify-between px-5 pt-4 pb-3 shrink-0"
          style={{ borderBottom: "1px solid rgba(108,99,255,0.12)" }}
        >
          <div>
            <div className="flex items-center gap-2">
              {/* Sparkle icon */}
              <span className="text-lg">✨</span>
              <h2
                className="text-base font-bold tracking-wide"
                style={{
                  fontFamily: "var(--font-barlow)",
                  background: "linear-gradient(90deg,#818cf8,#38bdf8)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {t("tips.modal_title")}
              </h2>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(226,228,240,0.5)" }}>
              {t("tips.modal_subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5"
            style={{
              background: "rgba(108,99,255,0.1)",
              color: "rgba(129,140,248,0.7)",
              border: "1px solid rgba(108,99,255,0.2)",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Metric summary pills */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { k: "HR", v: metrics.hr, u: "bpm", c: "#f472b6" },
              { k: "RR", v: metrics.rr, u: "/min", c: "#38bdf8" },
              { k: "SpO₂", v: metrics.spo2, u: "%", c: "#34d399" },
              { k: "RMSSD", v: metrics.rmssd, u: "ms", c: "#818cf8" },
              { k: "LF/HF", v: metrics.lfhf, u: "", c: "#6c63ff" },
              { k: "SI", v: metrics.si, u: "", c: "#fbbf24" },
              { k: "FI", v: metrics.fi, u: "/100", c: "#fb923c" },
              { k: "MWI", v: metrics.mwi, u: "/100", c: "#c084fc" },
            ].map(({ k, v, u, c }) => (
              <span
                key={k}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  fontFamily: "var(--font-ibm-plex-mono)",
                  background: `${c}12`,
                  color: c,
                  border: `1px solid ${c}28`,
                }}
              >
                {k} {v !== null ? `${typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : v}${u}` : "--"}
              </span>
            ))}
          </div>

          {/* Mood input section */}
          {(genState === "idle" || genState === "error") && (
            <div className="flex flex-col gap-2">
              <label
                className="text-[10px] font-bold tracking-widest uppercase"
                style={{ fontFamily: "var(--font-barlow)", color: "rgba(129,140,248,0.6)" }}
              >
                {t("tips.mood_label")}
              </label>

              {/* Textarea + mic row */}
              <div className="relative flex items-start gap-2">
                <textarea
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  placeholder={t("tips.input_placeholder")}
                  rows={3}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm resize-none outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(108,99,255,0.2)",
                    color: "#e2e4f0",
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                />

                {/* Mic button */}
                {speechSupported && (
                  <button
                    onClick={voiceState === "listening" ? stopListening : startListening}
                    className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      background: voiceState === "listening"
                        ? "linear-gradient(135deg,#f472b6,#6c63ff)"
                        : "rgba(108,99,255,0.12)",
                      border: `1px solid ${voiceState === "listening" ? "transparent" : "rgba(108,99,255,0.25)"}`,
                      boxShadow: voiceState === "listening" ? "0 0 16px rgba(244,114,182,0.4)" : "none",
                      transition: "all 300ms ease",
                    }}
                  >
                    {voiceState === "listening" ? (
                      /* Animated waveform bars */
                      <span className="flex items-center gap-0.5">
                        {[1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className="w-0.5 rounded-full"
                            style={{
                              height: `${8 + i * 4}px`,
                              background: "#fff",
                              animation: `bounce ${0.4 + i * 0.1}s ease-in-out infinite alternate`,
                            }}
                          />
                        ))}
                      </span>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round">
                        <rect x="9" y="2" width="6" height="12" rx="3" />
                        <path d="M5 10a7 7 0 0 0 14 0" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                        <line x1="8" y1="22" x2="16" y2="22" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {/* Voice hint */}
              <p className="text-[10px]" style={{ color: "rgba(129,140,248,0.5)" }}>
                {voiceHint}
              </p>
            </div>
          )}

          {/* Tips output */}
          {(genState === "streaming" || genState === "done") && tipsText && (
            <div className="flex flex-col gap-2">
              <div
                ref={tipsRef}
                className="rounded-xl px-4 py-3 text-sm leading-relaxed overflow-y-auto"
                style={{
                  background: "rgba(108,99,255,0.06)",
                  border: "1px solid rgba(108,99,255,0.18)",
                  color: "#e2e4f0",
                  maxHeight: "240px",
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--font-sans)",
                }}
              >
                {tipsText}
                {genState === "streaming" && (
                  <span
                    className="inline-block w-1.5 h-4 ml-0.5 rounded-sm align-middle"
                    style={{
                      background: "#818cf8",
                      animation: "pulse 1s ease-in-out infinite",
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          {genState === "error" && (
            <p className="text-[12px] text-center" style={{ color: "#f87171" }}>
              {t("tips.tips_error")}
            </p>
          )}

          {/* Loading state */}
          {genState === "loading" && (
            <div className="flex flex-col items-center gap-2 py-4">
              {/* Pulsing orb */}
              <div
                className="w-10 h-10 rounded-full"
                style={{
                  background: "linear-gradient(135deg,#6c63ff,#38bdf8)",
                  boxShadow: "0 0 24px rgba(108,99,255,0.5)",
                  animation: "pulse 1.2s ease-in-out infinite",
                }}
              />
              <p className="text-[11px]" style={{ color: "rgba(129,140,248,0.6)" }}>
                {t("tips.generating")}
              </p>
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <div
          className="shrink-0 px-5 py-4 flex items-center gap-2"
          style={{ borderTop: "1px solid rgba(108,99,255,0.1)" }}
        >
          {/* Generate / retry */}
          {canGenerate && (
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white tracking-wide"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "linear-gradient(135deg,#6c63ff,#38bdf8)",
                boxShadow: "0 0 20px rgba(108,99,255,0.35)",
                letterSpacing: "0.04em",
              }}
            >
              {genState === "error" ? t("tips.retry") : t("tips.generate")}
            </button>
          )}

          {/* Copy — only when done */}
          {genState === "done" && tipsText && (
            <button
              onClick={copyTips}
              className="py-2.5 px-4 rounded-xl font-bold text-[12px]"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "rgba(108,99,255,0.1)",
                color: "#818cf8",
                border: "1px solid rgba(108,99,255,0.25)",
              }}
            >
              {copied ? t("tips.copied") : t("tips.copy")}
            </button>
          )}

          {/* Close — when done streaming */}
          {(genState === "done" || genState === "streaming") && (
            <button
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl font-bold text-[12px]"
              style={{
                fontFamily: "var(--font-barlow)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(226,228,240,0.5)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {t("tips.close")}
            </button>
          )}
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes bounce {
          from { transform: scaleY(0.6); }
          to   { transform: scaleY(1.4); }
        }
      `}</style>
    </div>
  );
}
