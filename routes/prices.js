// routes/prices.js — Smart Search Engine v3 (EN+GR, transliteration, fuzzy)
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');
const PriceHistory = require('../models/PriceHistory');


const {
  EN_TO_GR,
  normalize,
  escapeRegex,
  scoreMultiWord,
  buildPhoneticRegex,
  expandQuery,
} = require('../services/productSearchEngine');

// ── GET / — Pagination ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const products = await Product.find({})
      .sort({ dateScraped: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const total = await Product.countDocuments();
    res.json({ products, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: 'Σφάλμα ανάκτησης προϊόντων' });
  }
});

// ── GET /search — Smart Search ────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const q        = (req.query.q || '').trim().slice(0, 100); // max 100 chars
    const rawQuery = q;
    const store    = req.query.store;

    if (q.length < 2) return res.json([]);

    const storeFilter = (store && store !== 'Όλα') ? { supermarket: store } : {};

    const termVariants = expandQuery(rawQuery);
    const seenIds = new Set();
    let allCandidates = [];

    // Try each term variant: AND query per variant
    for (const terms of termVariants) {
      if (!terms.length) continue;

      const regexFilters = terms.map(term => ({
        normalizedName: { $regex: buildPhoneticRegex(term), $options: 'i' }
      }));

      const candidates = await Product.find({ $and: regexFilters, ...storeFilter })
        .select('name price supermarket imageUrl category normalizedName')
        .sort({ price: 1 })
        .limit(100)
        .lean();

      for (const c of candidates) {
        if (!seenIds.has(c._id.toString())) {
          seenIds.add(c._id.toString());
          allCandidates.push({ ...c, _terms: terms });
        }
      }
    }

    // If AND found nothing, try OR fallback with original terms
    if (allCandidates.length === 0) {
      const originalTerms = normalize(rawQuery).split(/\s+/).filter(t => t.length > 1);
      if (originalTerms.length > 1) {
        const orFilters = originalTerms.map(term => ({
          normalizedName: { $regex: buildPhoneticRegex(term), $options: 'i' }
        }));
        const fallback = await Product.find({ $or: orFilters, ...storeFilter })
          .select('name price supermarket imageUrl category normalizedName')
          .sort({ price: 1 })
          .limit(100)
          .lean();
        for (const c of fallback) {
          if (!seenIds.has(c._id.toString())) {
            seenIds.add(c._id.toString());
            allCandidates.push({ ...c, _terms: originalTerms });
          }
        }
      }
    }

    // Score and rank
    const scored = allCandidates
      .map(p => ({ ...p, _score: scoreMultiWord(p.name, p._terms || [normalize(rawQuery)]) }))
      .filter(p => p._score > 10)
      .sort((a, b) => b._score !== a._score ? b._score - a._score : (a.price || 0) - (b.price || 0));

    // Deduplicate: keep lowest price per (name, supermarket) pair
    const seen = new Map();
    for (const r of scored) {
      const key = `${r.name}__${r.supermarket}`;
      const existing = seen.get(key);
      if (!existing || r.price < existing.price) seen.set(key, r);
    }
    const deduped = Array.from(seen.values()).slice(0, 40);

    res.json(deduped.map(({ _score, _terms, ...p }) => p));
  } catch (error) {
    console.error('Σφάλμα στην Αναζήτηση:', error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή' });
  }
});

