import type { Metadata } from 'next';
import { Figtree } from 'next/font/google';

import { Proveedores } from '@/components/shared/Proveedores';
import { NOMBRE_CENTRO } from '@/components/shared/Marca';

import { URL_ICONOS } from '@/lib/iconos';

import './globals.css';

/** Figtree: next/font la descarga al compilar y la sirve desde el mismo origen (el navegador no llama a Google). */
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800', '900'], variable: '--font-figtree', display: 'swap' });

export const metadata: Metadata = {
  title: { default: NOMBRE_CENTRO, template: `%s | ${NOMBRE_CENTRO}` },
  description: 'Portal del centro clinico.',
};

/**
 * Layout raiz, compartido por (publico), (portal) y (admin). El shell visual
 * de cada zona vive en components/shared/Layout*.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={figtree.variable}>
      <head>
        {/* Iconos: no estan en el catalogo de next/font. Solo los glifos de lib/iconos.ts. */}
        <link rel="stylesheet" href={URL_ICONOS} />
      </head>
      <body>
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  );
}
