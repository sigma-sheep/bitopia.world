import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// envDir points at the repo root so the single root-level .env is loaded
// (Vite otherwise only reads .env from the client/ project root).
export default defineConfig({ plugins: [react()], envDir: "../" });
