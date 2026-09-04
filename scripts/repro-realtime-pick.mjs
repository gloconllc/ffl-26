import pkg from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => pageErrors.push(err.message + "\n" + (err.stack || "")));

await page.goto("http://localhost:8532/draft-app/draft-app.html", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// Clear any prior localStorage state so this is a clean fresh draft.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.click('.tab-btn[data-panel="board"]');
await page.waitForTimeout(300);

console.log("Starting draft...");
await page.click("#setup-start-btn");
await page.waitForTimeout(800);

const clockText = await page.textContent("#on-the-clock");
console.log("On the clock:", clockText);

// #available-table lives under the Recommendation tab's panel, not the Draft
// board panel — switch there so it's actually visible/interactable.
await page.click('.tab-btn[data-panel="recommend"]');
await page.waitForTimeout(400);

const rowsCount = await page.$$eval("#available-table tbody tr", (rows) => rows.length);
console.log("Available table rows rendered:", rowsCount);

const firstBtnLocator = page.locator("#available-table tbody .btn-draft").first();
const btnInfo = await firstBtnLocator.evaluate((el) => ({
  text: el.textContent.trim(),
  disabled: el.disabled,
  classes: el.className,
}));
console.log("First Draft button:", btnInfo);

if (btnInfo.disabled) {
  throw new Error("FAIL: Draft button is still disabled — real-time any-team logging did not take effect");
}

await firstBtnLocator.scrollIntoViewIfNeeded();
await firstBtnLocator.click({ force: true, timeout: 5000 });
await page.waitForTimeout(500);

const clockAfterPick1 = await page.textContent("#on-the-clock");
console.log("On the clock after pick 1:", clockAfterPick1);

const secondBtnLocator = page.locator("#available-table tbody .btn-draft").first();
const btn2Info = await secondBtnLocator.evaluate((el) => ({ text: el.textContent.trim(), disabled: el.disabled, classes: el.className }));
console.log("Draft button on pick 2 (should now be an opponent's turn):", btn2Info);

if (btn2Info.disabled) throw new Error("FAIL: opponent-turn Draft button is disabled — real-time logging broken");
// The real requirement is that the button always names WHICH team the pick will be
// logged for, so you can't silently record an opponent's pick against your own roster
// mid-draft. The 2026-09-04 UI rebuild shortened the label from "Draft (Team 2)" to
// "Log T2" to fit the denser table — same guarantee, fewer characters — so this
// accepts either spelling rather than pinning the exact old copy.
if (!/T(?:eam )?\d+/.test(btn2Info.text) && !/YOU/i.test(btn2Info.text)) {
  throw new Error(`FAIL: button label on pick 2 doesn't identify the team: "${btn2Info.text}"`);
}

await secondBtnLocator.scrollIntoViewIfNeeded();
await secondBtnLocator.click({ force: true, timeout: 5000 });
await page.waitForTimeout(500);

const clockAfterPick2 = await page.textContent("#on-the-clock");
console.log("On the clock after pick 2:", clockAfterPick2);

// Sanity: picks table / board should now show 2 recorded picks.
const pickRowCount = await page.$$eval("#picks-table tbody tr, .picks-table tbody tr", (rows) => rows.length).catch(() => -1);
console.log("Recorded picks rows (if selector matched):", pickRowCount);

await page.screenshot({ path: "/tmp/realtime-pick-after2.png", fullPage: true });

console.log("\n--- Console errors:", consoleErrors.length ? consoleErrors : "none");
console.log("--- Page errors:", pageErrors.length ? pageErrors : "none");

const failed = pageErrors.length > 0;
await browser.close();

if (failed) {
  console.log("\nRESULT: FAIL (uncaught page errors)");
  process.exit(1);
} else {
  console.log("\nRESULT: PASS");
}
