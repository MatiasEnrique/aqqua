import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  installCommand: "npm install -g vite-plus && vp install --filter '@aqqua/marketing...'",
  buildCommand: "vp run --filter @aqqua/marketing build",
  outputDirectory: "dist",
};
