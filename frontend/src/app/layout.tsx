import type { Metadata } from 'next';
import { Figtree } from 'next/font/google';

import { Proveedores } from '@/components/shared/Proveedores';
import { NOMBRE_CENTRO } from '@/components/shared/Marca';

import { URL_ICONOS } from '@/lib/iconos';

import './globals.css';

/** Figtree: next/font la descarga al compilar y la sirve desde el mismo origen (el navegador no llama a Google). */
const figtree = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800', '900'], variable: '--font-figtree', display: 'swap' });

export const metadata: Metadata = {
  // Dominio del silo (build arg en Docker): resuelve a URL absoluta las imagenes de
  // Open Graph relativas (foto del profesional al compartir su perfil).
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
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
        {/* 03b-6: primer foco de cada pagina; salta el menu y lleva al <main id="contenido"> de la zona. */}
        <a
          href="#contenido"
          className="sr-only z-[200] rounded-full bg-tinta px-5 py-3 font-bold text-neutral-100 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:text-neutral-100"
        >
          Saltar al contenido
        </a>
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  );
}
