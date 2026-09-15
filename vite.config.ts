import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ root: 'web', plugins: [tailwindcss()], build: { outDir: '../dist/web', emptyOutDir: true, sourcemap: false } });
