import { expect, test } from "@playwright/test";

/*
  What has to be true of a deployment before anyone is told about it: the pages
  a stranger can reach render, and they render the things that make them those
  pages rather than an error boundary.

  Public pages only. Signing in needs a GitHub OAuth app, and a smoke test that
  owns credentials is a smoke test nobody runs.
*/

test("landing renders with the stats strip", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bet your burn");

  const stats = page.getByRole("region", { name: "Site totals" });
  await expect(stats).toBeVisible();
  for (const label of ["builders connected", "burn this week", "open markets", "credits in play"]) {
    await expect(stats.getByText(label, { exact: true })).toBeVisible();
  }

  const setup = page.getByRole("link", { name: "Get the setup prompt", exact: true });
  await expect(setup).toHaveAttribute("href", "/docs/setup");
  await setup.click();
  await expect(page).toHaveURL(/\/docs\/setup$/);
});

test("the world leaderboard renders", async ({ page }) => {
  await page.goto("/leaderboard");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("World");
  // The season and metric switches are the board, whether or not anyone is on it.
  await expect(page.getByRole("link", { name: "this week" })).toBeVisible();
});

const docsPages = [
  { path: "/docs", heading: "How this works." },
  { path: "/docs/setup", heading: "Connect a computer." },
  { path: "/docs/verification", heading: "Verified means signed and plausible." },
  { path: "/docs/markets", heading: "A question, a clock, and a price." },
  { path: "/docs/credits", heading: "Whales earn more, not proportionally more." },
];

for (const { path, heading } of docsPages) {
  test(`${path} renders`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.getByRole("navigation", { name: "Docs" })).toBeVisible();
  });
}

test("the credit curve is server rendered", async ({ page }) => {
  await page.goto("/docs/credits");
  await expect(
    page.getByRole("img", { name: "Credits minted per day against usage cost" }),
  ).toBeVisible();
});

test("the sign-in page renders without starting OAuth", async ({ page }) => {
  await page.goto("/signin");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Claim your handle");
  // The form's own submit. The header offers sign-in as a link, not a button.
  await expect(page.getByRole("button", { name: /^Sign in/ })).toBeVisible();
});

test("long setup commands stay readable and copy in full on mobile", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/setup");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });

  const text = "claude mcp add tokenburnmarket -- npx -y tokenburnmarket mcp";
  const command = page.locator("code").getByText(text, { exact: true });
  await command.scrollIntoViewIfNeeded();
  const lines = await command.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size;
  });
  expect(lines).toBe(1);

  await command.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => command.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  await command.locator("..").getByRole("button", { name: "copy", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
});

test("setup offers a copied agent prompt and a complete manual connection flow", async ({ context, page }) => {
  await page.goto("/docs/setup");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin,
  });
  await page.reload();

  const setup = page.getByRole("region", { name: "Give this prompt to your agent." });
  const copy = setup.getByRole("button");
  await expect(copy).toHaveText("Copy prompt");
  await copy.click();
  await expect(copy).toHaveText("Copied");

  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("tokenburnmarket connect");
  expect(prompt).toContain("If upload fails, retry with `tokenburnmarket sync`, not connect.");
  expect(prompt).toContain("tokenburnmarket daemon install");
  expect(prompt).not.toContain("--interval");
  expect(prompt).toContain("00:00, 06:00, 12:00 and 18:00 UTC");
  expect(prompt).toContain("Finish only when");

  const manual = page.locator("details#manual");
  await expect(manual).toHaveAttribute("open", "");
  await expect(manual.locator("code")).toHaveText([
    "node --version",
    "npm install --global tokenburnmarket@latest",
    "tokenburnmarket connect",
    "tokenburnmarket daemon install",
    "tokenburnmarket status",
  ]);
  await expect(manual).toContainText("confirm the account in the terminal");
  const update = page.locator("#update");
  await expect(update).toContainText("The install command below assumes npm.");
  await expect(update).toContainText("use that manager to install the latest CLI");
  await expect(update).toContainText("Check the version below to confirm the CLI on your PATH is current before syncing.");
  await expect(update.locator("code")).toHaveText([
    "tokenburnmarket update",
    "npm install --global tokenburnmarket@latest",
    "tokenburnmarket --version",
    "tokenburnmarket sync --all",
    "tokenburnmarket daemon install",
    "systemctl --user restart tokenburnmarket",
    "schtasks /End /TN tokenburnmarket",
    "schtasks /Run /TN tokenburnmarket",
    "tokenburnmarket status",
  ]);
  for (const platform of [/macOS/i, /Linux \(systemd\)/i, /Windows \(Task Scheduler\)/i]) {
    await expect(update.getByRole("heading", { name: platform })).toBeVisible();
  }
});
