import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";

export const metadata: Metadata = {
  title: "Agam Paper Trading | Global Multi-Asset Trading & Analytics",
  description:
    "Open-source institutional multi-tenant paper trading platform and corporate fundamentals workspace across Global Equities, Commodities, Bonds, Crypto 24/7, and Forex 24/5.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[#FFFFFF] text-[#131722] antialiased selection:bg-[#2962FF]/15 selection:text-[#131722]">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
