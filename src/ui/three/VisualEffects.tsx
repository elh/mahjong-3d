import {
  Bloom,
  EffectComposer,
  N8AO,
  SMAA,
  ToneMapping,
} from "@react-three/postprocessing";
import { BlendFunction, Effect, ToneMappingMode } from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { VisualDebugSettings } from "./visualSettings";

type FinishingValues = Pick<
  VisualDebugSettings,
  "filmStrength" | "finishingStrength" | "ditherStrength"
> & {
  filmStock: number;
};

const finishingFragmentShader = /* glsl */ `
  uniform float filmStrength;
  uniform float filmStock;
  uniform float finishingStrength;
  uniform float ditherStrength;

  float finishingLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 finishingSaturation(vec3 color, float amount) {
    float gray = finishingLuminance(color);
    return mix(vec3(gray), color, amount);
  }

  float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 color = max(inputColor.rgb, vec3(0.0));

    if (finishingStrength > 0.0) {
      float sourceChroma = max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
      vec3 finished = finishingSaturation(color, 1.045 + (1.0 - sourceChroma) * 0.035);
      finished = (finished - 0.5) * 1.035 + 0.5;
      finished = mix(finished, finished * finished * (3.0 - 2.0 * finished), 0.16);
      float finishedLuma = finishingLuminance(finished);
      float highlight = smoothstep(0.58, 0.96, finishedLuma);
      float shadow = 1.0 - smoothstep(0.05, 0.46, finishedLuma);
      finished += highlight * vec3(0.016, 0.008, -0.006);
      finished += shadow * vec3(-0.006, 0.005, 0.004);
      vec2 centeredUv = uv * 2.0 - 1.0;
      float vignette = smoothstep(0.34, 1.42, dot(centeredUv, centeredUv));
      finished *= 1.0 - vignette * 0.078;
      color = mix(color, finished, finishingStrength);
    }

    if (filmStrength > 0.0) {
      vec3 film = color;
      float filmLuma = finishingLuminance(film);
      float shadows = 1.0 - smoothstep(0.08, 0.48, filmLuma);
      float highlights = smoothstep(0.5, 0.96, filmLuma);
      float midtones = smoothstep(0.08, 0.42, filmLuma) * (1.0 - smoothstep(0.64, 0.94, filmLuma));

      float stockSaturation = 0.995;
      vec3 shadowTint = vec3(-0.003, 0.001, 0.004);
      vec3 midtoneTint = vec3(0.0);
      vec3 highlightTint = vec3(0.012, 0.006, -0.004);
      if (filmStock > 0.5 && filmStock < 1.5) {
        stockSaturation = 0.985;
        shadowTint = vec3(-0.008, 0.002, 0.014);
        midtoneTint = vec3(0.004, 0.001, -0.003);
        highlightTint = vec3(0.022, 0.009, -0.01);
      } else if (filmStock >= 1.5) {
        stockSaturation = 0.92;
        shadowTint = vec3(0.008, 0.004, -0.004);
        midtoneTint = vec3(0.007, 0.002, -0.003);
        highlightTint = vec3(0.016, 0.009, 0.002);
      }

      film = finishingSaturation(film, stockSaturation);
      film += shadows * shadowTint;
      film += midtones * midtoneTint;
      film += highlights * highlightTint;
      float gradedLuma = finishingLuminance(film);
      film += vec3(filmLuma - gradedLuma);
      film = max(film, vec3(0.0));
      color = mix(color, film, filmStrength);
    }

    if (ditherStrength > 0.0) {
      float luma = finishingLuminance(color);
      float shadowMask = 1.0 - smoothstep(0.12, 0.68, luma);
      float blackGuard = smoothstep(0.015, 0.12, luma);
      vec2 grainPixel = floor(gl_FragCoord.xy);
      float fineGrain = interleavedGradientNoise(grainPixel);
      float screenGrain = interleavedGradientNoise(floor(grainPixel * 0.5) + vec2(37.0, 17.0));
      float noise = mix(fineGrain, screenGrain, 0.64) - 0.5;
      float textureAmount = noise * 0.13 * ditherStrength * shadowMask * blackGuard;
      color = max(color + vec3(textureAmount), vec3(0.0));
    }

    outputColor = vec4(max(color, vec3(0.0)), inputColor.a);
  }
`;

