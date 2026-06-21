import type { FastifyInstance } from "fastify";
import { registerHealthRoute } from "./health.js";
import { registerV1Routes } from "./v1.js";
import { registerAdminRoutes } from "./admin.js";
import type { GatewayState } from "../core/state.js";
import type { UsageDB } from "../db.js";

export function registerRoutes(
  app: FastifyInstance,
  state: GatewayState,
  db?: UsageDB,
  adminPassword?: string,
): void {
  registerHealthRoute(app);
  registerV1Routes(app, state, db);
  registerAdminRoutes(app, { state, db, password: adminPassword });

  if (state.config.server.api_keys.length === 0) {
    app.log.warn(
      "server.api_keys is empty — gateway auth is DISABLED. Safe only on localhost; set keys before exposing remotely.",
    );
  }
}
