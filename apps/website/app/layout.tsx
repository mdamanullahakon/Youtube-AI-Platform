import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'YouTube AI Platform - Autonomous Content OS',
  description: 'Full autonomous AI-powered YouTube growth platform. Research, generate, render, optimize, and publish viral content automatically.',
  keywords: ['youtube ai', 'ai content', 'video generation', 'autonomous', 'youtube growth'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  );
}
