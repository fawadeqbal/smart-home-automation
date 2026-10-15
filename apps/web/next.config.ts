import type { NextConfig } from 'next';
import path from 'node:path';

// The browser calls /api/... on this same site; Next forwards it to the NestJS API.
// (In the cloud, Traefik sends /api straight to the API and this is not used.)
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  // The assistant's first answer can take a while (the AI model and the voice load): wait up to 3 minutes.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};

export default config;
