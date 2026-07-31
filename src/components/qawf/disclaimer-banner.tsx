"use client";

import { useTranslation } from "react-i18next";

export function DisclaimerBanner() {
  const { t } = useTranslation();

  return (
    <div
      className="px-4 py-2 flex flex-col gap-0.5"
      style={{
        background: "rgba(33,39,37,0.06)",
        borderTop: "1px solid rgba(33,39,37,.12)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[9px] font-semibold tracking-widest uppercase px-1.5 py-0.5 rounded-sm"
          style={{
            background: "#DDDEA1",
            color: "#212725",
            fontFamily: "var(--font-barlow)",
          }}
        >
          {t("disclaimer.title")}
        </span>
        <span className="text-[10px] text-brand-muted leading-tight flex-1">
          {t("disclaimer.body")}
        </span>
      </div>
      <span className="text-[9px]" style={{ color: "#5C6264" }}>
        {t("disclaimer.experimental_note")}
      </span>
    </div>
  );
}
