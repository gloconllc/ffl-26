// Verifies the fix for: contextual scoring (schedule/odds) silently going neutral
// after a page refresh mid-draft, because loadTeamContext() was previously only ever
// called from inside startDraft() — never on boot when existing draft state is found.
import pkg from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto("http://localhost:8532/draft-app/draft-app.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);

await page.click('.tab-btn[data-panel="board"]');
await page.waitForTimeout(200);
await page.fill("#setup-slot", "1"); // pick 1 is mine — recommendation cards show immediately, no simulate needed
await page.click("#setup-start-btn");
await page.waitForTimeout(500);

// --- Simulate a genuine page refresh mid-draft (new page load, no JS state carried
// over — only what's in localStorage) and confirm team-context-2026.json gets
// fetched on boot WITHOUT calling startDraft() again. -------------------------------
const contextRequests = [];
page.on("request", (req) => {
  if (req.url().includes("team-context-2026.json")) contextRequests.push(req.url());
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
console.log("team-context-2026.json fetched on boot (no startDraft() call):", contextRequests.length > 0);

await page.click('.tab-btn[data-panel="recommend"]');
await page.waitForTimeout(400);
const ctxScores = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("#recommendation-content .tier-bar-row"));
  return rows
    .filter((r) => r.querySelector(".tier-bar-label")?.textContent.trim() === "Ctx")
    .map((r) => r.querySelector(".tier-bar-fill")?.style.width);
});
console.log("Ctx tier bar widths in top-3 recommendation cards:", ctxScores);
// Neutral (no data) contextual score renders as a flat 50% bar for every player; real
// schedule/odds data varies player-to-player, so seeing more than one distinct value
// (or any value other than exactly "50%") confirms real context data is in play.
const gotScores = ctxScores.length > 0;
const allNeutral = gotScores && ctxScores.every((w) => w === "50%");
console.log("Actually captured Ctx bar values:", gotScores);
console.log("All Ctx bars stuck at neutral 50% (would indicate the bug persists):", allNeutral);

console.log("\nPage errors:", pageErrors.length ? pageErrors : "none");
const ok = contextRequests.length > 0 && gotScores && !allNeutral && pageErrors.length === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
