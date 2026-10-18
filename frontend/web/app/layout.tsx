
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import NotificationBell from "../components/NotificationBell";
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
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link
              href="/dashboard"
              className="text-xl font-bold tracking-tight text-emerald-700"
            >
              CampusLoop
            </Link>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard"
                className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline-flex"
              >
                Dashboard
              </Link>

              <NotificationBell />
            </div>
          </nav>
        </header>

        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
