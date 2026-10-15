import type { Metadata } from "next";
import { connection } from "next/server";
import { AccountSessionProvider } from "@/components/auth/account-session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Untold — Some things are just between us.",
  description:
    "Untold is a calm home for the conversations that matter. Sign up, add a friend by email, and start talking.",
  applicationName: "Untold",
  icons: {
    icon: "/brand/untold-mark.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AccountSessionProvider>{children}</AccountSessionProvider>
      </body>
    </html>
  );
}
