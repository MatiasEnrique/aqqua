import type { APIRoute } from "astro";

import { buildAqquaProjectFileJsonSchema } from "@aqqua/shared/aqquaProjectFile";

// Rendered at build time; published at https://aqqua.codes/schema/aqqua.json so
// aqqua.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildAqquaProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
