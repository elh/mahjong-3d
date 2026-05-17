import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function debugEnabled(): boolean {
  const value = process.env.DEBUG?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/mahjong-3d/" : "/",
  define: {
    __DEBUG_MODE_ENABLED__: JSON.stringify(debugEnabled()),
  },
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
    },
  },
}));
