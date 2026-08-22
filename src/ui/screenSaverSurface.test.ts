import { describe, expect, test } from "bun:test";
import {
  initialScreenSaverLifecycle,
  postScreenSaverDiagnostic,
  readNativeScreenSaverState,
  screenSaverFrameTimestampFromEvent,
  screenSaverRuntimeOptions,
  screenSaverSurfaceFromSearch,
} from "./screenSaverSurface";

describe("screen saver surface", () => {
  test("selects the screen saver surface from the URL", () => {
    expect(screenSaverSurfaceFromSearch("?surface=screensaver")).toEqual({
      surface: "screensaver",
      preview: false,
    });
    expect(
      screenSaverSurfaceFromSearch("?surface=screensaver&preview=1"),
    ).toEqual({
      surface: "screensaver",
      preview: true,
    });
    expect(screenSaverSurfaceFromSearch("?view=debug")).toBeUndefined();
    expect(screenSaverSurfaceFromSearch("?surface=unknown")).toBeUndefined();
  });

  test("keeps normal web playback at the existing render profile", () => {
    expect(
      screenSaverRuntimeOptions({
        config: undefined,
        lifecycle: { active: true, preview: false },
        documentHidden: false,
      }),
    ).toMatchObject({
      isScreenSaver: false,
      isPreview: false,
      isSurfaceActive: true,
      isPlaybackActive: true,
      allowInitialRenderWhilePaused: false,
      preloadEnabled: true,
      workerEnabled: true,
      tableFlipTransitionsEnabled: true,
      nativeFrameDriverEnabled: false,
      renderDpr: [1, 1.75],
    });
  });

  test("keeps fullscreen screen saver active despite native lifecycle noise", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: { active: false, preview: false },
        documentHidden: false,
      }).isSurfaceActive,
    ).toBe(true);
  });

  test("uses the cheap preview profile", () => {
    const config = screenSaverSurfaceFromSearch(
      "?surface=screensaver&preview=1",
    );
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: initialScreenSaverLifecycle(config),
        documentHidden: false,
      }),
    ).toMatchObject({
      isScreenSaver: true,
      isPreview: true,
      isPlaybackActive: true,
      allowInitialRenderWhilePaused: true,
      preloadEnabled: false,
      workerEnabled: false,
      tableFlipTransitionsEnabled: false,
      nativeFrameDriverEnabled: true,
      renderDpr: [1, 1],
    });
  });

  test("uses the full-quality fullscreen screen saver profile", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: initialScreenSaverLifecycle(config),
        documentHidden: false,
      }),
    ).toMatchObject({
      isScreenSaver: true,
      isPreview: false,
      isPlaybackActive: true,
      allowInitialRenderWhilePaused: true,
      preloadEnabled: true,
      workerEnabled: false,
      tableFlipTransitionsEnabled: true,
      nativeFrameDriverEnabled: true,
      renderDpr: [1, 1.75],
    });
  });

  test("bootstraps lifecycle from the native screen saver global", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    const nativeState = { __mahjongScreenSaverNativeState: { active: false } };
    expect(
      initialScreenSaverLifecycle(
        config,
        readNativeScreenSaverState(nativeState),
      ),
    ).toEqual({
      active: false,
      preview: false,
    });
  });

  test("ignores malformed native screen saver globals", () => {
    expect(
      readNativeScreenSaverState({
        __mahjongScreenSaverNativeState: { active: "yes", preview: 1 },
      }),
    ).toEqual({
      active: undefined,
      preview: undefined,
    });
  });

  test("reads native frame timestamps from custom events", () => {
    expect(
      screenSaverFrameTimestampFromEvent(
        new CustomEvent("mahjong-screen-saver-frame", {
          detail: { timestampMs: 1234 },
        }),
        500,
      ),
    ).toBe(1234);
    expect(
      screenSaverFrameTimestampFromEvent(
        new CustomEvent("mahjong-screen-saver-frame", {
          detail: { timestampMs: "soon" },
        }),
        500,
      ),
    ).toBe(500);
  });

  test("forwards diagnostics to the native screen saver log bridge", () => {
    const messages: string[] = [];
    postScreenSaverDiagnostic("scene visible", {
      webkit: {
        messageHandlers: {
          mahjong3DLog: {
            postMessage: (message: string) => messages.push(message),
          },
        },
      },
    });
    postScreenSaverDiagnostic("ignored without a native bridge", {});

    expect(messages).toEqual(["web: scene visible"]);
  });

  test("keeps initial rendering allowed while the screen saver is inactive", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: { active: false, preview: false },
        documentHidden: false,
      }),
    ).toMatchObject({
      isSurfaceActive: true,
      isPlaybackActive: true,
      allowInitialRenderWhilePaused: true,
    });
  });

  test("keeps fullscreen screen saver playback active when WebKit marks the document hidden", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: { active: false, preview: false },
        documentHidden: true,
      }),
    ).toMatchObject({
      isSurfaceActive: true,
      isPlaybackActive: true,
    });
  });

  test("pauses inactive thumbnail preview playback", () => {
    const config = screenSaverSurfaceFromSearch(
      "?surface=screensaver&preview=1",
    );
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: { active: false, preview: true },
        documentHidden: false,
      }),
    ).toMatchObject({
      isSurfaceActive: false,
      isPlaybackActive: false,
    });
  });
});
