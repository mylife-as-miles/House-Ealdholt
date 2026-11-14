import { memo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  nextRenderTimestamp,
  normalizeFrameLimit,
  normalizeRenderScale,
  scaledPixelRatio,
} from "./effects/render-controls";
import type { FrameLimit } from "./effects/render-controls";
import "./effects/atmosphere.css";
import { SOUL_STREAM_ANIMATIONS } from "./effects/soul-stream-dashes";

export type EffectsQuality = "low" | "medium" | "high";
/** running: animating. frozen: on screen, holding its last frame. suspended: hidden and paused. */
type StageMode = "running" | "frozen" | "suspended";

const MOTE_COUNTS: Record<EffectsQuality, number> = { low: 0, medium: 98, high: 195 };

const vertexShader = `
  attribute float aSeed;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec3 p = position;
    float t = uTime * uMotion;
    p.x += sin(t * .19 + aSeed * 32.) * .012;
    p.y = mod(p.y + t * (.005 + aSeed * .011) + 1., 1.);
    p.x += sin(p.y * 12. + t * .38 + aSeed * 50.) * .009;
    gl_Position = vec4(p.x * 2. - 1., p.y * 2. - 1., 0., 1.);
    float shimmer = .58 + .42 * sin(t * (1. + aSeed) + aSeed * 60.);
    gl_PointSize = aSize * uScale * (.75 + shimmer * .25);
    vColor = aColor;
    vOpacity = (.24 + shimmer * .61) * (.5 + position.z * .5);
  }
`;

