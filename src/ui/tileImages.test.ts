import { describe, expect, test } from "bun:test";
import { allTileImageUrls } from "./tileImages";

describe("tile image preloading", () => {
  test("includes every unique tile face image", () => {
    const urls = allTileImageUrls();

    expect(urls).toHaveLength(42);
    expect(urls).toContain("/tiles/flower/01.svg");
    expect(urls).toContain("/tiles/season/04.svg");
  });
});
