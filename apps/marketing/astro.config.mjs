import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://aqqua.ai",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