const fragmentShader = `
  precision mediump float;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv * vec2(1., 1.15));
    float halo = exp(-d * d * 21.) * .24;
    float core = exp(-d * d * 100.);
    float fleck = exp(-length(uv * vec2(1., .7)) * 19.) * .45;
    float a = (halo + core + fleck) * vOpacity;
    if (a < .008) discard;
    gl_FragColor = vec4(vColor * 1.25, a);
  }
`;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** The motes for a particle count; the same count always lays out the same field. */
function moteGeometry(count: number): THREE.BufferGeometry {
  const random = seededRandom(46207);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const isSpirit = i < count * 0.82;
    let x = random();
    let y = random();
    if (i < count * 0.39) {
      x = 0.66 + x * 0.33;
      y = 0.63 + y * 0.35;
    } else if (i < count * 0.52) {
      x = 0.5 + x * 0.09;
      y = 0.54 + y * 0.27;
    } else if (isSpirit) {
      x = 0.88 + x * 0.12;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = random();
    seeds[i] = random();
    sizes[i] = isSpirit ? 9 + random() * 27 : 2.2 + random() * 7;
    const color = new THREE.Color(isSpirit ? "#71e7cf" : "#bb8d51");
    if (isSpirit && i % 5 === 0) color.set("#b4e9ce");
    colors.set(color.toArray(), i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

interface MoteSettings { renderScale(): number; frameLimit(): FrameLimit }
interface MoteState { count: number; motion: boolean; mode: StageMode }
interface MoteField {
  setCount(count: number): void;
  setMotion(enabled: boolean): void;
  setMode(mode: StageMode): void;
  resize(): void;
  dispose(): void;
}

/**
 * One WebGL renderer for the motes. Quality, motion, pauses and freezes
 * reconfigure it; only Low quality or unmounting releases its context.
 */
function createMoteField(mount: HTMLElement, settings: MoteSettings, initial: MoteState): MoteField | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(scaledPixelRatio(window.devicePixelRatio, settings.renderScale()));
  renderer.domElement.setAttribute("aria-hidden", "true");
  mount.appendChild(renderer.domElement);
  let { count, motion, mode } = initial;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 1 },
      uMotion: { value: motion ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(moteGeometry(count), material);
  scene.add(points);
  let frame = 0;
  // Motion time advances only while the motes animate, so they resume exactly where they paused or froze.
  let elapsed = 0;
  let previous = 0;
  let lastRendered = 0;
  const draw = () => {
    material.uniforms.uTime.value = elapsed;
    renderer.render(scene, camera);
  };
  const render = (now: number) => {
    frame = requestAnimationFrame(render);
    const delta = Math.max(0, now - previous) / 1000;
    previous = now;
    if (document.hidden) return;
    elapsed += delta;
    const timestamp = nextRenderTimestamp(now, lastRendered, settings.frameLimit());
    if (timestamp === null) return;
    lastRendered = timestamp;
    draw();
  };
  // Only a running, moving field asks for frames; a frozen one keeps its last frame on screen.
  const schedule = () => {
    const animate = mode === "running" && motion;
    if (animate && !frame) {
      previous = lastRendered = performance.now();
      frame = requestAnimationFrame(render);
    } else if (!animate && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const resize = () => {
    const { width, height } = mount.getBoundingClientRect();
    if (!width || !height) return;
    const pixelRatio = scaledPixelRatio(window.devicePixelRatio, settings.renderScale());
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    material.uniforms.uScale.value =
      Math.max(0.55, height / 714) * renderer.getPixelRatio();
    // A resize clears the canvas, so a visible field draws again at once, frozen or not.
    if (mode !== "suspended") draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();
  schedule();
  return {
    setCount(next) {
      if (next === count) return;
      count = next;
      const old = points.geometry;
      points.geometry = moteGeometry(count);
      old.dispose();
      if (mode !== "suspended") draw();
    },
    setMotion(enabled) {
      if (enabled === motion) return;
      motion = enabled;
      material.uniforms.uMotion.value = enabled ? 1 : 0;
      // Still motes rest in their first pose, and motion picks up from that pose.
      elapsed = 0;
      if (mode !== "suspended") draw();
      schedule();
    },
    setMode(next) {
      if (next === mode) return;
      const wasSuspended = mode === "suspended";
      mode = next;
      // Coming back into view redraws at the current size first.
      if (wasSuspended && mode !== "suspended") resize();
      schedule();
    },
    resize,
    dispose() {
      cancelAnimationFrame(frame);
      frame = 0;
      observer.disconnect();
      points.geometry.dispose();
      material.dispose();
      renderer.dispose();
      // Release the context now rather than whenever the canvas is collected.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

const Feather = memo(function Feather({ className }: { className: string }) {
  return (
    <svg
      className={`spirit-feather ${className}`}
      viewBox="0 0 90 42"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`plume-${className}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#a4b3a6" stopOpacity=".08" />
          <stop offset=".55" stopColor="#d6d4ba" stopOpacity=".65" />
          <stop offset="1" stopColor="#8eab9a" stopOpacity=".04" />
        </linearGradient>
      </defs>
      <path
        d="M4 32 C21 6 48 2 81 9 C65 26 39 37 4 32Z"
        fill={`url(#plume-${className})`}
        opacity=".2"
      />
      <path
        d="M2 35 Q40 18 82 9"
        fill="none"
        stroke="#c0c5ba"
        strokeWidth=".65"
        opacity=".6"
      />
      {Array.from({ length: 35 }, (_, i) => {
        const x = 10 + i * 2;
        const y = 34 - x * 0.31;
        const spread = Math.sin((i / 38) * Math.PI) * 14;
        return (
          <path
            key={i}
            d={`M${x} ${y} q${-spread * 0.7} ${-spread * 0.6} ${-spread * 0.5} ${-spread} M${x} ${y} q${spread * 0.4} ${spread * 0.5} ${spread * 1.2} ${spread * 0.2}`}
            fill="none"
            stroke="#c3ccbe"
            strokeWidth=".6"
            opacity={0.18 + (i % 3) * 0.09}
          />
        );
      })}
    </svg>
  );
});

/** The streams' keyframe rules, built once from their paths. */
const SOUL_STREAM_KEYFRAMES = SOUL_STREAM_ANIMATIONS.map((stream) => stream.keyframes).join("");

/**
 * Four soul streams flowing toward the sorcerer. Each dash travels its path by
 * transform keyframes only, and their glow is a CSS blur on their own layer,
 * so the browser recomposites the streams each frame and repaints nothing (U-18).
 */
const SoulStreams = memo(function SoulStreams() {
  return (
    <div className="soul-streams">
      <style>{SOUL_STREAM_KEYFRAMES}</style>
      <div className="soul-streams__space">
        {SOUL_STREAM_ANIMATIONS.flatMap((stream) =>
          stream.runners.map((runner, index) => (
            <span
              key={`${stream.name}-${index}`}
              className="soul-streams__dash"
              style={{
                animationName: stream.name,
                animationDuration: `${stream.duration}s`,
                animationDelay: `${runner.delay}s`,
                transform: runner.rest,
              }}
            />
          )),
        )}
      </div>
    </div>
  );
});

const Plumes = memo(function Plumes() {
  return (
    <>
      <Feather className="plume-one" />
      <Feather className="plume-two" />
      <Feather className="plume-three" />
    </>
  );
});

function Atmosphere({
  quality = "high",
  reducedMotion: requestedReducedMotion = false,
  renderScale = 100,
  frameLimit = 0,
  suspended = false,
  frozen = false,
}: {
  quality?: EffectsQuality;
  reducedMotion?: boolean;
  renderScale?: number;
  frameLimit?: FrameLimit;
  /** Hidden and paused behind a full-stage destination (My Legacy, Chronicles, a match), keeping the renderer. */
  suspended?: boolean;
  /** On screen but still, behind a blurred page, a dialog or the loader: the last frame stays and nothing animates. */
  frozen?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reducedMotion = requestedReducedMotion || systemReducedMotion;
  const renderScaleRef = useRef(normalizeRenderScale(renderScale));
  const frameLimitRef = useRef(normalizeFrameLimit(frameLimit));
  const fieldRef = useRef<MoteField | null>(null);
  const count = MOTE_COUNTS[quality] ?? MOTE_COUNTS.high;
  const mode: StageMode = suspended ? "suspended" : frozen ? "frozen" : "running";
  const stateRef = useRef<MoteState>({ count, motion: !reducedMotion, mode });
  stateRef.current = { count, motion: !reducedMotion, mode };
  const motesShown = count > 0;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReducedMotion(preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  // Low quality draws no motes and releases the renderer. Every other change,
  // including a pause behind My Legacy, Chronicles or a match, keeps it.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !motesShown) return;
    const field = createMoteField(mount, {
      renderScale: () => renderScaleRef.current,
      frameLimit: () => frameLimitRef.current,
    }, stateRef.current);
    fieldRef.current = field;
    return () => {
      if (fieldRef.current === field) fieldRef.current = null;
      field?.dispose();
    };
  }, [motesShown]);

  useEffect(() => { if (count) fieldRef.current?.setCount(count); }, [count]);
  useEffect(() => { fieldRef.current?.setMotion(!reducedMotion); }, [reducedMotion]);
  useEffect(() => { fieldRef.current?.setMode(mode); }, [mode]);

  useEffect(() => {
    const scale = normalizeRenderScale(renderScale);
    const changed = renderScaleRef.current !== scale;
    renderScaleRef.current = scale;
    frameLimitRef.current = normalizeFrameLimit(frameLimit);
    if (changed) fieldRef.current?.resize();
  }, [renderScale, frameLimit]);

  return (
    <div
      className={`atmosphere atmosphere--${quality}${reducedMotion ? " atmosphere--still" : ""}${suspended ? " is-suspended" : frozen ? " is-frozen" : ""}`}
      aria-hidden="true"
    >
      <div className="spirit-aura" />
      {quality !== "low" && <SoulStreams />}
      <div ref={mountRef} className="mote-field" />
      {quality === "high" && <Plumes />}
    </div>
  );
}

export default memo(Atmosphere);
