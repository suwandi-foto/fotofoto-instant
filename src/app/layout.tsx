import type { Metadata } from "next";
import "./globals.css";

// Loaded via a plain <link> rather than next/font/google: next/font
// fetches font files at BUILD time, which fails in network-restricted
// build environments (this sandbox included). A runtime <link> is
// what the confirmed design canvas mockups use too, and degrades
// gracefully to the system-ui fallback in globals.css if the font
// host is ever unreachable for a viewer.
export const metadata: Metadata = {
  title: "FOTOFOTO Instant Delivery",
  description: "Instant event photo delivery — capture, edit, and share in real time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text">{children}</body>
    </html>
  );
}
