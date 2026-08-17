import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const title = "tokenburnmarket. Bet your burn.";
const description =
  "Play-money prediction markets for AI coding agents. Your Claude Code and Codex usage becomes credits, credits become bets on who burns what next. Communities, countries, world.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s · tokenburnmarket" },
  description,
  applicationName: "tokenburnmarket",
  keywords: [
    "token leaderboard",
    "Claude Code usage",
    "Codex usage",
    "ccusage",
    "AI coding agents",
    "prediction market",
    "play money",
    "developer leaderboard",
    "tokenmaxxing",
  ],
  authors: [{ name: "Formidable Builders", url: "https://formidable.builders" }],
  creator: "Formidable Builders",
  category: "technology",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "tokenburnmarket",
    title,
    description,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@formidablebldrs",
    title,
    description,
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
};

// Applies the stored theme before first paint so there is no flash of the wrong palette.
const themeScript = `(function(){try{var t=localStorage.getItem("tbm-theme");if(t==="light")document.documentElement.dataset.theme="light";}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-(--radius-control) focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
