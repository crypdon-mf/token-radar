// Token Radar's model, radar-2. A snapshot of the protocol universe goes in; a ranked board
// comes out.
//
// The board starts from the snapshot's watchlist (the floor, never a ceiling) and then adds
// every other pre-token protocol below that floor which the house's own watchlist rule would
// keep. A row qualifies when it records no token and is not a wrapped, staked or bridged product
// of a token that already trades, nor a versioned pool of another protocol. The rule is the
// house's, run over the whole snapshot instead of only the forty above the floor: forty-eight
// below-floor protocols a looser rule would have ranked are left out here, because a wrapped or
// staked product is not a launch worth farming.
//
// One function scores every row, from the snapshot's own figures only:
//
//   base     = tvl_usd x 0.30
//   growth   = clamp(change_7d, -60, 150), as a per cent
//   growth x = 1 + (growth / 100) x 0.6
//   inflow   = tvl_usd x max(growth, 0) / 100           (weekly dollar inflow)
//   speed x  = 1 + min(inflow, $500M) / $500M x 0.25
//   age x    = 0.55 + min(age_days, 1460) / 1460 x 0.45  (age_days unknown: 365)
//   reach x  = 1 + min(chains, 5) x 0.03
//   implied  = round(base x growth x x speed x x age x x reach x)
//
// TVL is the size of the prize, the seven-day change is its direction, the weekly dollar inflow
// is its speed in money rather than per cent, the age with no token is how long the launch has
// been overdue, and the chain count is how broad the surface is that a token would cover. No
// protocol name is ever special-cased: the same function scores every row, and the dashboard
// recomputes each row from these figures so the page and the board always agree.

/** One protocol as the sealed input carries it: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The constants the model runs on, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  velocity_cap_usd: number;
  velocity_weight: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  velocity_cap_usd: 500_000_000,
  velocity_weight: 0.25,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 5,
};

/** The version the dashboard names. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: what to do, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    weekly_inflow_usd: number;
    velocity_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard reads it, with the farm plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  velocity_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A protocol whose token already trades: the board shows the market's value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model behind them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** `value` when it is a finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, at least zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Every factor and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; inflow: number; velocityMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const inflow = Math.max(0, Math.round((protocol.tvl_usd * Math.max(growthPct, 0)) / 100));
  const velocityMult = 1 + (Math.min(inflow, model.velocity_cap_usd) / model.velocity_cap_usd) * model.velocity_weight;
  const years = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(years, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(protocol.chains.length, model.breadth_max_chains) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * velocityMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, inflow, velocityMult, maturityMult, breadthMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole wrapped, staked or staking word anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol may not begin with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** True when the protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * True when the board may rank a protocol: pre-token, and not a wrapped, staked or bridged
 * product of a protocol whose token already trades. This is the house's watchlist rule, run over
 * the whole snapshot rather than only the protocols above the floor.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const e of EXCHANGE_PREFIXES) if (p.name.startsWith(e)) return false;
  return true;
}

/** The snapshot's protocols keyed by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The ranked board, strongest first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries (it
  // cannot, but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, by TVL. A chosen
  // protocol stays chosen: this never replaces a watchlist row.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      weekly_inflow_usd: s.inflow,
      velocity_multiplier: round4(s.velocityMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One farm step as a single string: its action, then its cost and time, inside 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocol's first named chain, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** True when the protocol touches Ethereum mainnet, where one transaction costs more than on a rollup. */
function onEthereum(p: SnapshotProtocol): boolean {
  return p.chains.some((c) => c.toLowerCase() === 'ethereum');
}

