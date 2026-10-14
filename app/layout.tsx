import type { Metadata } from "next";
import { connection } from "next/server";
import { PreviewAuthProvider } from "@/components/auth/preview-auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Untold — Some things are just between us.",
  description:
    "Untold is an early product concept for thoughtful, private messaging. See what we are building and how we approach privacy.",
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
        <PreviewAuthProvider>{children}</PreviewAuthProvider>
      </body>
    </html>
  );
}
