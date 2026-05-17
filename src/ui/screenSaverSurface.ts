export type ScreenSaverSurfaceConfig = {
  surface: "screensaver";
  preview: boolean;
};

export type ScreenSaverLifecycle = {
  active: boolean;
  preview: boolean;
};

export type ScreenSaverBridge = {
  setActive(active: boolean): void;
  setPreview(preview: boolean): void;
};

export type ScreenSaverRuntimeOptions = {
  isScreenSaver: boolean;
  isPreview: boolean;
  isSurfaceActive: boolean;
  preloadEnabled: boolean;
  workerEnabled: boolean;
  tableFlipTransitionsEnabled: boolean;
  renderDpr: [number, number];
};

export function screenSaverSurfaceFromSearch(
  search: string,
): ScreenSaverSurfaceConfig | undefined {
  const params = new URLSearchParams(search);
  if (params.get("surface") !== "screensaver") {
    return undefined;
  }
  return {
    surface: "screensaver",
    preview: params.get("preview") === "1",
  };
}

export function initialScreenSaverLifecycle(
  config: ScreenSaverSurfaceConfig | undefined,
): ScreenSaverLifecycle {
  return {
    active: true,
    preview: config?.preview ?? false,
  };
}

export function screenSaverRuntimeOptions({
  config,
  lifecycle,
  documentHidden,
}: {
  config: ScreenSaverSurfaceConfig | undefined;
  lifecycle: ScreenSaverLifecycle;
  documentHidden: boolean;
}): ScreenSaverRuntimeOptions {
  const isScreenSaver = config !== undefined;
  const isPreview = isScreenSaver && lifecycle.preview;
  const isSurfaceActive =
    (!isScreenSaver || lifecycle.active) && !documentHidden;
  return {
    isScreenSaver,
    isPreview,
    isSurfaceActive,
    preloadEnabled: !isScreenSaver,
    workerEnabled: !isScreenSaver,
    tableFlipTransitionsEnabled: !isScreenSaver,
    renderDpr: isScreenSaver ? [1, 1] : [1, 1.75],
  };
}

type ScreenSaverWebKitBridge = Window & {
  webkit?: {
    messageHandlers?: {
      mahjong3DLog?: {
        postMessage(message: string): void;
      };
    };
  };
};

export function postScreenSaverDiagnostic(message: string): void {
  const handler = (window as ScreenSaverWebKitBridge).webkit?.messageHandlers
    ?.mahjong3DLog;
  if (!handler) {
    return;
  }

  try {
    handler.postMessage(`web ${message}`);
  } catch {
    // Diagnostics must never affect the screen saver runtime.
  }
}
