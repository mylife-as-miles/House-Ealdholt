// Seam implementation (docs/legacy/WORKFLOWS.md): gameplay's environment provider
// discovers this module with import.meta.glob and calls createLegacyEnvironment.

import type { CreateDesktopLegacyEnvironment } from "../environment-contract";
import { CollectionDesktopEnvironment } from "./collection-environment";

export const createLegacyEnvironment: CreateDesktopLegacyEnvironment = async (options) => {
  const env = new CollectionDesktopEnvironment(options);
  try { await env.init(); } catch (error) { env.dispose(); throw error; }
  return env;
};
