import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

import AppShell from "@/components/app-shell";

export const metadata: Metadata = {
  title: "unfold",
  description: "A quiet canvas for ideas, concepts, and thoughts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={GeistSans.className}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
