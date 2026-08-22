import { useMemo } from "react";
import * as THREE from "three";
import type { TileInstance } from "../../sim/tiles";

type TileEngravingProfile = {
  key: "standard" | "dots";
  bumpScale: number;
  parallaxDepth: number;
  floorShade: number;
};

const standardEngravingProfile: TileEngravingProfile = {
  key: "standard",
  bumpScale: -0.095,
  parallaxDepth: 0.028,
  floorShade: 0.94,
};

// Broad dot artwork needs a shallower floor than narrow glyph strokes.
const dotEngravingProfile: TileEngravingProfile = {
  key: "dots",
  bumpScale: -0.06,
  parallaxDepth: 0.017,
  floorShade: 0.975,
};

const tileEngravingHeightCache = new Map<string, THREE.CanvasTexture>();

export function tileEngravingProfile(tile: TileInstance): TileEngravingProfile {
  return tile.kind.category === "suited" && tile.kind.suit === "dots"
    ? dotEngravingProfile
    : standardEngravingProfile;
}

export function EngravedArtworkMaterial({
  artwork,
  heightMap,
  profile,
}: {
  artwork: THREE.Texture;
  heightMap: THREE.CanvasTexture | undefined;
  profile: TileEngravingProfile;
}) {
  const engravingTexel = useMemo(() => {
    const image = heightMap?.image as
      | { width?: number; height?: number }
      | undefined;
    return new THREE.Vector2(
      1 / Math.max(1, image?.width ?? 150),
      1 / Math.max(1, image?.height ?? 200),
    );
  }, [heightMap]);

  return (
    <meshStandardMaterial
      map={artwork}
      bumpMap={heightMap}
      bumpScale={profile.bumpScale}
      roughness={0.76}
      metalness={0}
      transparent
      alphaTest={0.02}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
      side={THREE.FrontSide}
      customProgramCacheKey={() =>
        heightMap
          ? `mahjong-parallax-engraved-artwork-v3-${profile.key}`
          : "mahjong-lit-artwork"
      }
      onBeforeCompile={(shader) => {
        if (!heightMap) {
          return;
        }
        shader.uniforms.engravingTexel = { value: engravingTexel };
        shader.uniforms.engravingDepth = { value: profile.parallaxDepth };
        shader.uniforms.engravingFloorShade = { value: profile.floorShade };
        shader.vertexShader = shader.vertexShader.replace(
          "#include <common>",
          `#include <common>
          varying vec3 vEngravingViewDirection;
          varying float vEngravingWorldUp;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
          "#include <project_vertex>",
          `
          #include <project_vertex>
          vec3 engravingViewDirection = normalize(-mvPosition.xyz);
          vEngravingViewDirection = vec3(
            dot(engravingViewDirection, normalize(normalMatrix * vec3(1.0, 0.0, 0.0))),
            dot(engravingViewDirection, normalize(normalMatrix * vec3(0.0, 1.0, 0.0))),
            dot(engravingViewDirection, normalize(normalMatrix * vec3(0.0, 0.0, 1.0)))
          );
          vec3 engravingWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
          vEngravingWorldUp = abs(engravingWorldNormal.y);
          `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <common>",
          `
          #include <common>
          uniform vec2 engravingTexel;
          uniform float engravingDepth;
          uniform float engravingFloorShade;
          varying vec3 vEngravingViewDirection;
          varying float vEngravingWorldUp;
          `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `
          vec4 engravingSurface = texture2D(map, vMapUv);
          vec4 engravingFloor = engravingSurface;
          float engravingWall = 0.0;

          if (engravingSurface.a > 0.02) {
            vec3 engravingView = normalize(vEngravingViewDirection);
            vec2 engravingRay = -engravingView.xy /
              max(abs(engravingView.z), 0.32) * engravingDepth;
            engravingRay = clamp(
              engravingRay,
              vec2(-engravingDepth * 2.4),
              vec2(engravingDepth * 2.4)
            );

            vec2 engravingUv = vMapUv;
            vec2 engravingStep = engravingRay / 6.0;
            float engravingLayer = 0.0;
            float engravingHeight = texture2D(bumpMap, engravingUv).r;

            for (int engravingIndex = 0; engravingIndex < 6; engravingIndex++) {
              if (engravingLayer < engravingHeight) {
                engravingUv += engravingStep;
                engravingLayer += 1.0 / 6.0;
                engravingHeight = texture2D(bumpMap, engravingUv).r;
              }
            }

            engravingFloor = texture2D(map, engravingUv);
            float engravingFloorCoverage = smoothstep(
              0.03,
              0.38,
              engravingFloor.a
            );
            engravingWall = (1.0 - engravingFloorCoverage) *
              smoothstep(0.08, 0.92, 1.0 - engravingLayer);

            vec3 engravingWallColor = engravingSurface.rgb * 0.34 +
              vec3(0.045, 0.032, 0.02);
            engravingFloor.rgb = mix(
              engravingWallColor,
              engravingFloor.rgb,
              engravingFloorCoverage
            );
            engravingFloor.a = engravingSurface.a;
          }

          diffuseColor *= engravingFloor;

          float engravingLeft = texture2D(bumpMap, vBumpMapUv - vec2(engravingTexel.x, 0.0)).r;
          float engravingRight = texture2D(bumpMap, vBumpMapUv + vec2(engravingTexel.x, 0.0)).r;
          float engravingDown = texture2D(bumpMap, vBumpMapUv - vec2(0.0, engravingTexel.y)).r;
          float engravingUp = texture2D(bumpMap, vBumpMapUv + vec2(0.0, engravingTexel.y)).r;
          float engravingCenter = texture2D(bumpMap, vBumpMapUv).r;
          vec2 engravingInnerShadowRadius = engravingTexel * 2.4;
          float engravingWideLeft = texture2D(
            bumpMap,
            vBumpMapUv - vec2(engravingInnerShadowRadius.x, 0.0)
          ).r;
          float engravingWideRight = texture2D(
            bumpMap,
            vBumpMapUv + vec2(engravingInnerShadowRadius.x, 0.0)
          ).r;
          float engravingWideDown = texture2D(
            bumpMap,
            vBumpMapUv - vec2(0.0, engravingInnerShadowRadius.y)
          ).r;
          float engravingWideUp = texture2D(
            bumpMap,
            vBumpMapUv + vec2(0.0, engravingInnerShadowRadius.y)
          ).r;
          float engravingLowestNeighbor = min(
            min(engravingWideLeft, engravingWideRight),
            min(engravingWideDown, engravingWideUp)
          );
          float engravingInnerShadow = smoothstep(
            0.08,
            0.62,
            engravingCenter - engravingLowestNeighbor
          ) * smoothstep(0.12, 0.72, engravingCenter);
          vec2 engravingGradient = vec2(
            engravingRight - engravingLeft,
            engravingUp - engravingDown
          );
          float engravingEdge = smoothstep(0.025, 0.3, length(engravingGradient));
          float engravingBevelLight = dot(
            normalize(engravingGradient + vec2(0.0001)),
            normalize(vec2(-0.52, 0.86))
          );
          float engravingHorizontal = smoothstep(
            0.68,
            0.94,
            vEngravingWorldUp
          );
          float engravingRakeLight = dot(
            normalize(engravingGradient + vec2(0.0001)),
            normalize(vec2(-0.76, 0.65))
          );
          float engravingRakeShadow = max(-engravingRakeLight, 0.0) *
            engravingEdge * engravingHorizontal;
          float engravingRakeHighlight = max(engravingRakeLight, 0.0) *
            engravingEdge * engravingHorizontal;
          diffuseColor.rgb *= engravingFloorShade;
          diffuseColor.rgb *= 1.0 - engravingInnerShadow * 0.24;
          diffuseColor.rgb *= 1.0 - engravingEdge * 0.19;
          diffuseColor.rgb *= 1.0 + engravingBevelLight * engravingEdge * 0.085;
          diffuseColor.rgb *= 1.0 - engravingWall * 0.22;
          diffuseColor.rgb *= 1.0 - engravingRakeShadow * 0.14;
          diffuseColor.rgb *= 1.0 + engravingRakeHighlight * 0.075;
          `,
        );
      }}
    />
  );
}

export function tileEngravingHeightTexture(
  artworkTexture: THREE.Texture,
): THREE.CanvasTexture | undefined {
  const cached = tileEngravingHeightCache.get(artworkTexture.uuid);
  if (cached) {
    return cached;
  }

  const image = artworkTexture.image as
    | (CanvasImageSource & {
        naturalWidth?: number;
        naturalHeight?: number;
        width?: number;
        height?: number;
      })
    | undefined;
  if (!image) {
    return undefined;
  }

  const width = Math.max(1, image.naturalWidth ?? image.width ?? 150);
  const height = Math.max(1, image.naturalHeight ?? image.height ?? 200);
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    return undefined;
  }
  sourceContext.drawImage(image, 0, 0, width, height);
  const source = sourceContext.getImageData(0, 0, width, height);
  const horizontal = new Float32Array(width * height);
  const blurredAlpha = new Uint8ClampedArray(width * height);
  const radius = 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let samples = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + offset));
        total += source.data[(y * width + sampleX) * 4 + 3];
        samples += 1;
      }
      horizontal[y * width + x] = total / samples;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let samples = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.max(0, Math.min(height - 1, y + offset));
        total += horizontal[sampleY * width + x];
        samples += 1;
      }
      blurredAlpha[y * width + x] = Math.round(total / samples);
    }
  }

  const heightCanvas = document.createElement("canvas");
  heightCanvas.width = width;
  heightCanvas.height = height;
  const heightContext = heightCanvas.getContext("2d");
  if (!heightContext) {
    return undefined;
  }
  const heightImage = heightContext.createImageData(width, height);
  for (let index = 0; index < blurredAlpha.length; index += 1) {
    const value = blurredAlpha[index];
    const pixel = index * 4;
    heightImage.data[pixel] = value;
    heightImage.data[pixel + 1] = value;
    heightImage.data[pixel + 2] = value;
    heightImage.data[pixel + 3] = 255;
  }
  heightContext.putImageData(heightImage, 0, 0);

  const heightTexture = new THREE.CanvasTexture(heightCanvas);
  heightTexture.colorSpace = THREE.NoColorSpace;
  heightTexture.minFilter = THREE.LinearFilter;
  heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.anisotropy = 4;
  heightTexture.needsUpdate = true;
  tileEngravingHeightCache.set(artworkTexture.uuid, heightTexture);
  return heightTexture;
}
