import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Treasurer — Group Expenses",
  description:
    "Simple group expense tracker for splitting bills and settling up.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
