# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kobyu1/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kobyu1/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, fits a value model on the protocols whose tokens already trade, and ranks the 198 pre-token protocols that are not wrapped, staked or bridged products by implied value — with a costed farm plan for each one. The dashboard is sortable and filterable, opens a detail view per protocol, and keeps the live-token protocols apart at the market's own value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
```

`main.ts` (Node 22, standard library only) reads the snapshot, fits the model, validates it held-out (leave-one-out and walk-forward, refitted inside every fold), writes `board.json`, `data.js`, the dashboard and the screenshots into the output directory, and writes `dossier.json` last.

---

Entered on [make.fun](https://make.fun/?ref=token-radar&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
