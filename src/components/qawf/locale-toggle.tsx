"use client";

import { useTranslation } from "react-i18next";
import { changeLocale, getLocalePreference } from "@/i18n";
import { useEffect, useState } from "react";

export function LocaleToggle() {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<string>("en-US");

  useEffect(() => {
    const pref = getLocalePreference();
    setLocale(pref === "system" ? navigator.language.startsWith("zh") ? "zh-CN" : "en-US" : pref);
  }, []);

  function toggle() {
    const next = locale === "en-US" ? "zh-CN" : "en-US";
    setLocale(next);
    changeLocale(next);
  }

  return (
    <button
      onClick={toggle}
      className="text-[10px] px-2 py-1 rounded-sm font-semibold tracking-wider uppercase"
      style={{
        fontFamily: "var(--font-barlow)",
        color: "#3B38EB",
        border: "1px solid rgba(59,56,235,0.4)",
        background: "transparent",
        cursor: "pointer",
        transition: "background 200ms ease",
      }}
      aria-label={t("language.label")}
    >
      {locale === "zh-CN" ? t("language.enUS") : t("language.zhCN")}
    </button>
  );
}
