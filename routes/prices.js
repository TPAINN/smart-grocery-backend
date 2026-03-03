// routes/prices.js
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');

// GET / — Όλα τα προϊόντα με pagination
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

// GET /search — Έξυπνη αναζήτηση
router.get('/search', async (req, res) => {
  try {
    const query = req.query.q;
    const store = req.query.store;

    if (!query || query.trim() === '') return res.json([]);

    const normalizedQuery = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    const searchTerms = normalizedQuery.split(/\s+/);

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const regexQueries = searchTerms.map(term => ({
      normalizedName: { $regex: escapeRegex(term), $options: 'i' }
    }));

    const dbQuery = { $and: regexQueries };
    if (store && store !== 'Όλα') dbQuery.supermarket = store;

    const products = await Product.find(dbQuery)
      .sort({ price: 1 })
      .limit(15)
      .lean();

    res.json(products);
  } catch (error) {
    console.error('Σφάλμα στην Αναζήτηση:', error);
    res.status(500).json({ message: 'Σφάλμα διακομιστή' });
  }
});

module.exports = router;