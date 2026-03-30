import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/chat": {
        target: "http://localhost:5000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/chat/, "/api/chat"),
      },
      "/video_feed_front": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/feedback": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/get_scores": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
