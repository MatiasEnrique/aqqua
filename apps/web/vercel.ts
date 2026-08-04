import { matchers, routes, type VercelConfig } from "@vercel/config/v1";

const ROUTER_HOST = "app.aqqua.codes";
const LATEST_ORIGIN = "https://latest.app.aqqua.codes";

export const config: VercelConfig = {
  buildCommand:
    'vp run --filter @aqqua/web build && node ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  installCommand:
    "npm install -g vite-plus && vp install --ignore-scripts --filter '@aqqua/scripts...' --filter '@aqqua/web...'",
  routes: [
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST)],
      dest: `${LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
