import { useEffect, useRef, useState } from "react";
import {
  sceneTransitionFadeMs,
  sceneTransitionSample,
} from "../sceneTransition";
import {
  screenSaverFrameEventName,
  screenSaverFrameTimestampFromEvent,
} from "../screenSaverSurface";

export function SceneTransitionOverlay({
  covered,
  nativeFrameDriver,
  onRevealed,
}: {
  covered: boolean;
  nativeFrameDriver: boolean;
  onRevealed?: () => void;
}) {
  const [opacity, setOpacity] = useState(covered ? 1 : 0);
  const opacityRef = useRef(opacity);
  const onRevealedRef = useRef(onRevealed);

  useEffect(() => {
    onRevealedRef.current = onRevealed;
  }, [onRevealed]);

  useEffect(() => {
    const targetOpacity = covered ? 1 : 0;
    const startOpacity = opacityRef.current;
    if (startOpacity === targetOpacity) {
      return;
    }

    let startedAtMs: number | undefined;
    let animationFrame: number | undefined;
    let completed = false;

    const sample = (timestampMs: number) => {
      startedAtMs ??= timestampMs;
      const next = sceneTransitionSample({
        startOpacity,
        targetOpacity,
        elapsedMs: timestampMs - startedAtMs,
        durationMs: sceneTransitionFadeMs,
      });
      opacityRef.current = next.opacity;
      setOpacity(next.opacity);

      if (!next.complete) {
        return;
      }

      completed = true;
      if (targetOpacity === 0) {
        onRevealedRef.current?.();
      }
    };

    if (nativeFrameDriver) {
      const handleNativeFrame = (event: Event) => {
        if (!completed) {
          sample(screenSaverFrameTimestampFromEvent(event, performance.now()));
        }
      };
      window.addEventListener(screenSaverFrameEventName, handleNativeFrame);
      return () => {
        window.removeEventListener(
          screenSaverFrameEventName,
          handleNativeFrame,
        );
      };
    }

    const handleAnimationFrame = (timestampMs: number) => {
      sample(timestampMs);
      if (!completed) {
        animationFrame = window.requestAnimationFrame(handleAnimationFrame);
      }
    };
    animationFrame = window.requestAnimationFrame(handleAnimationFrame);
    return () => {
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [covered, nativeFrameDriver]);

  // Removing a transparent cover is more robust than leaving a composited
  // layer over WKWebView's manually driven WebGL canvas.
  if (!covered && opacity <= 0) {
    return null;
  }

  return (
    <div
      className="round-transition-overlay"
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}