// ── GET /api/prices/autocomplete — fast suggestions while typing (alias of /search) ──
// Returns top 8 results for the given query, optimised for speed (no heavy scoring).
router.get('/autocomplete', async (req, res) => {
  try {
    const q = (req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json([]);

    const norm = normalize(q);
    // Try Greek translation first, then raw query
    const searchTerms = [norm];
    const grTrans = EN_TO_GR[q.toLowerCase()];
    if (grTrans) searchTerms.unshift(normalize(grTrans));

    const results = [];
    const seen = new Set();

    for (const term of searchTerms) {
      const docs = await Product.find({
        normalizedName: { $regex: `^${escapeRegex(term)}`, $options: 'i' },
        price: { $gt: 0 },
      })
        .select('name price supermarket imageUrl normalizedName')
        .sort({ price: 1 })
        .limit(20)
        .lean();

      for (const d of docs) {
        const key = d.normalizedName;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(d);
        }
      }
      if (results.length >= 8) break;
    }

    // Fallback: substring match if prefix match too sparse
    if (results.length < 4) {
      const term = searchTerms[searchTerms.length - 1];
      const more = await Product.find({
        normalizedName: { $regex: escapeRegex(term), $options: 'i' },
        price: { $gt: 0 },
      })
        .select('name price supermarket imageUrl normalizedName')
        .sort({ price: 1 })
        .limit(20)
        .lean();

      for (const d of more) {
        if (!seen.has(d.normalizedName)) {
          seen.add(d.normalizedName);
          results.push(d);
        }
      }
    }

    res.set('Cache-Control', 'public, max-age=60');
    res.json(results.slice(0, 8));
  } catch (err) {
    console.error('autocomplete error:', err.message);
    res.status(500).json([]);
  }
});

// ── GET /api/prices/history — price history + cross-store comparison ──────────
// Query: ?name=<normalizedName>&store=<supermarket?>
// Returns a time series (one point/day) plus the current price at each store.
// When the time series is still sparse, it anchors from the product's oldPrice
// so the chart is meaningful from day one and fills in as scrapes accumulate.
router.get('/history', async (req, res) => {
  try {
    const name  = (req.query.name || '').trim().toLowerCase().slice(0, 120);
    const store = req.query.store;
    if (name.length < 2) return res.status(400).json({ message: 'Λείπει το όνομα προϊόντος.' });

    // Current products across stores for this item
    const products = await Product.find({ normalizedName: name })
      .select('name supermarket price oldPrice dateScraped imageUrl')
      .lean();

    if (products.length === 0) {
      return res.json({ name, series: [], byStore: [], current: null, old: null, min: null, max: null, changePct: null, cheapestStore: null });
    }

    // Lowest current price per supermarket
    const byStoreMap = new Map();
    for (const p of products) {
      const e = byStoreMap.get(p.supermarket);
      if (!e || p.price < e.price) byStoreMap.set(p.supermarket, p);
    }
    const byStore = [...byStoreMap.values()]
      .filter(p => p.price > 0)
      .map(p => ({ supermarket: p.supermarket, price: p.price }))
      .sort((a, b) => a.price - b.price);

    // Time series: cheapest price per day (optionally store-scoped)
    const histFilter = { normalizedName: name };
    if (store && store !== 'Όλα') histFilter.supermarket = store;
    const hist = await PriceHistory.find(histFilter).sort({ day: 1 }).lean();

    const byDay = new Map();
    for (const h of hist) {
      const cur = byDay.get(h.day);
      if (cur == null || h.price < cur) byDay.set(h.day, h.price);
    }
    let series = [...byDay.entries()].map(([date, price]) => ({ date, price }));

    const cheapest = byStore[0] || null;
    const withOld  = products.find(p => p.oldPrice && p.oldPrice > 0);
    const today    = new Date().toISOString().slice(0, 10);

    // Anchor sparse series with real previous→current data so it's never empty
    if (series.length < 2 && cheapest) {
      const anchors = [];
      if (withOld) anchors.push({ date: 'πριν', price: Number(withOld.oldPrice) });
      anchors.push({ date: today, price: cheapest.price });
      // Keep any single real point too
      if (series.length === 1 && series[0].date !== today) anchors.unshift(series[0]);
      series = anchors;
    }

    const prices = series.map(s => s.price);
    const min = prices.length ? Math.min(...prices) : null;
    const max = prices.length ? Math.max(...prices) : null;
    const current = cheapest ? cheapest.price : null;
    const old = withOld ? Number(withOld.oldPrice) : null;
    const changePct = (old && current) ? Math.round(((current - old) / old) * 100) : null;

    res.json({
      name,
      series,
      byStore,
      current,
      old,
      min,
      max,
      changePct,
      cheapestStore: cheapest ? cheapest.supermarket : null,
    });
  } catch (err) {
    console.error('history error:', err.message);
    res.status(500).json({ message: 'Σφάλμα ιστορικού τιμών.' });
  }
});

