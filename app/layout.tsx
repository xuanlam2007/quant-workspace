import type { Metadata } from "next";
import "./globals.css";
import "./auditor/auditor.module.css";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";

export const metadata: Metadata = {
  title: "VN30 · live chart",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <WorkspaceTabs />
        {children}
      </body>
    </html>
  );
}
