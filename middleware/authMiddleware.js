// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');

function auth(req, res, next) {
  const token = req.header('Authorization');
  if (!token) {
    return res.status(401).json({ message: 'Δεν υπάρχει πρόσβαση. Παρακαλώ συνδεθείτε.' });
  }

  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    // 🔴 FIX: 401 παντού (όχι 400)
    // Διαφορετικό μήνυμα για expired token vs invalid token
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Το session έληξε. Παρακαλώ συνδεθείτε ξανά.' });
    }
    return res.status(401).json({ message: 'Μη έγκυρο token. Παρακαλώ συνδεθείτε ξανά.' });
  }
}

module.exports = auth;