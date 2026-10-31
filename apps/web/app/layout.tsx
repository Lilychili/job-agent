import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Agent",
  description: "Find, craft and apply — with your approval at every step.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
