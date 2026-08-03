// Shared, provider-agnostic types. The scoring/recommendation engine in /shared
// should only ever depend on these — never on Yahoo- or ESPN-specific shapes.
// See docs/CONTEXT.md "ESPN Fantasy integration — architecture decision" for why
// this abstraction exists.

export type Provider = "yahoo" | "espn";

export interface CanonicalPlayer {
  // Cross-provider identity resolution is a known hard problem (see
  // docs/CONTEXT.md — "Cross-source player ID mismatch"). providerPlayerId is
  // provider-specific; nflId (once we wire in a canonical NFL ID source) is what
  // downstream code should key on wherever possible.
  provider: Provider;
  providerPlayerId: string;
  nflId?: string;
  name: string;
  team: string; // NFL team abbreviation, e.g. "SF"
  position: string; // "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | ...
  byeWeek?: number;
  injuryStatus?: string;
}

export interface RosterSlot {
  slot: string; // e.g. "QB", "FLEX", "BN", "IR"
  eligiblePositions: string[];
  player: CanonicalPlayer | null;
}

export interface LeagueSettings {
  provider: Provider;
  leagueId: string;
  leagueName: string;
  season: number;
  numTeams: number;
  scoringType: "PPR" | "HALF_PPR" | "STANDARD" | "CUSTOM";
  rosterSlots: { slot: string; count: number; eligiblePositions: string[] }[];
  draftType?: "snake" | "auction";
  isKeeper?: boolean;
  raw?: unknown; // original provider payload, kept for debugging only
}

export interface TeamRoster {
  provider: Provider;
  teamId: string;
  teamName: string;
  slots: RosterSlot[];
}

export interface DraftPick {
  provider: Provider;
  pickNumber: number;
  round: number;
  teamId: string;
  player: CanonicalPlayer;
}
