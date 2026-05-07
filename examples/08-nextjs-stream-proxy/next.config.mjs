/** @type {import('next').NextConfig} */
const nextConfig = {
  // ws ships with optional native bindings (bufferutil, utf-8-validate)
  // that webpack's bundler can't resolve correctly. Mark the SDK and ws
  // as server-external so Next loads them via require() at runtime.
  serverExternalPackages: ['smallestai-vercel-provider', 'ws'],
};

export default nextConfig;
