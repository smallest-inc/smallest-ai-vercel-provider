import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __PACKAGE_VERSION__: JSON.stringify(
      process.env.npm_package_version ?? '0.0.0-dev',
    ),
  },
});
