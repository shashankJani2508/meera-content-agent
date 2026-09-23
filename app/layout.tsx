import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Meera Content Agent - how to use',
  description: 'Telegram content assistant for Meera Pillai. Drafts only - never publishes.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
