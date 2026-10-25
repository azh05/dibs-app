import geospatial from "@convex-dev/geospatial/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
// Two geo indexes: active deals (the feed and map) and saved locations (who to alert about a new deal).
app.use(geospatial, { name: "dealGeo" });
app.use(geospatial, { name: "locationGeo" });
app.use(rateLimiter);

export default app;
