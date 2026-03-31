const { loadUserAccess } = require('../services/userAccess');

async function requirePremiumAccess(req, res, next) {
  try {
    const access = await loadUserAccess(req.userId);
    if (!access) {
      return res.status(404).json({ message: 'Χρήστης δεν βρέθηκε.' });
    }

    req.access = access;

    if (!access.isPremium) {
      return res.status(403).json({
        message: 'Το AI Meal Plan είναι διαθέσιμο μόνο για Premium ή ενεργό trial.',
      });
    }

    next();
  } catch (err) {
    console.error('Premium access check failed:', err.message);
    res.status(500).json({ message: 'Αποτυχία ελέγχου πρόσβασης.' });
  }
}

module.exports = requirePremiumAccess;
