import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Two entry pages so phones never download table-only code:
// "/" is the table screen, "/play/" is the phone controller.
export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        table: resolve(__dirname, "index.html"),
        play: resolve(__dirname, "play/index.html"),
      },
    },
  },
});
