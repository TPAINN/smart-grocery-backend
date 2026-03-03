// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_smart_grocery';

// 1. ΕΓΓΡΑΦΗ (SIGN UP)
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'Το email χρησιμοποιείται ήδη.' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();

        const token = jwt.sign({ id: newUser._id, isPremium: newUser.isPremium }, JWT_SECRET, { expiresIn: '7d' });

        // 🟢 FIX: Επιστρέφουμε ΚΑΙ το shareKey τώρα!
        res.status(201).json({ token, user: { id: newUser._id, name, email, isPremium: newUser.isPremium, shareKey: newUser.shareKey } });
    } catch (error) {
        res.status(500).json({ message: 'Σφάλμα διακομιστή κατά την εγγραφή.' });
    }
});

// 2. ΣΥΝΔΕΣΗ (LOGIN)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Λάθος email ή κωδικός.' });

        const token = jwt.sign({ id: user._id, isPremium: user.isPremium }, JWT_SECRET, { expiresIn: '7d' });

        // 🟢 FIX: Επιστρέφουμε ΚΑΙ το shareKey τώρα!
        res.json({ token, user: { id: user._id, name: user.name, email, isPremium: user.isPremium, shareKey: user.shareKey } });
    } catch (error) {
        res.status(500).json({ message: 'Σφάλμα διακομιστή κατά τη σύνδεση.' });
    }
});

module.exports = router;