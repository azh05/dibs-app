// Shared deal bookkeeping: derived times, status, the geo index and cached counts.
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { dealGeo } from "./geo";
import { computeStatus, isActive, type DealStatus } from "./status";
import { localDate, localToEpoch } from "./time";

export function dealTimes(d: {
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  timezone: string;
}): { starts_at?: number; ends_at?: number } {
  return {
    starts_at: d.start_date ? localToEpoch(d.start_date, d.start_time ?? "00:00", d.timezone) : undefined,
    // No end time stated: the deal runs to the end of its last day.
    ends_at: d.end_date ? localToEpoch(d.end_date, d.end_time ?? "23:59", d.timezone) : undefined,
  };
}

export function statusNow(deal: Pick<Doc<"deals">, "start_date" | "end_date" | "source_post_date" | "confidence" | "ended_count" | "timezone">): DealStatus {
  return computeStatus(deal, localDate(Date.now(), deal.timezone));
}

/** Keep the dealGeo index in step with the deal: active deals with coordinates are in it, nothing else is. */
export async function syncDealGeo(ctx: MutationCtx, dealId: Id<"deals">, opts: { force?: boolean } = {}) {
  const deal = await ctx.db.get("deals", dealId);
  if (!deal) return;
  const store = await ctx.db.get("stores", deal.store_id);
  const hasCoords = store?.lat !== undefined && store?.lng !== undefined;
  const want = hasCoords && isActive(deal.status);
  if (want && (!deal.geo_indexed || opts.force)) {
    await dealGeo.insert(
      ctx,
      dealId,
      { latitude: store!.lat!, longitude: store!.lng! },
      { store_type: deal.store_type ?? "", deal_types: deal.deal_types },
    );
  } else if (!want && deal.geo_indexed) {
    await dealGeo.remove(ctx, dealId);
  }
  if (deal.geo_indexed !== want || deal.has_coords !== hasCoords)
    await ctx.db.patch("deals", dealId, { geo_indexed: want, has_coords: hasCoords });
}

/** Recompute status (e.g. after a confirmation or as days pass) and fix the geo index. Returns the new status. */
export async function refreshStatus(ctx: MutationCtx, deal: Doc<"deals">): Promise<DealStatus> {
  const status = statusNow(deal);
  if (status !== deal.status) {
    await ctx.db.patch("deals", deal._id, { status });
    await syncDealGeo(ctx, deal._id);
  }
  return status;
}
