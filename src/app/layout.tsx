import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Inter, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import { EazoProvider } from "@eazo/sdk/react";
import { cn } from "@/utils/utils";
import { Toaster } from "@/components/ui/sonner";
import { UserSyncEffect } from "@/components/user-profile/user-sync-effect";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { LocaleSyncEffect } from "@/components/i18n/locale-sync-effect";
import { getServerLocale } from "@/lib/i18n/server-preference";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-barlow",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

const SITE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : undefined;

// The platform stamps the real product title/description into .env at scaffold
// time (NEXT_PUBLIC_APP_TITLE / NEXT_PUBLIC_APP_DESCRIPTION). These drive the
// app's <title> / meta description. Fall back to a generic default when unset
// (e.g. local dev before any scaffold values are written).
const SITE_TITLE = process.env.NEXT_PUBLIC_APP_TITLE?.trim() || "Eazo App";
const SITE_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() || "An app build by eazo.ai";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  icons: {
    icon: "https://eazo.ai/favicon.ico",
  },
  openGraph: {
    type: "website",
    siteName: "Eazo",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("h-full antialiased", inter.variable, barlow.variable, ibmPlexMono.variable)}
    >
      <body className="h-full flex flex-col overflow-hidden">
        <I18nProvider>
          <EazoProvider>
            <LocaleSyncEffect />
            <UserSyncEffect />
            {children}
            <Toaster />
          </EazoProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
