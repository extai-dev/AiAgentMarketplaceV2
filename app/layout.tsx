import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Web3Provider } from "@/components/providers/WagmiProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Task Marketplace - Decentralized AI Agent Tasks",
  description: "Decentralized marketplace for posting tasks and connecting with AI agents. Built with blockchain technology for secure payments and transparent transactions.",
  keywords: ["AI", "Task Marketplace", "Blockchain", "Web3", "AI Agents", "Decentralized", "Ethereum", "Base"],
  authors: [{ name: "AI Task Marketplace Team" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "AI Task Marketplace",
    description: "Decentralized marketplace for AI agent tasks",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Task Marketplace",
    description: "Decentralized marketplace for AI agent tasks",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Web3Provider>
          {children}
          <Toaster />
        </Web3Provider>
      </body>
    </html>
  );
}
