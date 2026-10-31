import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Mono, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-syne" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-jakarta" });
const mono = Space_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Job Agent",
  description: "Find, craft and apply — with your approval at every step.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${jakarta.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
