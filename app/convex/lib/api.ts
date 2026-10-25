// The Dibs API (api/, FastAPI), called server to server from actions. DIBS_API_URL must be reachable from Convex
// (deployed, or a tunnel to 127.0.0.1:8000 during development) and DIBS_API_KEY must match the API's.

export class DibsApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiConfigured(): boolean {
  return Boolean(process.env.DIBS_API_URL);
}

export async function dibsApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.DIBS_API_URL?.replace(/\/$/, "");
  if (!base) throw new DibsApiError(500, "DIBS_API_URL is not set (npx convex env set DIBS_API_URL ...)");
  const headers = new Headers(init.headers);
  if (process.env.DIBS_API_KEY) headers.set("X-Dibs-Key", process.env.DIBS_API_KEY);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  const resp = await fetch(`${base}${path}`, { ...init, headers });
  const text = await resp.text();
  if (!resp.ok) {
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text).detail ?? detail;
    } catch {
      // not JSON
    }
    throw new DibsApiError(resp.status, `${path}: HTTP ${resp.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return JSON.parse(text) as T;
}

// The parts of api/app/schemas.py that Convex reads.

export type ApiShop = {
  id: string;
  name: string;
  address?: string | null;
  category?: string | null;
  maps_url?: string | null;
  place_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  hours?: { day: string; hours: string }[] | null;
  found_via: "google_maps" | "named" | "mention" | "deal";
};

export type ApiDeal = {
  id?: string | null;
  shop_id?: string | null;
  shop_name: string;
  shop_handle?: string | null;
  address?: string | null;
  category: string;
  offer: string;
  code?: string | null;
  conditions: string[];
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  source_url: string;
  source_post_date?: string | null;
  verbatim_quote: string;
  confidence: "high" | "medium" | "low";
  status: "live" | "needs_check" | "stale" | "expired";
  flags: string[];
  headline?: string | null;
  title?: string | null;
  deal_types?: string[];
  kind?: "deal" | "event";
  student_only?: boolean;
  age_21?: boolean;
  est_savings_cents?: number | null;
  recurring_window?: { days: string[]; start_time?: string | null; end_time?: string | null } | null;
};

export type ApiSource = {
  url: string;
  title?: string | null;
  page_age?: string | null;
  text?: string | null;
  origin?: string | null;
  handle?: string | null;
};

export type ApiSearchResponse = {
  as_of: string;
  deals: ApiDeal[];
  rejected: { deal: Partial<ApiDeal>; reason: string }[];
  queries: string[];
  sources: ApiSource[];
  search_errors: string[];
  usage: { input_tokens: number; output_tokens: number; web_search_requests: number };
  provider: "claude_web_search" | "brightdata_serp" | "brightdata_instagram" | "user_photo" | "apify_shops" | "apify_maps";
  brightdata_requests: number;
  apify_runs: number;
  shops: ApiShop[];
  scanned?: ApiScannedShop[]; // store batches (ShopsRequest.stores): one per store sent
  transcript?: string | null;
};

export type ApiScannedShop = {
  id: string;
  posts: number;
  latest_post_date?: string | null;
  deals: number;
};

export type ApiJobStatus = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: string[];
  result?: ApiSearchResponse | null;
  error?: { status_code: number; detail: string } | null;
};
