import { serve } from "@hono/node-server";
import { app } from "./routes.js";
import { initAll } from "./tree-store.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  console.log("Initializing SMT trees...");
  await initAll();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`\nServer listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
