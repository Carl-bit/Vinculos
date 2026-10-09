import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: process.env.NEXT_PUBLIC_CENTRO_NOMBRE ?? 'Centro de Prueba',
    template: `%s | ${process.env.NEXT_PUBLIC_CENTRO_NOMBRE ?? 'Centro de Prueba'}`,
  },
  description: 'Portal del centro clinico.',
};

/**
 * Layout raiz, compartido por los grupos (publico) y (admin).
 * Intencionalmente minimo: el shell visual de cada zona vive en
 * `components/shared/LayoutPublico` y `components/shared/LayoutAdmin`,
 * que salen del handoff de Claude Design (prompt 03_front.md).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
