import { describe, expect, test } from "bun:test";
import {
  initialScreenSaverLifecycle,
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
      preloadEnabled: true,
      workerEnabled: true,
      tableFlipTransitionsEnabled: true,
      renderDpr: [1, 1.75],
    });
  });

  test("pauses the screen saver surface when native lifecycle stops it", () => {
    const config = screenSaverSurfaceFromSearch("?surface=screensaver");
    expect(
      screenSaverRuntimeOptions({
        config,
        lifecycle: { active: false, preview: false },
        documentHidden: false,
      }).isSurfaceActive,
    ).toBe(false);
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
      preloadEnabled: false,
      workerEnabled: false,
      tableFlipTransitionsEnabled: false,
      renderDpr: [1, 1],
    });
  });

  test("uses the conservative fullscreen screen saver profile", () => {
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
      preloadEnabled: false,
      workerEnabled: false,
      tableFlipTransitionsEnabled: false,
      renderDpr: [1, 1],
    });
  });
});
