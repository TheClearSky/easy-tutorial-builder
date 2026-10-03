import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

// Library build: four entries (core, react, schema, remote), ES + CJS.
// Declarations are emitted per source file (not rolled): each subpath's
// `types` points at `dist/<entry>/index.d.ts`, or `dist/index.d.ts`.
//
// Externals: react (optional peer, only `./react` imports it) and zod
// (optional peer, only `./schema` and `./remote` import it).
export default defineConfig({
  plugins: [dts({ tsconfigPath: './tsconfig.json', exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx'] })],
  build: {
    lib: {
      entry: {
        index: 'src/index.ts',
        react: 'src/react/index.ts',
        schema: 'src/schema/index.ts',
        remote: 'src/remote/index.ts',
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'zod'],
    },
    sourcemap: false,
    emptyOutDir: true,
  },
  test: {
    environment: 'node',
  },
});
