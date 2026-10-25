import geospatial from "@convex-dev/geospatial/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();
// Three geo indexes: active deals (the feed and map), saved locations (who to alert about a new deal) and scan
// areas (which area a new saved location joins).
app.use(geospatial, { name: "dealGeo" });
app.use(geospatial, { name: "locationGeo" });
app.use(geospatial, { name: "areaGeo" });
app.use(rateLimiter);

export default app;
