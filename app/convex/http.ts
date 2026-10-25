import { httpRouter } from "convex/server";
import { Webhook } from "svix";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

/** Clerk → Convex: user.created / user.updated / user.deleted, signed with Svix. Delivery is at least once and
 * unordered, so events are deduped on svix-id and stale updates are ignored by updated_at. */
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return new Response("CLERK_WEBHOOK_SECRET not set", { status: 500 });
    const payload = await request.text();
    const headers = {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    };
    let event: { type: string; data: Record<string, unknown> };
    try {
      new Webhook(secret).verify(payload, headers); // svix 2.x: throws on a bad signature, returns nothing
      event = JSON.parse(payload);
    } catch {
      return new Response("bad signature", { status: 400 });
    }
    if (!(await ctx.runMutation(internal.users.recordWebhook, { svixId: headers["svix-id"] }))) {
      return new Response(null, { status: 200 }); // replay
    }
    const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN ?? "";
    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const d = event.data;
        await ctx.runMutation(internal.users.upsertFromClerk, {
          issuer,
          data: {
            id: d.id as string,
            username: d.username as string | null,
            first_name: d.first_name as string | null,
            last_name: d.last_name as string | null,
            image_url: d.image_url as string | null,
            primary_email_address_id: d.primary_email_address_id as string | null,
            primary_phone_number_id: d.primary_phone_number_id as string | null,
            email_addresses: (d.email_addresses as unknown[]) ?? [],
            phone_numbers: (d.phone_numbers as unknown[]) ?? [],
            public_metadata: d.public_metadata ?? {},
            updated_at: d.updated_at as number | undefined,
          },
        });
        break;
      }
      case "user.deleted":
        if (typeof event.data.id === "string") await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId: event.data.id });
        break;
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
