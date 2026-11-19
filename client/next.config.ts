import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '..'),
  // Oxlint runs through pnpm check:client instead of Next.js's ESLint integration.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
