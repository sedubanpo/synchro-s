"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { ShaderMaterial } from "three";
import { Vector2 } from "three";

type ListeningOrbProps = {
  loading: boolean;
  active: boolean;
};

const vertexShader = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
uniform vec2 uResolution;
uniform vec2 uRippleOrigin;
uniform float uTime;
uniform float uRippleStart;
uniform float uIntensity;

varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;

  for (int i = 0; i < 5; i++) {
    v += noise(p) * a;
    p = rot(0.55) * p * 2.0 + vec2(0.12, -0.08);
    a *= 0.52;
  }

  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / max(uResolution.y, 1.0);

  float t = uTime * (0.38 + uIntensity * 0.7);
  vec2 flow = p * 1.25;
  flow += vec2(
    sin(t * 0.7 + p.y * 2.2) * 0.12,
    cos(t * 0.6 + p.x * 2.0) * 0.12
  );

  float n1 = fbm(flow + vec2(t * 0.16, -t * 0.1));
  float n2 = fbm(rot(0.8) * flow * 1.4 + vec2(-t * 0.14, t * 0.12));
  float n3 = fbm(rot(-1.1) * flow * 1.8 + vec2(t * 0.08, t * 0.1));

  float lobeA = smoothstep(0.2, 0.95, n1 * 1.15 + n2 * 0.38);
  float lobeB = smoothstep(0.22, 0.98, n2 * 1.08 + n3 * 0.42);
  float bridge = smoothstep(0.3, 1.18, lobeA + lobeB + n3 * 0.22);

  vec3 deep = vec3(0.01, 0.025, 0.08);
  vec3 cyan = vec3(0.07, 0.92, 1.0);
  vec3 pink = vec3(1.0, 0.24, 0.78);
  vec3 violet = vec3(0.5, 0.28, 1.0);

  vec3 color = deep;
  color += cyan * (lobeA * 0.55 + bridge * 0.18);
  color += pink * (lobeB * 0.55 + bridge * 0.18);
  color += violet * (bridge * 0.32 + smoothstep(0.45, 0.88, n3) * 0.14);

  vec2 ripplePoint = uRippleOrigin * 2.0 - 1.0;
  ripplePoint.x *= uResolution.x / max(uResolution.y, 1.0);
  float elapsed = max(uTime - uRippleStart, 0.0);
  float dist = distance(p, ripplePoint);
  float rippleBand = smoothstep(0.06, 0.0, abs(dist - elapsed * 0.36));
  float rippleWave = 0.5 + 0.5 * sin(dist * 28.0 - elapsed * 14.0);
  float ripple = rippleBand * rippleWave * exp(-elapsed * 1.2);
  color += mix(cyan, pink, 0.5 + 0.5 * sin(elapsed * 3.2)) * ripple * (0.85 + uIntensity * 0.5);

  float vignette = smoothstep(1.85, 0.18, length(p));
  float glow = 0.22 + bridge * 0.5 + uIntensity * 0.2;
  vec3 finalColor = deep + color * glow * vignette;
  gl_FragColor = vec4(clamp(finalColor, vec3(0.0), vec3(1.0)), 1.0);
}
`;

function FluidField({ loading, active }: ListeningOrbProps) {
  const shaderRef = useRef<ShaderMaterial>(null);
  const rippleOriginRef = useRef(new Vector2(0.5, 0.5));
  const rippleStartRef = useRef(-10);
  const intensityRef = useRef(0);
  const { size } = useThree();

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);

      rippleOriginRef.current.set(event.clientX / width, 1 - event.clientY / height);

      const shader = shaderRef.current;
      if (shader) {
        shader.uniforms.uRippleOrigin.value.copy(rippleOriginRef.current);
        shader.uniforms.uRippleStart.value = shader.uniforms.uTime.value as number;
      } else {
        rippleStartRef.current = performance.now() / 1000;
      }
    }

    window.addEventListener("pointerdown", handlePointerDown, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useFrame(({ clock }) => {
    const shader = shaderRef.current;
    if (!shader) {
      return;
    }

    const time = clock.getElapsedTime();
    const targetIntensity = (loading ? 1.15 : 0) + (active ? 1.0 : 0);

    intensityRef.current += (targetIntensity - intensityRef.current) * 0.14;

    shader.uniforms.uTime.value = time;
    shader.uniforms.uResolution.value.set(size.width, size.height);
    shader.uniforms.uIntensity.value = intensityRef.current;
    shader.uniforms.uRippleOrigin.value.copy(rippleOriginRef.current);

    if (rippleStartRef.current > 0) {
      shader.uniforms.uRippleStart.value = rippleStartRef.current;
      rippleStartRef.current = -10;
    }
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={shaderRef}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uResolution: { value: new Vector2(1, 1) },
          uRippleOrigin: { value: new Vector2(0.5, 0.5) },
          uTime: { value: 0 },
          uRippleStart: { value: -10 },
          uIntensity: { value: 0 }
        }}
      />
    </mesh>
  );
}

export function ListeningOrb({ loading, active }: ListeningOrbProps) {
  return (
    <Canvas
      frameloop="always"
      className="pointer-events-none absolute inset-0 -z-10"
      orthographic
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 1], zoom: 1 }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
    >
      <FluidField loading={loading} active={active} />
    </Canvas>
  );
}
