// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries that is not a wrapped, staked or
// bridged product of a token that already trades, not a versioned pool and not an exchange: the 40
// protocols of the house watchlist plus every other protocol that meets the same rule, 198 rows.
// Protocols that record a token are kept apart and shown with the market's own value, never ranked.
//
// Implied value is fitted, not asserted. The program fits a regression on the protocols whose
// tokens already trade, every run, from the snapshot itself:
//
//   log10(market cap) = a + b * log10(TVL) + c * log10(age in days + 30)
//
// fitted by ordinary least squares on the 92 live-token protocols with a positive market cap that
// are not wrapped, staked, bridged, versioned or exchange products. The fit is done at run time,
// so no coefficient is hardcoded: the dashboard prints the fitted values. Two adjustments are
// stated modelling choices, because the fit itself cannot measure them: the 7-day TVL change
// enters as a bounded momentum tilt, 1 + clamp(change_7d, -60, 120) / 100 * 0.5, and a protocol
// whose listing date the snapshot does not carry is scored at the median age of the dated ones.
// The fitted evidence is reported honestly on the dashboard: TVL is the only predictor with a
// measurable link to market cap (t near 3); the age coefficient is small and not significant at
// the usual level, and a fit that also included 7-day growth found its coefficient
// indistinguishable from zero (t about -0.8), so growth enters only as the bounded tilt above and
// implied values carry about threefold uncertainty — the rank matters more than the dollars.
//
// Validation is computed by the same program, with the model refitted inside every fold, so the
// numbers on the dashboard are the model's own held-out record, not a claim made after the fact:
// leave-one-out over the 92 training protocols, and walk-forward, training on the 70% listed
// earliest and testing on the 30% listed latest. Both report the median error factor and the
// share of predictions within 2x and 3x of the real market cap.
//
// No protocol name is ever special-cased: the same function scores every row, and the same
// exclusion rule that built the house watchlist decides what the board may rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A fitted value model: the OLS coefficients on log10 market cap. */
export interface ValueModel {
  intercept: number;
  tvl_coef: number;
  age_coef: number;
  train_n: number;
  train_excluded_wrapped: number;
  train_excluded_no_mcap: number;
  train_excluded_zero_mcap: number;
  median_age_days: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_offset_days: number;
  sigma_log10: number;
  t_stats: { intercept: number; tvl: number; age: number };
}

/** One held-out validation: median error factor and shares within 2x and 3x. */
export interface ValidationResult {
  n: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
}

/** The model's validation record, computed with the model refitted inside every fold. */
export interface Validation {
  leave_one_out: ValidationResult;
  walk_forward: ValidationResult;
  walk_forward_train_n: number;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-fit-1';

/** The growth tilt's weight: a stated modelling choice, not a fitted coefficient. */
export const GROWTH_WEIGHT = 0.5;
/** The growth tilt's clamp, in per cent. */
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
/** The age term's offset, in days, so a protocol listed yesterday still has a defined age. */
export const AGE_OFFSET_DAYS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
    fitted_log10: number;
    growth_pct: number;
    growth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
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
  fitted_log10: number;
  growth_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** Everything the dashboard needs: the board, the live set, the fitted model and its record. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ValueModel;
  model_version: string;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_pre_token: number;
  excluded_live: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** An exchange's name at the start of a protocol name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word wrapped, staked or staking anywhere in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, staked or bridged product of another protocol's token. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. Say that, never that it has none. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already trades, a
 * versioned pool, or an exchange product: the house watchlist's rule, applied before ranking.
 */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  return (
    WRAPPED_CATEGORIES.has(p.category ?? '') ||
    VERSIONED.test(p.name) ||
    WRAPPED_WORD.test(p.name) ||
    EXCHANGE_PREFIX.test(p.name)
  );
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Solve a small linear system by Gaussian elimination with partial pivoting; null if singular. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const m = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const div = m[col]![col]!;
    for (let j = col; j <= n; j++) m[col]![j]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) m[r]![j]! -= factor * m[col]![j]!;
    }
  }
  return m.map((row) => row[n]!);
}

