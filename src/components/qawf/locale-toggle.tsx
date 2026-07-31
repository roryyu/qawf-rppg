"use client";

import { useTranslation } from "react-i18next";
import { changeLocale, getLocalePreference } from "@/i18n";
import { useEffect, useState } from "react";

export function LocaleToggle() {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<string>("en-US");

  useEffect(() => {
    const pref = getLocalePreference();
    setLocale(
      pref === "system"
        ? navigator.language.startsWith("zh") ? "zh-CN" : "en-US"
        : pref
    );
  }, []);

  function toggle() {
    const next = locale === "en-US" ? "zh-CN" : "en-US";
    setLocale(next);
    changeLocale(next);
  }

  return (
    <button
      onClick={toggle}
      className="text-[10px] px-2.5 py-1 rounded-lg font-bold tracking-widest uppercase"
      style={{
        fontFamily: "var(--font-ibm-plex-mono)",
        color: "#818cf8",
        border: "1px solid rgba(108,99,255,0.25)",
        background: "rgba(108,99,255,0.06)",
        cursor: "pointer",
        transition: "background 200ms ease, border-color 200ms ease",
      }}
      aria-label={t("language.label")}
    >
      {locale === "zh-CN" ? "EN" : "中"}
    </button>
  );
}
