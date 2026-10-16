/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El indicador de desarrollo tapa el bloque de usuario del sidebar.
  devIndicators: false,
  // Necesario para la imagen Docker del silo: build standalone, sin node_modules.
  output: 'standalone',
  // El repo tiene otro lockfile en la raiz (npm run dev): la app es esta carpeta.
  outputFileTracingRoot: import.meta.dirname,
  // Desarrollo: /api/* se sirve desde el mismo origen del front. En el silo
  // Traefik ya enruta /api al backend antes de llegar aca.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.API_URL ?? 'http://localhost:3001'}/api/:path*` }];
  },
};

export default nextConfig;
