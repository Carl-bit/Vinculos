/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Necesario para la imagen Docker del silo: build standalone, sin node_modules.
  output: 'standalone',
};

export default nextConfig;
