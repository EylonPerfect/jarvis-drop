import type { FastifyInstance } from "fastify";
import { one } from "../db/pool.js";
import type { FeedItem } from "@jarvis/shared";

// Command Center aggregate: the live intelligence feed. (Status strip lives
// under /api/system/health so the top bar and dashboard share one source.)
export default async function commandRoutes(app: FastifyInstance) {
  app.get("/api/command/feed", async (): Promise<FeedItem[]> => {
    return (await one<{ value: FeedItem[] }>(`SELECT value FROM settings WHERE key = 'feed'`))?.value ?? [];
  });
}
