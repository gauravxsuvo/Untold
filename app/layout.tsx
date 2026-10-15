import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { AccountSessionProvider } from "@/components/auth/account-session-provider";
import { InstallPromptProvider } from "@/components/pwa/install-prompt-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { isTheme, themeColors, themeCookieName } from "@/lib/ui/theme";
import "./globals.css";
import "./themes.css";
import "./profile.css";

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
    description: "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Some things are just between us.",
    description: "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
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
    apple: [
      { url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
    ],
  },
};

export async function generateViewport(): Promise<Viewport> {
  const preference = (await cookies()).get(themeCookieName)?.value;
  return {
    themeColor: isTheme(preference) ? themeColors[preference] : [
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

  return (
    <html data-theme={initialTheme ?? undefined} lang="en">
      <body className="min-h-screen antialiased">
        <ThemeProvider initialTheme={initialTheme}>
          <AccountSessionProvider>
            <InstallPromptProvider>{children}</InstallPromptProvider>
          </AccountSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