class FinishingEffect extends Effect {
  constructor() {
    super("MahjongColorFinishing", finishingFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ["filmStrength", new THREE.Uniform(0)],
        ["filmStock", new THREE.Uniform(0)],
        ["finishingStrength", new THREE.Uniform(0)],
        ["ditherStrength", new THREE.Uniform(0)],
      ]),
    });
  }

  apply(values: FinishingValues): void {
    for (const [name, value] of Object.entries(values)) {
      const uniform = this.uniforms.get(name);
      if (uniform) {
        uniform.value = value;
      }
    }
  }
}

const halationFragmentShader = /* glsl */ `
  uniform float strength;

  float halationLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec3 halationSample(vec2 uv) {
    vec3 sampleColor = texture2D(inputBuffer, uv).rgb;
    float highlight = smoothstep(0.72, 1.28, halationLuminance(sampleColor));
    return sampleColor * highlight;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 radius = texelSize * 3.4;
    vec3 halo = vec3(0.0);
    halo += halationSample(uv + vec2(radius.x, 0.0));
    halo += halationSample(uv - vec2(radius.x, 0.0));
    halo += halationSample(uv + vec2(0.0, radius.y));
    halo += halationSample(uv - vec2(0.0, radius.y));
    halo += halationSample(uv + radius);
    halo += halationSample(uv - radius);
    halo += halationSample(uv + vec2(radius.x, -radius.y));
    halo += halationSample(uv + vec2(-radius.x, radius.y));
    halo *= 0.125;
    vec3 warmHalo = halo * vec3(1.0, 0.46, 0.2) * strength;
    outputColor = vec4(inputColor.rgb + warmHalo, inputColor.a);
  }
`;

class WarmHalationEffect extends Effect {
  constructor(strength: number) {
    super("MahjongWarmHalation", halationFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([["strength", new THREE.Uniform(strength)]]),
    });
  }

  set strength(value: number) {
    const uniform = this.uniforms.get("strength");
    if (uniform) {
      uniform.value = value;
    }
  }
}

function ColorFinishing({ settings }: { settings: VisualDebugSettings }) {
  const effect = useMemo(() => new FinishingEffect(), []);
  const values = useMemo<FinishingValues>(
    () => ({
      filmStrength: settings.filmGrade ? settings.filmStrength : 0,
      filmStock:
        settings.filmStock === "neutral"
          ? 0
          : settings.filmStock === "tungsten"
            ? 1
            : 2,
      finishingStrength: settings.colorFinishing
        ? settings.finishingStrength
        : 0,
      ditherStrength: settings.ditheredShadows ? settings.ditherStrength : 0,
    }),
    [settings],
  );

  useEffect(() => {
    effect.apply(values);
  }, [effect, values]);

  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
}

function WarmHalation({ strength }: { strength: number }) {
  const effect = useMemo(() => new WarmHalationEffect(0), []);

  useEffect(() => {
    effect.strength = strength;
  }, [effect, strength]);

  useEffect(() => () => effect.dispose(), [effect]);
  return <primitive object={effect} dispose={null} />;
}

export function VisualEffects({ settings }: { settings: VisualDebugSettings }) {
  return (
    <EffectComposer multisampling={0} depthBuffer>
      {settings.ambientOcclusion ? (
        <N8AO
          aoRadius={settings.aoRadius}
          intensity={settings.aoIntensity}
          distanceFalloff={1}
          quality="medium"
          halfRes
          depthAwareUpsampling
        />
      ) : null}
      {settings.softDiffusion ? (
        <Bloom
          intensity={settings.diffusionStrength}
          luminanceThreshold={0.58}
          luminanceSmoothing={0.28}
          mipmapBlur
          radius={0.82}
        />
      ) : null}
      {settings.warmHalation ? (
        <WarmHalation strength={settings.halationStrength} />
      ) : null}
      <ToneMapping
        mode={
          settings.agxToneMapping
            ? ToneMappingMode.AGX
            : ToneMappingMode.ACES_FILMIC
        }
      />
      <ColorFinishing settings={settings} />
      {settings.smaaAntialiasing ? <SMAA /> : null}
    </EffectComposer>
  );
}