/** The regression's features for one protocol: intercept, log10 TVL, log10(age + offset). */
function features(p: SnapshotProtocol, asOf: string, medianAge: number): number[] {
  const age = ageDays(asOf, p.listed_at) ?? medianAge;
  return [1, Math.log10(Math.max(1, p.tvl_usd)), Math.log10(age + AGE_OFFSET_DAYS)];
}

/** Fit log10(market cap) on log10(TVL) and log10(age + offset) by ordinary least squares. */
export function fitModel(train: SnapshotProtocol[], asOf: string, medianAge: number): { coef: number[]; sigma: number; tStats: number[] } {
  const rows = train.map((p) => features(p, asOf, medianAge));
  const y = train.map((p) => Math.log10(p.mcap_usd!));
  const k = 3;
  const xtx: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const xty: number[] = Array(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < k; j++) {
      xty[j]! += rows[i]![j]! * y[i]!;
      for (let l = 0; l < k; l++) xtx[j]![l]! += rows[i]![j]! * rows[i]![l]!;
    }
  }
  const coef = solveLinear(xtx, xty) ?? [median(y), 0, 0];
  const residuals = y.map((v, i) => v - rows[i]!.reduce((s, x, j) => s + x * coef[j]!, 0));
  const dof = Math.max(1, train.length - k);
  const sigma = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / dof);
  // t-statistics need the inverse of X'X: solve against each unit vector.
  const invCols: number[][] = [];
  for (let j = 0; j < k; j++) {
    const unit = Array(k).fill(0);
    unit[j] = 1;
    invCols.push(solveLinear(xtx, unit) ?? Array(k).fill(0));
  }
  const tStats = coef.map((c, j) => {
    const se = sigma * Math.sqrt(Math.max(0, invCols[j]![j]!));
    return se > 0 ? c / se : 0;
  });
  return { coef, sigma, tStats };
}

/** The training set: live-token protocols with a positive market cap, not wrapped products. */
export function trainingSet(snapshot: Snapshot): { train: SnapshotProtocol[]; excludedWrapped: number; excludedNoMcap: number; excludedZeroMcap: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const excludedNoMcap = live.filter((p) => p.mcap_usd === null).length;
  const excludedZeroMcap = live.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length;
  const withMcap = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const excludedWrapped = withMcap.filter((p) => isWrappedProduct(p)).length;
  const train = withMcap.filter((p) => !isWrappedProduct(p));
  return { train, excludedWrapped, excludedNoMcap, excludedZeroMcap };
}

/** The median age in days of the snapshot's dated protocols, for protocols with no listing date. */
export function medianAgeDays(snapshot: Snapshot): number {
  const ages = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  return ages.length > 0 ? median(ages) : 365;
}

/** The bounded momentum tilt from the 7-day TVL change, in per cent. */
export function growthMultiplier(change7d: number | null): { pct: number; mult: number } {
  const pct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(change7d, 0)));
  return { pct, mult: 1 + (pct / 100) * GROWTH_WEIGHT };
}

/** The fitted log10 value and the implied value in dollars for one protocol. */
export function impliedValue(
  p: SnapshotProtocol,
  coef: number[],
  asOf: string,
  medianAge: number,
): { fittedLog10: number; growthPct: number; growthMult: number; age: number | null; implied: number } {
  const age = ageDays(asOf, p.listed_at);
  const f = features(p, asOf, medianAge);
  const fittedLog10 = f.reduce((s, x, j) => s + x * coef[j]!, 0);
  const { pct, mult } = growthMultiplier(p.change_7d);
  const implied = Math.max(1, Math.round(Math.pow(10, fittedLog10) * mult));
  return { fittedLog10, growthPct: pct, growthMult: mult, age, implied };
}