// ── POST /api/prices/substitute — AI smart substitution ──────────────────────
// Body: { productName, currentStore, currentPrice }
// Returns: up to 3 cheaper alternatives from the DB + AI reasoning
router.post('/substitute', async (req, res) => {
  try {
    const { productName, currentStore = '', currentPrice = 0 } = req.body;
    if (!productName) return res.status(400).json({ message: 'Δεν δόθηκε προϊόν.' });

    const norm = productName.toLowerCase().replace(/[αάΑΆ]/g,'α').replace(/[εέΕΈ]/g,'ε')
      .replace(/[ηήΗΉ]/g,'η').replace(/[ιίΙΊϊΐ]/g,'ι').replace(/[οόΟΌ]/g,'ο')
      .replace(/[υύΥΎϋΰ]/g,'υ').replace(/[ωώΩΏ]/g,'ω').trim();

    // Build a query using the first 2 significant words for better matching
    const normWords = norm.split(' ').filter(w => w.length > 2);
    const searchWord = normWords[0] || norm.split(' ')[0];

    // Find similar products across ALL supermarkets
    const candidates = await Product.find({
      normalizedName: { $regex: escapeRegex(searchWord), $options: 'i' },
      price: { $gt: 0 },
    }).sort({ price: 1 }).limit(40).lean();

    // Normalize the current product name for exact-match exclusion
    const normCurrentName = normalize(productName);

    // Filter: different store OR cheaper at same store, and NOT the exact same product
    const alternatives = candidates
      .filter(p => {
        if (p.price <= 0) return false;
        const pNorm = normalize(p.name || '');
        // Exclude exact same product (same name at same store)
        if (pNorm === normCurrentName && p.supermarket.toLowerCase() === currentStore.toLowerCase()) return false;
        // Include if: different store, OR cheaper at same store
        return (
          p.supermarket.toLowerCase() !== currentStore.toLowerCase() ||
          p.price < currentPrice
        );
      })
      // Sort: cheaper first, then by name similarity
      .sort((a, b) => a.price - b.price)
      .slice(0, 6);

    if (alternatives.length === 0) {
      return res.json({ alternatives: [], message: 'Δεν βρέθηκαν εναλλακτικά.' });
    }

    // Ask AI to pick the top 3 and explain
    let aiSuggestions = null;
    try {
      const { callAI } = require('../services/aiService');
      const systemPrompt = `Είσαι ειδικός σε εξοικονόμηση χρημάτων στα σούπερ μάρκετ. Επέλεξε τα 3 καλύτερα εναλλακτικά προϊόντα και εξήγησε σύντομα γιατί. Απάντησε ΜΟΝΟ με JSON.`;
      const userPrompt = `Προϊόν: "${productName}" στο ${currentStore || 'άγνωστο'} για €${currentPrice.toFixed(2)}\n\nΕναλλακτικά:\n${alternatives.map((p,i) => `${i+1}. ${p.name} (${p.supermarket}) €${p.price.toFixed(2)}`).join('\n')}\n\nΕπέλεξε τα 3 καλύτερα και για κάθε ένα δώσε: {"name":"...","supermarket":"...","price":..,"reason":"...σύντομη εξήγηση στα ελληνικά..."}. Επέστρεψε: {"top3":[...]}`;
      aiSuggestions = await callAI(systemPrompt, userPrompt);
    } catch { /* AI optional — fallback to raw results */ }

    res.json({
      alternatives: alternatives.slice(0, 3),
      aiTop3: aiSuggestions?.top3 || null,
    });
  } catch (err) {
    console.error('substitute error:', err.message);
    res.status(500).json({ message: 'Σφάλμα εναλλακτικών.' });
  }
});

