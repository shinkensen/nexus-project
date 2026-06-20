import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cats vs Sharks",
  description: "A multiplayer game of cat and shark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