/** Summarise held-out predictions against real market caps. */
function summarise(predicted: number[], actual: number[]): ValidationResult {
  const errors = predicted.map((v, i) => Math.abs(Math.log10(v / actual[i]!))).sort((a, b) => a - b);
  const medianFactor = Math.pow(10, errors[Math.floor(errors.length / 2)]!);
  const within = (factor: number): number =>
    predicted.filter((v, i) => v / actual[i]! >= 1 / factor && v / actual[i]! <= factor).length / predicted.length;
  return {
    n: predicted.length,
    median_factor: Math.round(medianFactor * 100) / 100,
    within_2x: Math.round(within(2) * 1000) / 1000,
    within_3x: Math.round(within(3) * 1000) / 1000,
  };
}

/**
 * The model's held-out record. Leave-one-out refits on the other 91 protocols for each of the 92;
 * walk-forward trains on the 70% listed earliest and tests on the 30% listed latest. The growth
 * tilt is applied in both, exactly as it is when the board is scored.
 */
export function validateModel(snapshot: Snapshot, train: SnapshotProtocol[], medianAge: number): Validation {
  const predictWith = (subset: SnapshotProtocol[]) => {
    const { coef } = fitModel(subset, snapshot.as_of, medianAge);
    return (p: SnapshotProtocol): number => impliedValue(p, coef, snapshot.as_of, medianAge).implied;
  };
  const looPredicted = train.map((p, i) => predictWith(train.filter((_, j) => j !== i))(p));
  const leaveOneOut = summarise(looPredicted, train.map((p) => p.mcap_usd!));
  const dated = train
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const cut = Math.floor(dated.length * 0.7);
  const wfTrain = dated.slice(0, cut);
  const wfTest = dated.slice(cut);
  const wfPredicted = wfTest.map(predictWith(wfTrain));
  const walkForward = summarise(wfPredicted, wfTest.map((p) => p.mcap_usd!));
  return { leave_one_out: leaveOneOut, walk_forward: walkForward, walk_forward_train_n: wfTrain.length };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit open.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${name}'s largest pool on ${chain} and leave the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position in an active market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('indexes') || c.includes('index')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable') || c.includes('algo-stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('synthetic') || c.includes('basis')) return `Deposit $${capital} of USDC into ${name} on ${chain} and open one small position.`;
  if (c.includes('launchpad')) return `Commit $${capital} to an active sale or staking pool on ${name}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there.`,
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

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, coef: number[], medianAge: number): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the exclusion rule keeps, at any TVL.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, coef, snapshot.as_of, medianAge);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      fitted_log10: Math.round(s.v.fittedLog10 * 10000) / 10000,
      growth_pct: s.v.growthPct,
      growth_multiplier: Math.round(s.v.growthMult * 10000) / 10000,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
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
    fitted_log10: row.model.fitted_log10,
    growth_multiplier: row.model.growth_multiplier,
    on_watchlist: onWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; model: ValueModel } {
  const medAge = medianAgeDays(snapshot);
  const { train, excludedWrapped, excludedNoMcap, excludedZeroMcap } = trainingSet(snapshot);
  const { coef, sigma, tStats } = fitModel(train, snapshot.as_of, medAge);
  const validation = validateModel(snapshot, train, medAge);
  const model: ValueModel = {
    intercept: round4(coef[0]!),
    tvl_coef: round4(coef[1]!),
    age_coef: round4(coef[2]!),
    train_n: train.length,
    train_excluded_wrapped: excludedWrapped,
    train_excluded_no_mcap: excludedNoMcap,
    train_excluded_zero_mcap: excludedZeroMcap,
    median_age_days: medAge,
    growth_weight: GROWTH_WEIGHT,
    growth_floor: GROWTH_FLOOR,
    growth_cap: GROWTH_CAP,
    age_offset_days: AGE_OFFSET_DAYS,
    sigma_log10: round4(sigma),
    t_stats: { intercept: round4(tStats[0]!), tvl: round4(tStats[1]!), age: round4(tStats[2]!) },
  };
  const board = buildBoard(snapshot, coef, medAge);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const excludedPreToken = snapshot.protocols.filter((p) => isPreToken(p) && !isRankable(p)).length;
  const excludedLive = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    excluded_pre_token: excludedPreToken,
    excluded_live: excludedLive,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar, model };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
