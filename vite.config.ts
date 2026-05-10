import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/concealed-gang/" : "/",
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
    },
  },
}));
