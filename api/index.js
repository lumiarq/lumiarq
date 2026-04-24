// api/stdin-entry.js
import appPromise from "../.arc/node/app.js";

// node_modules/.pnpm/hono@4.12.8/node_modules/hono/dist/adapter/vercel/handler.js
var handle = (app2) => (req) => {
  return app2.fetch(req);
};

// api/stdin-entry.js
var app = await appPromise;
var router = app?.router ?? app;
if (!router || typeof router.fetch !== "function") {
  throw new Error("LumiARQ Vercel adapter expected a Hono app at app.router.");
}
var config = { runtime: "nodejs" };
var stdin_entry_default = handle(router);
export {
  config,
  stdin_entry_default as default
};
