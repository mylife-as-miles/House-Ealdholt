import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { stripPrivatePreviewBuildInputs } from "../scripts/private-preview-build-env";
import { releaseVillagePlugin } from "../scripts/release-village-build";
import { publicBuildFilter } from "../scripts/public-build-filter";

export default defineConfig(({ command, mode }) => {
  stripPrivatePreviewBuildInputs(command, process.env,
    loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_ELDERBLOOM_"));
  return {
  // Release builds ship the verified local village installation, if any (scripts/release-village-build.ts).
  // The build copies only the public files the desktop app requests (scripts/public-build-filter.ts).
  plugins: [react(), releaseVillagePlugin({ profiles: ["desktop"] }), publicBuildFilter("desktop")],
  base: "./",
  // Prewarm the lazy rules dependency so first entry cannot trigger a dev-page reload.
  optimizeDeps: { include: ["chess.js", "three", "three/tsl", "three/webgpu", "meshoptimizer", "jolt-physics",
    ...["controls/OrbitControls", "loaders/GLTFLoader", "loaders/EXRLoader", "utils/SkeletonUtils", "utils/BufferGeometryUtils", "geometries/RoundedBoxGeometry", "geometries/DecalGeometry",
      "postprocessing/EffectComposer", "postprocessing/RenderPass", "postprocessing/UnrealBloomPass", "postprocessing/BokehPass", "postprocessing/SSAOPass", "postprocessing/SMAAPass", "postprocessing/OutputPass", "postprocessing/ShaderPass"].map((name) => `three/examples/jsm/${name}.js`),
  ] },
  resolve: { alias: { "crownfall-world-bvh": fileURLToPath(new URL("./node_modules/three-mesh-bvh/src/index.js", import.meta.url)), "crownfall-world-three": fileURLToPath(new URL("./src/legacy/worlds/platform-three.ts", import.meta.url)) }, dedupe: ["react", "react-dom", "three", "chess.js", "jolt-physics"] },
  server: {
    host: "0.0.0.0", port: 5173,
    fs: { allow: [".", fileURLToPath(new URL("../shared", import.meta.url)), fileURLToPath(new URL("../web/src", import.meta.url)), fileURLToPath(new URL("../node_modules", import.meta.url))] },
  },
  };
});
