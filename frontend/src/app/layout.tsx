import type { Metadata } from 'next';
import { Caveat, Figtree, Nunito } from 'next/font/google';
import localFont from 'next/font/local';

import { ProveedorNombreCentro } from '@/components/shared/Marca';
import { Proveedores } from '@/components/shared/Proveedores';
import { nombreDelSilo, urlDelSilo } from '@/lib/identidadSilo';
import { temaDelSilo } from '@/lib/tema';

import './globals.css';

/** Figtree: next/font la descarga al compilar y la sirve desde el mismo origen (el navegador no llama a Google). */
const figtree = Figtree({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-figtree',
  display: 'swap',
  preload: true,
});
/** Tema Cuaderno (app/temas/cuaderno.css): Nunito de lectura y Caveat en titulos. Sin precarga (next/font exige literales): el navegador las baja solo si el tema las usa. */
const nunito = Nunito({ subsets: ['latin'], variable: '--font-nunito', display: 'swap', preload: false });
const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat', display: 'swap', preload: false });

/**
 * Iconos (03b-6): Material Symbols Rounded alojada en el repo y recortada a los
 * glifos de lib/iconos.ts (scripts/descargar-iconos.mjs). Ningun pedido a Google,
 * tampoco en vistas clinicas. Ejes de peso y relleno variables, como antes.
 */
const iconos = localFont({
  src: './fuentes/material-symbols-rounded.woff2',
  variable: '--font-iconos',
  weight: '400 700',
  display: 'block',
  preload: true,
});

/**
 * R11: nombre, tema y dominio del centro se leen en runtime (la imagen
 * vinculos-web es la misma para todos los silos).
 */
export async function generateMetadata(): Promise<Metadata> {
  const nombre = await nombreDelSilo();
  return {
    // Dominio del silo (SITE_URL del .env): resuelve a URL absoluta las imagenes de
    // Open Graph relativas (foto del profesional al compartir su perfil).
    metadataBase: new URL(urlDelSilo()),
    title: { default: nombre, template: `%s | ${nombre}` },
    description: 'Portal del centro clinico.',
  };
}

/**
 * Layout raiz, compartido por (publico), (portal) y (admin). El shell visual
 * de cada zona vive en components/shared/Layout*.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [tema, nombre] = await Promise.all([temaDelSilo(), nombreDelSilo()]);
  return (
    // Tema del silo (TEMA del .env, runtime): los tokens de cada tema cuelgan de :root[data-tema].
    <html lang="es" data-tema={tema} className={`${figtree.variable} ${nunito.variable} ${caveat.variable} ${iconos.variable}`}>
      <body>
        {/* 03b-6: primer foco de cada pagina; salta el menu y lleva al <main id="contenido"> de la zona. */}
        <a
          href="#contenido"
          className="sr-only z-[200] rounded-full bg-tinta px-5 py-3 font-bold text-neutral-100 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:text-neutral-100"
        >
          Saltar al contenido
        </a>
        <ProveedorNombreCentro nombre={nombre}>
          <Proveedores>{children}</Proveedores>
        </ProveedorNombreCentro>
      </body>
    </html>
  );
}
