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

// My draft slot defaults to 5 (team 1..4 pick first via simulate). Set my slot to 1 so
// MY pick is #1 — simplest way to directly control what lands on my own roster.
await page.fill("#setup-slot", "1");
await page.click("#setup-start-btn");
await page.waitForTimeout(500);

await page.click('.tab-btn[data-panel="recommend"]');
await page.waitForTimeout(400);

// Force "Recommended" mode (needs-aware + stacking-aware) via the inline selector.
await page.selectOption("#strategy-preset-inline", "recommended");
await page.waitForTimeout(300);

// Pick 1 is mine. Find and draft the top overall player (should be a top RB per the
// existing dataset ordering, e.g. Saquon Barkley) to get a real player onto my roster.
const firstRow = page.locator("#available-table tbody tr").first();
const firstName = await firstRow.locator("td").first().innerText();
console.log("Round 1 pick (mine):", firstName.trim());
await firstRow.locator(".btn-draft").click({ force: true });
await page.waitForTimeout(400);

// Now find my drafted player's team from the picks table, so we know which NFL team
// to check for stacking against.
const myTeamAbbrev = await page.evaluate(() => {
  // storage.js namespaces every key as "ffl26:<name>" — this test previously read the
  // bare "draft_state" key, which never existed, silently returning null every time.
  const state = JSON.parse(localStorage.getItem("ffl26:draft_state"));
  const myPick = state.picks.find((p) => p.teamSlot === state.myTeamSlot);
  const player = state.players.find((p) => p.providerPlayerId === myPick.providerPlayerId);
  return player.team;
});
console.log("My roster's NFL team so far:", myTeamAbbrev);

// Now simulate picks 2..N-1 so it becomes my turn again (round 2, snake order — with
// slot 1 that means pick #(2*numTeams)).
await page.click('.tab-btn[data-panel="board"]');
await page.waitForTimeout(200);
await page.click("#simulate-btn");
await page.waitForTimeout(1500);

const clockNow = await page.textContent("#on-the-clock");
console.log("On the clock after simulate:", clockNow);

await page.click('.tab-btn[data-panel="recommend"]');
await page.waitForTimeout(400);

// Grab the score-sorted (Brain-equivalent, pure) order directly from scoredAvailable
// via app internals is not exposed, so instead compare Brain vs Recommended mode's #1
// pick for any player sharing my team.
async function topPickUnder(mode) {
  await page.selectOption("#strategy-preset-inline", mode);
  await page.waitForTimeout(300);
  const rows = page.locator("#available-table tbody tr");
  const count = await rows.count();
  for (let i = 0; i < Math.min(count, 60); i++) {
    const cells = rows.nth(i).locator("td");
    const name = (await cells.nth(0).innerText()).trim();
    const team = (await cells.nth(2).innerText()).trim();
    if (i === 0) console.log(`  [${mode}] Available Players top row: ${name} (${team})`);
  }
}

// Check the actual Recommendation card (not just the raw table, which isn't
// need/stack-sorted) for whether it still puts a same-team player #1 despite the
// penalty, and confirm the reasoning surfaces the note if a same-team player is
// anywhere in the top 3.
await page.selectOption("#strategy-preset-inline", "recommended");
await page.waitForTimeout(400);
const recText = await page.locator("#recommendation-content").innerText();
console.log("\n--- Recommendation panel (Recommended mode) ---\n" + recText.slice(0, 1500));

const hasStackWarning = recText.includes("correlated outcomes") || recText.includes("bye week") || recText.includes("Same team");
console.log("\nStack warning text present in Recommended-mode panel:", hasStackWarning);

await page.selectOption("#strategy-preset-inline", "brain");
await page.waitForTimeout(400);
const recTextBrain = await page.locator("#recommendation-content").innerText();
console.log("\n--- Recommendation panel (The Brain mode) ---\n" + recTextBrain.slice(0, 800));

console.log("\nPage errors:", pageErrors.length ? pageErrors : "none");
await browser.close();
process.exit(pageErrors.length ? 1 : 0);
