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

  await expect(page.getByRole("code").first()).toHaveText("npx tokenburnmarket connect");
});

test("the world leaderboard renders", async ({ page }) => {
  await page.goto("/leaderboard");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("World");
  // The season and metric switches are the board, whether or not anyone is on it.
  await expect(page.getByRole("link", { name: "this week" })).toBeVisible();
});

const docsPages = [
  { path: "/docs", heading: "How this works." },
  { path: "/docs/setup", heading: "One command binds your machine." },
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
