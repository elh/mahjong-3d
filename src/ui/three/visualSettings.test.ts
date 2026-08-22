import { describe, expect, test } from "bun:test";
import { defaultVisualDebugSettings } from "./visualSettings";

describe("visual defaults", () => {
  test("uses the approved neutral material finish", () => {
    expect(defaultVisualDebugSettings).toEqual({
      filmGrade: true,
      filmStock: "neutral",
      filmStrength: 0.2,
      colorFinishing: true,
      finishingStrength: 0.1,
      softDiffusion: false,
      diffusionStrength: 0.24,
      enhancedTileMaterial: true,
      ditheredShadows: true,
      ditherStrength: 0.2,
      ambientOcclusion: false,
      aoIntensity: 0.78,
      aoRadius: 0.22,
      warmHalation: false,
      halationStrength: 0.18,
    });
  });
});
