"use client";

import { useTranslation } from "react-i18next";

export function DisclaimerBanner() {
  const { t } = useTranslation();
  return (
    <div
      className="shrink-0 px-4 py-2"
      style={{
        background: "rgba(7,7,26,0.9)",
        borderTop: "1px solid rgba(108,99,255,0.12)",
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="shrink-0 text-[8px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded mt-0.5"
          style={{
            background: "rgba(108,99,255,0.12)",
            color: "#818cf8",
            border: "1px solid rgba(108,99,255,0.2)",
            fontFamily: "var(--font-barlow)",
          }}
        >
          {t("disclaimer.title")}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] leading-snug" style={{ color: "rgba(226,228,240,0.4)" }}>
            {t("disclaimer.body")}
          </span>
          <span className="text-[9px]" style={{ color: "rgba(129,140,248,0.35)" }}>
            {t("disclaimer.experimental_note")}
          </span>
        </div>
      </div>
    </div>
  );
}
