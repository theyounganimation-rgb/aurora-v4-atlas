import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aurora V4 Architecture Atlas",
  description:
    "An interactive semantic-zoom study map of Aurora V4: voice, continuity, inner life, delegated action, evidence, and migration boundaries.",
  openGraph: {
    title: "Aurora V4 Architecture Atlas",
    description: "Explore how Aurora hears, remembers, reflects, acts, and proves what happened.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1536,
        height: 1024,
        alt: "An abstract night-cartography map of Aurora V4's connected architecture systems",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aurora V4 Architecture Atlas",
    description: "Explore how Aurora hears, remembers, reflects, acts, and proves what happened.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
