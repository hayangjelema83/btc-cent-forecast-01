# btc-cent-forecast-01 entry

Forecast Bitcoin's price 240 minutes ahead from the 72 hours of 1-minute
closes up to each checkpoint. One program, `main.ts` (Node 22, standard
library only, no network, deterministic).

## Method

OLS trend on log prices over the last 12 hours (720 closes), extrapolated
240 minutes at half strength, from the checkpoint close, clamped to
±1.5% of that close:

```
guess = clamp(last * exp(0.5 * slope * 240), last * 0.985, last * 1.015)
```

Half-strength shrinkage is the point: a 4-hour-ahead BTC move is mostly
unpredictable, so the honest median forecast sits near the checkpoint price,
and full-strength trend extrapolation overshoots. The ±1.5% clamp is a
safety rail against a wild slope (e.g. a flash move inside the window).

## Measured performance

Practice cases p00–p04 (actuals = the next case's checkpoint close; p05's
actual is not in the kit) and a 264-sample within-window backtest
(checkpoints every 60 min, actual = price +240 min), mean absolute error
in cents:

| forecaster | practice p00–p04 | backtest (264) |
|---|---|---|
| persistence (house baseline) | 47,054.7 | 45,116.6 |
| **this entry** | **44,299.4** | **45,054.9** |

It beats persistence on both evaluations. Variants that won only one
evaluation were rejected as regime luck (median-4h-drift and mean-reversion
blends won the backtest but lost the practice cases; an EWMA-drift won the
practice cases but was worst on the backtest).

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../btc-cent-forecast-01-kit/btc-cent-forecast-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory, writes one `<id>.out` per case:
`{"forecasts":[{"case":"<id>","price":<number>}]}`. Runs in well under a
second per case (limit: 8 s).
