import { describe, expect, test } from "bun:test";
import { defaultVisualDebugSettings } from "./visualSettings";

describe("visual defaults", () => {
  test("uses the improved tile material", () => {
    expect(defaultVisualDebugSettings).toEqual({
      enhancedTileMaterial: true,
    });
  });
});
