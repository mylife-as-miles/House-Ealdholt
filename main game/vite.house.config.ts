import { defineConfig, mergeConfig } from "vite";
import { copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import baseConfig from "./vite.config";
import { prepareReleaseVillage, releaseVillageSource } from "../scripts/release-village-build";

const expected = "fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475";
const filename = "ealdholt-population-desktop-fresh-exterior-v4-tall-commuting.json";
export default defineConfig(async env => {
  const base = typeof baseConfig === "function" ? await baseConfig(env) : await baseConfig;
  let bytes = 0;
  const site = resolve(import.meta.dirname, "../private-assets/elderbloom", filename);
  return mergeConfig(base, {
    plugins: [{
      name: "house-ealdholt-population-site",
      async config() {
        const village = await prepareReleaseVillage(releaseVillageSource(), ["desktop"]);
        if (village.status !== "ready") throw new Error(`The verified desktop village is required: ${village.reason}`);
        try {
          const data = await readFile(site); bytes = data.length;
          if (createHash("sha256").update(data).digest("hex") !== expected) throw new Error("The site SHA-256 does not match the source-qualified artifact.");
        } catch (error) {
          if (process.env.EALDHOLT_ALLOW_MISSING_SITE !== "1") throw new Error(`The source-qualified population site is required: ${site}. ${String(error)}`);
          console.warn("Diagnostic build only: population site is missing or invalid; villagers cannot appear."); bytes = 0;
        }
        return { define: { __EALDHOLT_SITE_BYTES__: JSON.stringify(bytes) } };
      },
      async closeBundle() {
        await rename(resolve(import.meta.dirname, "dist/house.html"), resolve(import.meta.dirname, "dist/index.html"));
      },
      async writeBundle(output: { dir?: string }) {
        if (!bytes) return;
        const target = resolve(output.dir ?? resolve(import.meta.dirname, "dist"), "legacy/elderbloom");
        await mkdir(target, { recursive: true });
        const destination = resolve(target, filename); await copyFile(site, destination);
        if (createHash("sha256").update(await readFile(destination)).digest("hex") !== expected) throw new Error("Copied population site failed SHA-256 verification.");
      },
    }],
    build: { rollupOptions: { input: resolve(import.meta.dirname, "house.html") } },
  });
});
