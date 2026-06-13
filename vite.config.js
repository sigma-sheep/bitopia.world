import { defineConfig } from "vite";

// Project root is the repo root: index.html lives here and pulls in
// /src/client/main.js. Kept minimal on purpose — expand as the app grows.
export default defineConfig({
  server: {
    open: true,
  },
});
