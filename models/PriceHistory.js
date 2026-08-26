// models/PriceHistory.js
// One price snapshot per (product, supermarket, day). The scraper appends a
// point each run; the unique day index keeps it to one point per day so the
// series stays clean and grows into a real price-history graph over time.
const mongoose = require('mongoose');

const priceHistorySchema = new mongoose.Schema({
  normalizedName: { type: String, required: true },
  supermarket:    { type: String, required: true },
  price:          { type: Number, required: true },
  day:            { type: String, required: true }, // YYYY-MM-DD (client-agnostic UTC day)
  date:           { type: Date,   default: Date.now },
}, { timestamps: false });

// One snapshot per product/store/day
priceHistorySchema.index({ normalizedName: 1, supermarket: 1, day: 1 }, { unique: true });
/* The {normalizedName, day} series-lookup index was removed on 2026-08-24.
   It cost ~15 MB on a cluster that was refusing every write at 512/512 MB, and
   nothing queries it: the frontend no longer renders price history at all.
   Note it MUST stay out of the schema, not merely be dropped in the database —
   Mongoose recreates schema-declared indexes on connect, so a dropped index
   reappears the next time the scraper or the API starts up. Restore this line
   if a price-series feature comes back. */

/* Retention. Without this the collection grows without limit — it reached
   1.78M rows and filled the cluster, which blocked writes for 24 days while
   the scraper kept reporting success.

   Seven days, not fourteen. Measured on 2026-08-26, one day of history is
   68,269 rows costing 30.1 MB — of which 24.5 MB is index, because the unique
   {normalizedName, supermarket, day} key over long Greek product names costs
   376 bytes a row against 86 bytes of actual data. Projected to a full window:
   14 days reaches ~421 MB of history and ~467 MB of cluster, 91% of the 512 MB
   quota, which is the same wall this collection hit before. Seven days lands at
   ~211 MB of history and ~257 MB of cluster — half the quota, with room for the
   catalogue to grow.

   Changing this number alone does NOT change the live index: MongoDB ignores a
   differing expireAfterSeconds on an index that already exists. Run
   `storage-maintenance.js --set-ttl-days=7 --confirm` to apply it. */
priceHistorySchema.index({ date: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('PriceHistory', priceHistorySchema);
