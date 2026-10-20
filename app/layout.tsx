import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Geist_Mono, Nunito } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Atkinson Hyperlegible was drawn for readers with low vision; many of the
// people doing follow-up are older volunteers on small phones.
const bodyFont = Atkinson_Hyperlegible_Next({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Headings and the day's greeting: rounded and soft.
const displayFont = Nunito({
  variable: "--font-display",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GatherFlow · Church membership and follow-up",
  description:
    "Church membership records, first-time visitor follow-up, attendance, messaging and pastoral care — with consent first and roles the server enforces.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
