// grocery-backend/routes/prices.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// 1. Επιστρέφει ΟΛΑ τα προϊόντα (Χρειάζεται για το Tab Προσφορών στο Frontend)
router.get('/', async (req, res) => {
    try { 
        res.json(await Product.find({})); 
    } catch (error) { 
        res.status(500).json({ message: 'Σφάλμα ανάκτησης προϊόντων' }); 
    }
});

// 2. Έξυπνη Αναζήτηση Προϊόντων (Real-time Smart Search)
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        const store = req.query.store; // ΝΕΟ: Παίρνουμε το Supermarket από το URL!
        
        if (!query || query.trim() === '') return res.json([]);

        const normalizedQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const searchTerms = normalizedQuery.split(/\s+/);
        const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexQueries = searchTerms.map(term => ({
            normalizedName: { $regex: escapeRegex(term), $options: 'i' }
        }));

        // ΝΕΟ: Χτίζουμε το Query. Αν επέλεξε συγκεκριμένο μαγαζί, το προσθέτουμε!
        const dbQuery = { $and: regexQueries };
        if (store && store !== 'Όλα') {
            dbQuery.supermarket = store; 
        }

        // Βρίσκει τα προϊόντα, ταξινομεί από το φθηνότερο στο ακριβότερο και κρατάει 15!
        const products = await Product.find(dbQuery)
            .sort({ price: 1 }) 
            .limit(15)
            .lean();

        res.json(products);
    } catch (error) {
        console.error("Σφάλμα στην Αναζήτηση:", error);
        res.status(500).json({ message: "Σφάλμα διακομιστή" });
    }
});

module.exports = router;