// routes/lists.js
const express = require('express');
const router = express.Router();
const SavedList = require('../models/SavedList');
const auth = require('../middleware/authMiddleware');
const { loadUserAccess } = require('../services/userAccess');

// 1. ΛΗΨΗ ΟΛΩΝ ΤΩΝ ΛΙΣΤΩΝ ΤΟΥ ΧΡΗΣΤΗ
router.get('/', auth, async (req, res) => {
    try {
        const lists = await SavedList.find({ userId: req.userId }).sort({ createdAt: -1 }); // Οι πιο πρόσφατες πρώτα
        res.json(lists);
    } catch (err) {
        res.status(500).json({ message: 'Σφάλμα κατά την ανάκτηση των λιστών.' });
    }
});

// 2. ΑΠΟΘΗΚΕΥΣΗ ΝΕΑΣ ΛΙΣΤΑΣ (Με έλεγχο Free/Premium)
router.post('/', auth, async (req, res) => {
    try {
        const { title, items } = req.body;
        const access = await loadUserAccess(req.userId);

        if (!access) {
            return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
        }
        
        // Έλεγχος ορίων!
        const userListsCount = await SavedList.countDocuments({ userId: req.userId });
        const limit = access.isPremium ? 10 : 2; // 10 για Premium/trial, 2 για Free
        
        if (userListsCount >= limit) {
            return res.status(403).json({ 
                message: `Έχεις φτάσει το όριο των ${limit} λιστών. Αναβάθμισε σε Premium για περισσότερες!` 
            });
        }

        const newList = new SavedList({ userId: req.userId, title, items });
        await newList.save();
        res.status(201).json(newList);
    } catch (err) {
        res.status(500).json({ message: 'Σφάλμα κατά την αποθήκευση της λίστας.' });
    }
});

// 3. ΕΝΗΜΕΡΩΣΗ ΛΙΣΤΑΣ (Όταν ο χρήστης "τικάρει" προϊόντα στο σουπερμάρκετ)
router.put('/:id', auth, async (req, res) => {
    try {
        const updatedList = await SavedList.findOneAndUpdate(
            { _id: req.params.id, userId: req.userId },
            { items: req.body.items, title: req.body.title },
            { new: true } // Επιστρέφει την ανανεωμένη λίστα
        );
        res.json(updatedList);
    } catch (err) {
        res.status(500).json({ message: 'Σφάλμα κατά την ενημέρωση.' });
    }
});

// 4. ΔΙΑΓΡΑΦΗ ΛΙΣΤΑΣ
router.delete('/:id', auth, async (req, res) => {
    try {
        await SavedList.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        res.json({ message: 'Η λίστα διαγράφηκε.' });
    } catch (err) {
        res.status(500).json({ message: 'Σφάλμα κατά τη διαγραφή.' });
    }
});

module.exports = router;