/** The gas one transaction costs on this protocol's chains. */
function gasFor(p: SnapshotProtocol): string {
  return onEthereum(p) ? 'about $6 of gas' : 'about $1 of gas';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category's pair of actions: the first thing to do on the protocol, and a second, different
 * thing, so the farm is not a single deposit. A rule matches when its words appear in the
 * protocol's category; the first match wins, and the last rule is the fallback for anything else.
 * The words are the snapshot's own category names, never a list of protocol names.
 */
interface CategoryRule {
  words: string[];
  action: (name: string, capital: number, chain: string) => string;
  second: (name: string, capital: number, chain: string) => string;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    words: ['lend', 'cdp', 'collateral'],
    action: (n, c, ch) => `Supply $${c} of USDC to ${n} on ${ch} and keep the position open.`,
    second: (n, c, ch) => `Borrow $${Math.max(25, Math.round(c / 2))} against the deposit on ${n} and swap half of it back to USDC on ${ch}.`,
  },
  {
    words: ['dex', 'yield', 'leveraged farm'],
    action: (n, c, ch) => `Provide $${c} of liquidity to ${n}'s main pool on ${ch} and keep the position open.`,
    second: (n, c, ch) => `Stake the LP receipt from ${n} in its rewards contract on ${ch} so the position earns twice.`,
  },
  {
    words: ['bridge'],
    action: (n, c, ch) => `Bridge $${c} of USDC to ${ch} through ${n} and use the bridged funds in its app.`,
    second: (n, c, ch) => `Use the bridged funds to open a small position in an app on ${ch} and keep the receipt.`,
  },
  {
    words: ['staking', 'restak'],
    action: (n, c, ch) => `Stake $${c} of the chain's staking asset through ${n} and keep the receipt.`,
    second: (n, c, ch) => `Restake the staking receipt through ${n} on ${ch} and keep the second receipt.`,
  },
  {
    words: ['perpetual', 'derivative'],
    action: (n, c, ch) => `Deposit $${c} of USDC as margin on ${n} and open one small hedge.`,
    second: (n, c, ch) => `Close the hedge on ${n} after a week and open a fresh one, so the account shows two trades.`,
  },
  {
    words: ['prediction'],
    action: (n, c, ch) => `Fund $${c} and place one market position on ${n}.`,
    second: (n, c, ch) => `Settle the first market position on ${n} and place a second one with $${Math.max(25, Math.round(c / 2))}.`,
  },
  {
    words: ['curator', 'allocator'],
    action: (n, c, ch) => `Deposit $${c} into a ${n} vault on ${ch} and keep the shares.`,
    second: (n, c, ch) => `Deposit $${Math.max(25, Math.round(c / 2))} into a second ${n} vault on ${ch} and keep both share receipts.`,
  },
  {
    words: ['stable'],
    action: (n, c, ch) => `Mint or deposit $${c} of the stable asset through ${n} on ${ch}.`,
    second: (n, c, ch) => `Use the minted stable asset to supply a lending pool on ${ch} through ${n}.`,
  },
  {
    words: ['rwa'],
    action: (n, c, ch) => `Mint $${c} of the protocol's yield asset on ${ch} and hold it.`,
    second: (n, c, ch) => `Use the yield asset as collateral in a lending pool on ${ch} and keep the loan small.`,
  },
  {
    words: ['insurance'],
    action: (n, c, ch) => `Buy $${c} of cover from ${n} on ${ch} and keep the policy.`,
    second: (n, c, ch) => `Renew the cover from ${n} for a second period on ${ch} before the first ends.`,
  },
  {
    words: [],
    action: (n, c, ch) => `Deposit $${c} of USDC into ${n} on ${ch} and keep the position open.`,
    second: (n, c, ch) => `Make a second deposit of $${Math.max(25, Math.round(c / 2))} into ${n} on ${ch} a week after the first.`,
  },
];

/** The first rule whose words appear in the protocol's category, or the fallback rule. */
function ruleFor(p: SnapshotProtocol): CategoryRule {
  const c = (p.category ?? '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.words.length === 0) return rule;
    if (rule.words.some((w) => c.includes(w))) return rule;
  }
  return CATEGORY_RULES[CATEGORY_RULES.length - 1]!;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan comes from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 * Gas follows whether the protocol touches Ethereum mainnet, capital follows its TVL, and the hold
 * follows how long it has run with no token.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  const rule = ruleFor(p);
  const half = Math.max(25, Math.round(capital / 2));
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: rule.action(p.name, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: rule.second(p.name, capital, chain),
      cost: `$${half} of capital and ${gas}`,
      time: '10 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row in the compact form data.js carries, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    velocity_multiplier: row.model.velocity_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const totalImplied = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: totalImplied,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** One required field of a JSON object, or a refusal naming it. */
function need(o: Record<string, unknown>, key: string, what: string): unknown {
  const v = o[key];
  if (v === undefined) throw new SnapshotError(`snapshot.json has no ${what}`);
  return v;
}

/** A protocol entry out of one JSON value, or a refusal naming its position. */
function parseProtocol(v: unknown, i: number): SnapshotProtocol {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
  const p = v as Record<string, unknown>;
  const slug = p.slug;
  const name = p.name;
  const tvl = p.tvl_usd;
  if (typeof slug !== 'string' || typeof name !== 'string' || typeof tvl !== 'number' || !Number.isFinite(tvl)) {
    throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
  }
  const chains = Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [];
  return {
    slug,
    name,
    category: typeof p.category === 'string' ? p.category : null,
    chains,
    tvl_usd: tvl,
    change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  const asOf = need(o, 'as_of', 'as_of date');
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapshotError('snapshot.json has no as_of date');
  const source = need(o, 'source', 'source');
  if (typeof source !== 'string') throw new SnapshotError('snapshot.json has no source');
  const floor = need(o, 'floor_usd', 'floor_usd');
  if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  const protocolsRaw = need(o, 'protocols', 'protocols array');
  if (!Array.isArray(protocolsRaw)) throw new SnapshotError('snapshot.json has no protocols array');
  const watchlistRaw = need(o, 'watchlist', 'watchlist of slugs');
  if (!Array.isArray(watchlistRaw) || watchlistRaw.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  return {
    as_of: asOf,
    source,
    floor_usd: floor,
    protocols: protocolsRaw.map((v, i) => parseProtocol(v, i)),
    watchlist: watchlistRaw as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const checks: Array<() => string | null> = [
    () => {
      const slugs = new Set(board.map((r) => r.slug));
      const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
      return missing.length > 0 ? `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}` : null;
    },
    () => {
      const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
      for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
      return null;
    },
    () => {
      for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
      return null;
    },
    () => {
      if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
        return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
      }
      return null;
    },
    () => {
      for (const r of board) {
        if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
        for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
        if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
      }
      return null;
    },
  ];
  for (const check of checks) {
    const issue = check();
    if (issue !== null) return issue;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