// ── GET /api/prices/top-offers — top N sale items for weekly summary ──────────
router.get('/top-offers', async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const store = req.query.store || '';

    const storeFilter = store ? { supermarket: { $regex: escapeRegex(store), $options: 'i' } } : {};

    // ── Strategy 1: genuine oldPrice markdowns ──────────────────────────────
    const matchMarkdowns = {
      price: { $gt: 0 },
      oldPrice: { $gt: 0 },
      $expr: { $gt: ['$oldPrice', '$price'] },
      ...storeFilter,
    };

    // Extend look-back window: use newest product date as anchor, fall back to
    // 30 days so the section always shows something even after a scrape gap.
    const newestWithOld = await Product.findOne({ price: { $gt: 0 }, oldPrice: { $gt: 0 }, ...storeFilter })
      .sort({ dateScraped: -1 }).select('dateScraped').lean();

    if (newestWithOld?.dateScraped) {
      // 7-day window from the most-recent discounted product (was 3, too strict)
      matchMarkdowns.dateScraped = {
        $gte: new Date(newestWithOld.dateScraped.getTime() - 7 * 86400000),
      };
    }

    let offers = await Product.aggregate([
      { $match: matchMarkdowns },
      { $addFields: {
          discount: {
            $round: [{ $multiply: [{ $divide: [{ $subtract: ['$oldPrice', '$price'] }, '$oldPrice'] }, 100] }, 0],
          },
      } },
      { $match: { discount: { $gte: 5, $lte: 70 } } }, // relaxed: 5–70% (was 10–60%)
      { $sort: { discount: -1, dateScraped: -1 } },
      { $group: { _id: '$normalizedName', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { discount: -1, dateScraped: -1 } },
      { $limit: limit },
      { $project: {
          name: 1, price: 1, oldPrice: 1, discount: 1, supermarket: 1,
          imageUrl: 1, pricePerUnit: 1, validityDate: 1, is1plus1: 1, dateScraped: 1,
      } },
    ]);

    // ── Strategy 2: fallback to isOnSale / is1plus1 products when no oldPrice ──
    if (offers.length === 0) {
      const fallbackMatch = {
        price: { $gt: 0 },
        $or: [{ isOnSale: true }, { is1plus1: true }, { discountPercent: { $exists: true, $ne: null } }],
        ...storeFilter,
      };
      const newest2 = await Product.findOne(fallbackMatch).sort({ dateScraped: -1 }).select('dateScraped').lean();
      if (newest2?.dateScraped) {
        fallbackMatch.dateScraped = { $gte: new Date(newest2.dateScraped.getTime() - 14 * 86400000) };
      }

      offers = await Product.find(fallbackMatch)
        .sort({ dateScraped: -1, price: 1 })
        .limit(limit)
        .select('name price oldPrice supermarket imageUrl pricePerUnit discountPercent is1plus1 isOnSale dateScraped')
        .lean()
        .then(docs => docs.map(d => ({
          ...d,
          discount: d.discountPercent ? parseInt(d.discountPercent) :
                    (d.is1plus1 ? 50 :
                    (d.oldPrice > d.price ? Math.round((d.oldPrice - d.price) / d.oldPrice * 100) : 0)),
        })));
    }

    res.set('Cache-Control', 'public, max-age=600');
    res.json(offers);
  } catch (err) {
    console.error('top-offers error:', err.message);
    res.status(500).json({ message: 'Σφάλμα top offers.' });
  }
});

// ── GET /api/prices/scrape-status — last scrape time + product count ──────────
router.get('/scrape-status', async (req, res) => {
  try {
    const total = await Product.countDocuments({ price: { $gt: 0 } });
    const latest = await Product.findOne({ price: { $gt: 0 } }).sort({ dateScraped: -1 }).lean();
    res.json({
      total,
      lastScraped: latest?.dateScraped || null,
      isScraping: false, // frontend can also call /api/status for live status
    });
  } catch {
    res.status(500).json({ message: 'Σφάλμα status.' });
  }
});

// ── POST /api/prices/refresh — trigger on-demand scrape (admin only) ──────────
router.post('/refresh', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.body?.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ message: 'Απαγορεύεται. Απαιτείται CRON_SECRET.' });
  }
  try {
    const { runWebScraper, getScrapingStatus } = require('../services/scraper');
    if (getScrapingStatus()) {
      return res.json({ started: false, message: 'Η ενημέρωση τιμών είναι ήδη σε εξέλιξη.' });
    }
    runWebScraper().catch(err => console.error('[PriceRefresh] Error:', err.message));
    res.json({ started: true, message: 'Ενημέρωση τιμών ξεκίνησε. Θα διαρκέσει λίγα λεπτά.' });
  } catch (err) {
    res.status(500).json({ message: 'Σφάλμα εκκίνησης scraper.' });
  }
});

module.exports = router;