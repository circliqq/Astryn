import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider, themeScript } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Astryn",
  description: "Smart NFT mint automation and monitoring for OpenSea Drops on Base and Ethereum."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // No className="dark" here — the anti-FOUC script below sets it from localStorage
    // before React hydrates, so there's no flash of wrong theme.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: apply saved theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <QueryProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
