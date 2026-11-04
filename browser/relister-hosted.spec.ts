import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { preview } from "../lib/relister/jobs";
import { sampleListing } from "../lib/relister/simulation";
import { processJob } from "../lib/relister/jobs";
const opt = process.env.RELISTER_HOSTED_TEST === "true";
test.use({ trace: "off", screenshot: "off", video: "off" });
test.skip(!opt, "Explicit isolated hosted-test opt-in required.");
test("real account login → preview → durable confirmation → worker → history", async ({
  page,
}) => {
  for (const line of readFileSync(
    process.env.RELISTER_TEST_ENV_FILE!,
    "utf8",
  ).split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const url = process.env.SUPABASE_EU_URL!;
  if (url !== "https://xfprtvwsjlvwcaywgwyw.supabase.co")
    throw Error("Wrong test project.");
  const db = createClient(url, process.env.SUPABASE_EU_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const preparationOnly = process.env.RELISTER_PREPARATION_ONLY === "true";
  const email = preparationOnly
      ? "relister-preparation-owner@example.invalid"
      : `relister-${randomUUID()}@example.invalid`,
    password = randomUUID() + randomUUID();
  const user = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { snaplist: { active: true } },
  });
  if (user.error || !user.data.user)
    throw Error("Fixture account creation failed.");
  const account = user.data.user.id;
  let jobId: string | undefined;
  try {
    await page.goto("/login");
    const login = await page.request.post("/api/account", {
      headers: { origin: "http://127.0.0.1:3190" },
      data: { action: "login", email, password },
    });
    expect(login.status()).toBe(200);
    await page.goto("/relister");
    await expect(
      page.getByRole("heading", { name: "Re-Lister", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Generalprobe: Testdaten laden" })
      .click();
    await expect(
      page.getByText("Konto: SIMULATION", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Erste 1 auswählen", exact: true })
      .click();
    await page.getByRole("button", { name: "6 %", exact: true }).click();
    await page
      .getByRole("button", { name: "Vorbereitung und Vorschau starten" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Unveränderliche Rabattvorschau – Simulation",
      }),
    ).toBeVisible();
    const confirmation = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/relister") &&
        r.request().method() === "POST" &&
        r.request().postDataJSON()?.action === "confirm",
    );
    await page
      .getByRole("button", {
        name: "Geprüften Probelauf ausdrücklich bestätigen",
      })
      .click();
    expect((await (await confirmation).json()).ok).toBe(true);
    const jobs = await db
      .from("relister_jobs")
      .select("id,document")
      .eq("account_id", account);
    if (jobs.error || jobs.data?.length !== 1)
      throw Error("Confirmed job missing.");
    jobId = jobs.data[0].id;
    expect(jobs.data[0].document.confirmed).toBe(true);
    if (!preparationOnly) {
      await processJob(jobId!);
      await page.reload();
    }
    await expect(
      page.getByRole("heading", { name: "Simulation · 1/1 abgeschlossen" }),
    ).toBeVisible({ timeout: 30000 });
    const result = await db
      .from("relister_jobs")
      .select("document")
      .eq("id", jobId)
      .single();
    expect(result.data?.document.rows[0].targetCents).toBe(4699);
  } finally {
    if (jobId) {
      const job = await db
        .from("relister_jobs")
        .select("document")
        .eq("id", jobId)
        .single();
      const paths = (job.data?.document.rows ?? []).flatMap(
        (r: any) => r.backup?.images?.map((i: any) => i.path) ?? [],
      );
      if (paths.length)
        await db.storage.from("snaplist-relister").remove(paths);
      await db.from("relister_claims").delete().eq("job_id", jobId);
      await db.from("relister_item_locks").delete().eq("job_id", jobId);
      await db.from("relister_jobs").delete().eq("id", jobId);
    }
    await db.from("relister_catalog").delete().eq("account_id", account);
    await db.auth.admin.deleteUser(account);
  }
});
