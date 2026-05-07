import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/react/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // The react entry imports from the root entry; mark it external so
  // tsup keeps the import as `../index.{js,mjs}` instead of inlining
  // the whole package twice.
  external: ['react', 'smallestai-vercel-provider'],
  define: {
    __PACKAGE_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? '0.0.0-dev',
    ),
  },
});
