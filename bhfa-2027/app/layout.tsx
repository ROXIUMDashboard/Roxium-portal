import type { Metadata, Viewport } from 'next';
import { Bitter, IBM_Plex_Mono, Inclusive_Sans } from 'next/font/google';
import '@/styles/globals.css';

/**
 * Brand typography.
 *
 * The BHFA brand kit specifies Superclarendon (H1), Lenia Mono (H2 + buttons)
 * and Inclusive Sans (body). Superclarendon ships with macOS and Lenia Mono is
 * a licensed face, so both are listed first in the stacks below and render
 * natively wherever they are installed. The self-hosted Google faces are the
 * closest public equivalents and guarantee the same rhythm everywhere else.
 */
const display = Bitter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display-fallback',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono-fallback',
  display: 'swap',
});

const body = Inclusive_Sans({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-body-fallback',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BHFA 2027 · Working Scientific Program',
  description: 'Beverly Hills Face Academy — 2027 scientific program planning room.',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#F4EEDF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
