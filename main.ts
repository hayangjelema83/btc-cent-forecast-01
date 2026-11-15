// btc-cent-forecast-01 entry (Node 22, standard library only): a shrunk 12-hour
// log-linear trend forecast of Bitcoin's price 240 minutes ahead.
//
// Design
// -------
// For each case, take the last 12 hours (720 closes) of the 72 hours given,
// fit an ordinary-least-squares line to log(price) against minute index, and
// extrapolate that slope 240 minutes forward at half strength:
//
//   guess = last * exp(0.5 * slope * 240)
//
// Half-strength shrinkage is deliberate: a 4-hour-ahead BTC move is mostly
// unpredictable, so the honest median forecast sits close to the checkpoint
// price, and a full-strength extrapolation of a 12-hour trend regularly
// overshoots. The guess is clamped to within +/-1.5% of the checkpoint close
// as a safety rail against a wild slope (e.g. a flash move inside the window);
// in practice testing the clamp never bound.
//
// Why this shape, and why not the alternatives
// --------------------------------------------
// Measured on the kit's practice cases p00..p04 (whose actuals are the next
// case's checkpoint close) and on a 264-sample within-window backtest
// (checkpoints every 60 minutes inside the practice windows, actual = price
// +240 minutes):
//
//   persistence (house baseline):  practice 47,054.7   backtest 45,116.6
//   this entry (12h linreg, 0.5): practice 44,299.4   backtest 45,054.9
//
// So it beats persistence on both evaluations (about -5.9% on the practice
// cases, about -0.1% on the backtest). Variants that looked better on one
// evaluation alone were rejected as regime luck: a median-4h-drift forecaster
// and a mean-reversion blend both beat persistence on the backtest but lost
// to it on the practice cases (the practice window is a steady downtrend,
// where mean reversion pays to chase the fall), and an EWMA-drift forecaster
// that won the practice cases was the worst of all on the backtest. This
// entry is the one variant that beat persistence on both, with the smallest
// worst case among the trend followers.
//
// The program is deterministic: fixed arithmetic on the input prices only, no
// randomness, no clock, no network. Two runs on the same case write the same
// bytes. It reads every <id>.in in the input directory (the grader runs one
// case at a time) and writes <id>.out per case, exactly as the starter does:
//
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Minutes of history the trend is fitted on (12 hours). */
const FIT_MINUTES = 720;
/** Horizon of the forecast, in minutes. */
const HORIZON_MINUTES = 240;
/** Shrinkage applied to the extrapolated trend (0 = persistence, 1 = full). */
const SHRINK = 0.5;
/** Safety rail: the guess never moves more than this fraction from the last close. */
const MAX_MOVE = 0.015;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/**
 * Forecast one market: OLS slope of log(price) over the last FIT_MINUTES
 * closes, extrapolated HORIZON_MINUTES ahead at SHRINK strength, from the
 * last close, clamped to +/-MAX_MOVE around it. Falls back to the last close
 * (persistence) when the series is too short or not finite.
 */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const last = m.prices[m.prices.length - 1] as number;
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) {
    throw new Error(`market ${m.id}'s last price is not a finite positive number`);
  }
  const k = Math.min(FIT_MINUTES, m.prices.length);
  if (k < 2) return price5(last);
  const window = m.prices.slice(m.prices.length - k);
  // OLS slope of log(price) on minute index 0..k-1. x-mean is (k-1)/2 exactly.
  const xMean = (k - 1) / 2;
  let ySum = 0;
  const logs: number[] = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    const p = window[i] as number;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return price5(last);
    const y = Math.log(p);
    logs[i] = y;
    ySum += y;
  }
  const yMean = ySum / k;
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    const dx = i - xMean;
    num += dx * (logs[i] as number - yMean);
    den += dx * dx;
  }
  if (den === 0) return price5(last);
  const slope = num / den; // log-price change per minute
  const drift = SHRINK * slope * HORIZON_MINUTES;
  let guess = last * Math.exp(drift);
  guess = Math.min(last * (1 + MAX_MOVE), Math.max(last * (1 - MAX_MOVE), guess));
  return price5(guess);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
// Fail loudly on a misconfigured run instead of silently writing nothing.
if (inputs.length === 0) throw new Error(`no .in files in ${INPUT_DIR}`);
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  const price = forecast(c.markets[0] as CaseMarket);
  // The scorer reads one finite price on the 5-decimal grid; refuse to write anything else.
  if (!Number.isFinite(price) || price <= 0 || price5(price) !== price) {
    throw new Error(`${file}: forecast ${price} is not a finite price on the 5-decimal grid`);
  }
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price }] })}\n`);
}
