// A rough dollar figure per agent run, for the per-area daily scan budget (batches.ts). An estimate, not the bill:
// compare it with the Apify, Bright Data and Anthropic dashboards and tune the env vars.
//
// Defaults: Apify $0.035 per shop scraped (a few live /extract/shops runs); Bright Data $0.0015 per request
// (api/README); claude-opus-5-5 at $4 / $20 per million input / output tokens; web search $10 per 1,000.

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const PRICES = {
  apifyPerShop: envNumber("DIBS_COST_APIFY_PER_SHOP", 0.035),
  brightdataPerRequest: envNumber("DIBS_COST_BRIGHTDATA_PER_REQUEST", 0.0015),
  inputPerMillion: envNumber("DIBS_COST_INPUT_PER_MTOK", 4),
  outputPerMillion: envNumber("DIBS_COST_OUTPUT_PER_MTOK", 20),
  webSearch: envNumber("DIBS_COST_WEB_SEARCH", 0.01),
};

export function estimateRunUsd(run: {
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
  brightdata_requests: number;
  stores_scanned: number;
}): number {
  const usd =
    run.stores_scanned * PRICES.apifyPerShop +
    run.brightdata_requests * PRICES.brightdataPerRequest +
    (run.input_tokens * PRICES.inputPerMillion + run.output_tokens * PRICES.outputPerMillion) / 1_000_000 +
    run.web_search_requests * PRICES.webSearch;
  return Math.round(usd * 10_000) / 10_000;
}
