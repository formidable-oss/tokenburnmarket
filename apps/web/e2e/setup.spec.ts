import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { generateDeviceKeyPair } from "@tokenburnmarket/core";
import { db } from "../src/db";
import { builders, deviceConnectCodes } from "../src/db/schema";

let handle: string;
let code: string | undefined;

test.beforeAll(async ({}, workerInfo) => {
  const setupHandle = workerInfo.config.metadata.setupHandle;
  if (typeof setupHandle !== "string" || !/^tbm-setup-e2e-[a-f0-9]{12}$/.test(setupHandle)) {
    throw new Error("Run this test with playwright.setup.config.ts.");
  }
  handle = setupHandle;
});

test.afterAll(async () => {
  if (code) await db.delete(deviceConnectCodes).where(eq(deviceConnectCodes.code, code));
  if (handle) {
    // Signup credits, devices and approved codes cascade from this run's account.
    await db.delete(builders).where(and(
      eq(builders.handle, handle),
      eq(builders.githubId, `dev:${handle}`),
    ));
  }
});

test("signed-in setup stays discoverable through connection and revocation", async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await test.step("an account without devices can open setup from Settings", async () => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/signin\?next=/);
    await page.getByRole("button", { name: `Sign in as ${handle}`, exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`@${handle}`);
    await expect(page.getByText("No device yet. Start with the prompt above.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^(devices|credits)$/ })).toHaveText([
      "devices", "credits",
    ]);
    await page.getByText("Set up manually instead", { exact: true }).click();
    await page.getByRole("link", { name: "Open the guide", exact: true }).click();
    await expect(page).toHaveURL(/\/docs\/setup#manual$/);
    await expect(page.locator("details")).toHaveAttribute("open", "");
    await expect(page.getByRole("heading", { name: "1. install the CLI", exact: true })).toBeInViewport();

    await page.goto("/settings");
    const connect = page.getByRole("link", { name: "Connect a computer", exact: true });
    await expect(connect).toHaveAttribute("href", "/docs/setup");
    await expect(page.getByRole("link", { name: "Connect another computer", exact: true })).toHaveCount(0);
    await connect.click();
    await expect(page).toHaveURL(/\/docs\/setup$/);
  });

  await test.step("the signed-in homepage opens setup directly and the profile has no connect action", async () => {
    await page.goto("/");
    const setup = page.getByRole("link", { name: "Get the setup prompt", exact: true });
    await expect(setup).toHaveAttribute("href", "/docs/setup");
    await setup.click();
    await expect(page).toHaveURL(/\/docs\/setup$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect a computer.");

    await page.goto(`/@${handle}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(handle);
    await expect(page.getByRole("link", { name: /^Connect (a|another) computer$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy prompt", exact: true })).toHaveCount(0);
  });

  await test.step("approving a real device changes Devices to Connect another computer", async () => {
    const keys = await generateDeviceKeyPair();
    const response = await request.post("/api/connect/start", {
      data: { publicKey: keys.publicKey, deviceName: "Setup browser test computer" },
    });
    expect(response.status()).toBe(201);
    ({ code } = await response.json());
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await page.goto(`/connect/${code}`);
    await expect(page.getByText("Setup browser test computer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Device approved.");
    await page.getByRole("link", { name: "See your devices", exact: true }).click();
    await expect(page.getByText("Setup browser test computer", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^(devices|credits)$/ })).toHaveText([
      "devices", "credits",
    ]);
    const connect = page.getByRole("link", { name: "Connect another computer", exact: true });
    await expect(connect).toHaveAttribute("href", "/docs/setup");
    await expect(page.getByRole("link", { name: "Connect a computer", exact: true })).toHaveCount(0);
    await connect.click();
    await expect(page).toHaveURL(/\/docs\/setup$/);
  });

  await test.step("a revoked device does not count as an active computer", async () => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText("revoked", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect a computer", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Connect another computer", exact: true })).toHaveCount(0);
  });
  expect(browserErrors).toEqual([]);
});
