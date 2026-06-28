import type { FastifyInstance } from "fastify";
import { registerHealthRoute } from "./health.js";
import { registerV1Routes } from "./v1.js";
import { registerAdminRoutes } from "./admin.js";
import type { GatewayState } from "../core/state.js";
import type { UsageDB } from "../db.js";
import type { AuthStore } from "../core/authStore.js";
import { Notifier } from "../core/notifier.js";

export function registerRoutes(
  app: FastifyInstance,
  state: GatewayState,
  db: UsageDB | undefined,
  auth: AuthStore,
): void {
  const notifier = db ? new Notifier(db) : undefined;
  registerHealthRoute(app);
  registerV1Routes(app, state, db, notifier);
  registerAdminRoutes(app, { state, db, auth, notifier });

  if (state.config.server.api_keys.length === 0) {
    app.log.warn(
      "server.api_keys is empty — gateway auth is DISABLED. Safe only on localhost; set keys before exposing remotely.",
    );
  }
}
