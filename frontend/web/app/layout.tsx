import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import SiteHeader from "../components/site-header/SiteHeader";
import { SiteBarFallback } from "../components/site-header/SiteNav";
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
  title: "CampusLoop",
  description:
    "Share campus resources, find lost items, and collaborate with students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* The header reads session cookies at request time, so it streams in behind this boundary
            while the rest of the page (including static pages) renders without waiting for it. */}
        <Suspense fallback={<SiteBarFallback />}>
          <SiteHeader />
        </Suspense>

        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
