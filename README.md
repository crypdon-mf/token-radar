# Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/crypdon-mf/token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/crypdon-mf/token-radar/reward.svg)](https://make.fun/c/token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, works out which ones still record no token and are not a wrapped or staked product of one that trades, ranks them by what their launch would be worth, and hands in a web dashboard with the board, a detail view for each protocol and the steps to farm it.

Bounty: https://make.fun/bounty/token-radar-01

## The model (radar-2)

Every row is scored by one function of the snapshot's own figures. No protocol name is special-cased.

```
implied = round( tvl_usd x 0.30
  x (1 + clamp(change_7d, -60, 150) / 100 x 0.6)
  x (1 + min(weekly inflow, $500M) / $500M x 0.25)
  x (0.55 + min(age_days, 1460) / 1460 x 0.45)
  x (1 + min(chains, 5) x 0.03) )
```

TVL is the size of the prize, the seven-day change is its direction, the weekly dollar inflow is its speed in money rather than per cent, the age with no token is how long the launch has been overdue, and the chain count is how broad the surface is that a token would cover.

## The board

The board covers the whole 40-protocol watchlist, then adds every other pre-token protocol below the $50M floor that passes the same rule the watchlist uses — 138 of them, for 178 rows in all. Protocols that are wrapped, staked or bridged products of a token that already trades are left out, as are versioned pools and exchange products. A protocol on this board records no token in the snapshot; that is DefiLlama's record, not proof it has none. Nothing here predicts whether or when a token is issued, and the implied value is this entry's own claim, never make.fun's.

## Run it

Node 22 or later, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.

## The dashboard

`dashboard/` is a static page with no network: open `out/dashboard/index.html` after a run. It shows the ranked board with a top-three spotlight, search, category and chain filters, watchlist-only and growing-only toggles, sortable columns, a live-token view of the protocols that already trade, and a detail drawer for every protocol with the model's own inputs and a seven-step farm plan with costs and times.
