# ACTION_LOG.md — chronological record of what was actually done

Newest entries at the top. One entry per meaningful action, not per keystroke.

## 2026-08-03
- Initialized git repo at `/home/claude/ffl-26`, set `origin` to
  https://github.com/gloconllc/ffl-26.git (not yet pushed — no commits made yet).
- Installed 4 skills from machina-sports/sports-skills via `npx skills add`:
  nfl-data, kalshi, betting, markets.
- Cloned (research only, not installed as a dependency) two reference repos:
  - derekrbreese/fantasy-football-mcp-public — mined for algorithm patterns (VORP,
    lineup optimizer, matchup analyzer, projection-enhancement layer). Decision: port
    logic into our own TS serverless functions, do not run as a separate service.
  - machina-sports/sports-skills — source of the installed skills above.
- Reviewed a user-supplied table of sport data sources (mostly soccer/track/volleyball/
  F1 — not NFL-relevant) and a user-supplied external case study on building a similar
  app ("FantasyAgent," adamrubinsky.com). Extracted transferable lessons into
  CONTEXT.md; did not change stack/architecture.
- Set architecture: static frontend + small Vercel serverless functions, localStorage/
  IndexedDB persistence, free/public data only (explicitly skip PFF/FantasyPros
  scraping), Kalshi/Polymarket surfaced as labeled market-signal data only (not
  disguised picks or trade recommendations).
- Created `docs/CONTEXT.md`, `docs/ACTION_LOG.md`, `docs/ISSUE_LOG.md` as persistent
  cross-session documentation, per lesson from the FantasyAgent case study.
- Repo folder structure created: `/api`, `/public/css`, `/public/js/engine`, `/docs`.
- Still waiting on Group 1 league facts from user (league ID, team count, scoring
  quirks, draft date/rounds) — asked three times, not yet answered.
