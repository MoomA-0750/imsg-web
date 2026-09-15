import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: 'web',
  plugins: [tailwindcss()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    // The AudioWorklet module has to stay a file: the audio thread fetches it by URL, and a data:
    // URL is neither fetchable that way nor allowed by the page's script-src.
    assetsInlineLimit: (file: string) => (file.endsWith('pcm-worklet.js') ? false : undefined),
  },
});
