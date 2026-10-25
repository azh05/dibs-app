import type { AuthConfig } from "convex/server";

// Clerk's Frontend API URL (Clerk dashboard → Convex integration), e.g. https://verb-noun-00.clerk.accounts.dev.
// Set with `npx convex env set CLERK_JWT_ISSUER_DOMAIN <url>`.
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
} satisfies AuthConfig;
