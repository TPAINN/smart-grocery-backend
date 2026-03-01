// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_smart_grocery';

function auth(req, res, next) {
    // Ψάχνουμε το Token στον header της αίτησης
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ message: 'Δεν υπάρχει πρόσβαση. Παρακαλώ συνδεθείτε.' });

    try {
        // Αποκρυπτογράφηση του Token (το "Bearer " το αφαιρούμε)
        const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        req.user = decoded; // Προσθέτουμε τα στοιχεία του χρήστη (id, isPremium) στο request
        next(); // Περνάμε στο επόμενο βήμα!
    } catch (e) {
        res.status(400).json({ message: 'Το session έληξε. Παρακαλώ συνδεθείτε ξανά.' });
    }
}

module.exports = auth;