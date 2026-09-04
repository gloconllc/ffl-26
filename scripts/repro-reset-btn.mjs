import pkg from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

// Auto-accept the confirm() dialog so the test can exercise the real destructive path.
page.on("dialog", async (dialog) => {
  console.log("Dialog shown:", dialog.type(), "-", dialog.message());
  await dialog.accept();
});

await page.goto("http://localhost:8532/draft-app/draft-app.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);

await page.click('.tab-btn[data-panel="board"]');
await page.waitForTimeout(200);
await page.click("#setup-start-btn");
await page.waitForTimeout(500);

const resetBtn = page.locator("#board-reset-btn");
console.log("Reset button visible on board:", await resetBtn.isVisible());
console.log("Setup card hidden (mid-draft):", await page.locator("#setup-card").isHidden());

await resetBtn.click();
await page.waitForTimeout(400);

const setupVisible = await page.locator("#setup-card").isVisible();
const boardHidden = await page.locator("#board-content").isHidden();
// storage.js namespaces every key as "ffl26:<name>" — this test previously read the
// bare "draft_state" key, which never existed, so stateAfter was always JS `null`
// (not the string "null" the check below expects) regardless of whether reset worked.
const stateAfter = await page.evaluate(() => localStorage.getItem("ffl26:draft_state"));

console.log("After reset — setup card visible:", setupVisible, " board hidden:", boardHidden, " draft_state:", stateAfter);

const ok = setupVisible && boardHidden && stateAfter === "null";
console.log("\nPage errors:", pageErrors.length ? pageErrors : "none");
console.log(ok && pageErrors.length === 0 ? "RESULT: PASS" : "RESULT: FAIL");

await browser.close();
process.exit(ok && pageErrors.length === 0 ? 0 : 1);
