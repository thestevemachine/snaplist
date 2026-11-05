import { cloudEnabled } from "@/lib/cloud/store";
import { serve } from "inngest/next";
import { inngest } from "@/lib/cloud/inngest";
import {
  generateDraft,
  expireBatches,
  dispatchQueued,
} from "@/lib/cloud/worker";
const sweepLive = inngest.createFunction(
  {
    id: "sweep-live-photo-orphans",
    triggers: { cron: "15 8 * * *" },
    concurrency: 1,
  },
  async ({ step }) =>
    step.run("sweep", async () => {
      const { cleanupLivePhotos } = await import("@/lib/live-foto/cleanup");
      return cleanupLivePhotos();
    }),
);
export const maxDuration = 300;
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: cloudEnabled()
    ? [
        generateDraft,
        expireBatches,
        dispatchQueued,
        ...(process.env.LIVE_FOTO_ENABLED === "true" ? [sweepLive] : []),
      ]
    : [],
});
