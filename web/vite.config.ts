import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// VITE_BASE: "/" for a custom domain, "/<repo>/" for https://<user>.github.io/<repo>/
export default defineConfig({ plugins: [react()], base: process.env.VITE_BASE || "/" });
