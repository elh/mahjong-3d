/**
 * Centralizes the native screen saver surface contract so the React app can keep
 * normal web playback worker-backed and requestAnimationFrame-driven, while the
 * macOS ScreenSaver host can opt into local-file-safe generation and native
 * frame delivery. The fullscreen saver intentionally ignores some WebKit
 * visibility/lifecycle noise because the legacy saver host can report the
 * document hidden or briefly inactive while it is still the visible renderer.
 */
export type ScreenSaverSurfaceConfig = {
  surface: "screensaver";
  preview: boolean;
};

export type ScreenSaverLifecycle = {
  active: boolean;
  preview: boolean;
};

export const screenSaverFrameEventName = "mahjong-screen-saver-frame";
const defaultRenderDpr: [number, number] = [1, 1.75];
const previewRenderDpr: [number, number] = [1, 1];

export type ScreenSaverFrameEventDetail = {
  timestampMs: number;
};

export type ScreenSaverBridge = {
  setActive(active: boolean): void;
  setPreview(preview: boolean): void;
  renderFrame?(timestampMs: number): void;
};

export type ScreenSaverRuntimeOptions = {
  isScreenSaver: boolean;
  isPreview: boolean;
  isSurfaceActive: boolean;
  isPlaybackActive: boolean;
  allowInitialRenderWhilePaused: boolean;
  preloadEnabled: boolean;
  workerEnabled: boolean;
  tableFlipTransitionsEnabled: boolean;
  renderDpr: [number, number];
};

export type NativeScreenSaverState = Partial<ScreenSaverLifecycle>;

export function screenSaverSurfaceFromSearch(
  search: string,
): ScreenSaverSurfaceConfig | undefined {
  const params = new URLSearchParams(search);
  const surface = params.get("surface");
  if (surface !== "screensaver") {
    return undefined;
  }
  return {
    surface,
    preview: params.get("preview") === "1",
  };
}

export function initialScreenSaverLifecycle(
  config: ScreenSaverSurfaceConfig | undefined,
  nativeState = readNativeScreenSaverState(),
): ScreenSaverLifecycle {
  return {
    active: nativeState.active ?? true,
    preview: nativeState.preview ?? config?.preview ?? false,
  };
}

export function readNativeScreenSaverState(
  source: unknown = globalThis,
): NativeScreenSaverState {
  const state = (source as { __mahjongScreenSaverNativeState?: unknown })
    .__mahjongScreenSaverNativeState;
  if (!state || typeof state !== "object") {
    return {};
  }

  const { active, preview } = state as Partial<
    Record<keyof ScreenSaverLifecycle, unknown>
  >;
  return {
    active: typeof active === "boolean" ? active : undefined,
    preview: typeof preview === "boolean" ? preview : undefined,
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
  const isFullscreenScreenSaver = isScreenSaver && !isPreview;
  const isSurfaceActive =
    isFullscreenScreenSaver ||
    ((!isScreenSaver || lifecycle.active) && !documentHidden);
  const isPlaybackActive =
    isFullscreenScreenSaver ||
    ((!isScreenSaver || lifecycle.active) && !documentHidden);
  return {
    isScreenSaver,
    isPreview,
    isSurfaceActive,
    isPlaybackActive,
    allowInitialRenderWhilePaused: isScreenSaver,
    preloadEnabled: !isScreenSaver || isFullscreenScreenSaver,
    workerEnabled: !isScreenSaver,
    tableFlipTransitionsEnabled: !isScreenSaver || !isPreview,
    renderDpr: isPreview ? previewRenderDpr : defaultRenderDpr,
  };
}

export function screenSaverFrameTimestampFromEvent(
  event: Event,
  fallbackTimestampMs: number,
): number {
  if (!(event instanceof CustomEvent)) {
    return fallbackTimestampMs;
  }

  const detail: unknown = event.detail;
  if (
    !detail ||
    typeof detail !== "object" ||
    !("timestampMs" in detail) ||
    typeof detail.timestampMs !== "number"
  ) {
    return fallbackTimestampMs;
  }

  return detail.timestampMs;
}
