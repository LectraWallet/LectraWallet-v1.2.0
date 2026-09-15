import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

function vitePluginCsp(): Plugin {
  const developmentCsp =
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 ws://localhost:3000; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://mempool.space ws://localhost:3000; media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'";
  return {
    name: "lectra-csp",
    transformIndexHtml(html, context) {
      return context.server
        ? html.replace(
            /content="default-src 'self';[^\"]+"/,
            `content="${developmentCsp}"`
          )
        : html;
    },
  };
}

export default defineConfig({
  plugins: [react(), vitePluginCsp()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    manifest: true,
  },
  server: {
    port: 3000,
    strictPort: false,
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: { strict: true, deny: ["**/.*"] },
  },
});
