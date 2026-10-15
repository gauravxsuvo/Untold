import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { AccountSessionProvider } from "@/components/auth/account-session-provider";
import { InstallPromptProvider } from "@/components/pwa/install-prompt-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { isTheme, themeColors, themeCookieName } from "@/lib/ui/theme";
import { ReadabilityProvider } from "@/components/theme/readability-provider";
import { BackgroundDelivery } from "@/components/messaging/background-delivery";
import { NotificationSessionSync } from "@/components/pwa/notification-settings";
import { fontSizeCookie, zoomCookie, isFontSize, isInterfaceZoom } from "@/lib/ui/readability";
import "./globals.css";
import "./themes.css";
import "./profile.css";
import "./security.css";
import "./improvements.css";
import "./conversation-layout.css";
import "./membership-media.css";
import "./groups.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://untold.portways.app"),
  title: "Untold | Some things are just between us.",
  description:
    "A quiet place for your conversations. Add a friend, share a moment, and keep in touch with Untold.",
  applicationName: "Untold",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Untold",
    title: "Some things are just between us.",
    description:
      "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Some things are just between us.",
    description:
      "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Untold",
  },
  icons: {
    icon: [
      { url: "/icons/untold-app-icon.svg?v=2", type: "image/svg+xml" },
      { url: "/icons/untold-192.png?v=2", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" }],
  },
};

export async function generateViewport(): Promise<Viewport> {
  const preference = (await cookies()).get(themeCookieName)?.value;
  return {
    interactiveWidget: "resizes-content",
    themeColor: isTheme(preference)
      ? themeColors[preference]
      : [
          { media: "(prefers-color-scheme: light)", color: themeColors.light },
          { media: "(prefers-color-scheme: dark)", color: themeColors.dark },
        ],
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const preference = (await cookies()).get(themeCookieName)?.value;
  const initialTheme = isTheme(preference) ? preference : null;
  const saved = await cookies();
  const font = saved.get(fontSizeCookie)?.value;
  const zoom = saved.get(zoomCookie)?.value;
  const initial = {
    fontSize: isFontSize(font) ? font : "default",
    zoom: isInterfaceZoom(zoom) ? zoom : "100",
  };

  return (
    <html
      data-theme={initialTheme ?? undefined}
      data-font-size={initial.fontSize}
      data-interface-zoom={initial.zoom}
      lang="en"
    >
      <body className="min-h-screen antialiased">
        <ThemeProvider initialTheme={initialTheme}>
          <ReadabilityProvider initial={initial}>
            <AccountSessionProvider>
              <BackgroundDelivery />
              <NotificationSessionSync />
              <InstallPromptProvider>{children}</InstallPromptProvider>
            </AccountSessionProvider>
          </ReadabilityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
