/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 03b-6: las pruebas movil/3G compilan aparte (NEXT_DIST_DIR) sin pisar el .next del dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // El build movil escribe sus tipos en su propio tsconfig (no reescribe tsconfig.json).
  typescript: process.env.NEXT_DIST_DIR ? { tsconfigPath: 'tsconfig.movil.json' } : undefined,
  // El indicador de desarrollo tapa el bloque de usuario del sidebar.
  devIndicators: false,
  // Necesario para la imagen Docker del silo: build standalone, sin node_modules.
  output: 'standalone',
  // 03b-6: fotos publicas del equipo optimizadas (AVIF o WebP segun el navegador).
  // Solo las imagenes publicas de la API pasan por el optimizador; las privadas no.
  images: {
    formats: ['image/avif', 'image/webp'],
    localPatterns: [{ pathname: '/api/publico/imagenes/**' }],
  },
  // El repo tiene otro lockfile en la raiz (npm run dev): la app es esta carpeta.
  outputFileTracingRoot: import.meta.dirname,
  // Desarrollo: /api/* se sirve desde el mismo origen del front. En el silo
  // Traefik ya enruta /api al backend antes de llegar aca.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:3001'}/api/:path*` }];
  },
};

export default nextConfig;
