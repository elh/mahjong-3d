import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const screenSaverExcludedPublicAssets = ["social-preview.png", ".DS_Store"];

function excludeScreenSaverPublicAssets(): Plugin {
  let outputDirectory: string;

  return {
    name: "exclude-screen-saver-public-assets",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await Promise.all(
        screenSaverExcludedPublicAssets.map((asset) =>
          rm(resolve(outputDirectory, asset), { force: true }),
        ),
      );
    },
  };
}

function debugEnabled(): boolean {
  const value = process.env.DEBUG?.trim().toLowerCase();
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

export default defineConfig(({ command, mode }) => {
  const isScreenSaverBuild = mode === "screensaver";

  return {
    base:
      command === "build" ? (isScreenSaverBuild ? "./" : "/mahjong-3d/") : "/",
    build: {
      outDir: isScreenSaverBuild ? "dist-screensaver" : "dist",
    },
    define: {
      __DEBUG_MODE_ENABLED__: JSON.stringify(debugEnabled()),
    },
    plugins: [
      react(),
      ...(isScreenSaverBuild ? [excludeScreenSaverPublicAssets()] : []),
    ],
    server: {
      watch: {
        usePolling: true,
      },
    },
  };
});
