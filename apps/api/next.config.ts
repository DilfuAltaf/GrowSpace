import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@growspace/shared'],
  // @node-rs/argon2 ships platform-specific native binaries and must be required
  // at runtime instead of being bundled into the server output.
  serverExternalPackages: ['@node-rs/argon2'],
};

export default nextConfig;
