import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/mahjong-3d/" : "/",
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
    },
  },
}));
