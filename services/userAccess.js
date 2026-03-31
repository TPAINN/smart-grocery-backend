const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;

function buildAccessState(user) {
  const now = new Date();
  const trialActive = Boolean(user?.trialEndsAt && new Date(user.trialEndsAt) > now);

  return {
    isPremium: Boolean(user?.isPremium || trialActive),
    isRealPremium: Boolean(user?.isPremium),
    isOnTrial: Boolean(trialActive && !user?.isPremium),
    trialEndsAt: user?.trialEndsAt || null,
    trialDaysLeft: trialActive && !user?.isPremium
      ? Math.ceil((new Date(user.trialEndsAt) - now) / DAY_MS)
      : 0,
  };
}

function getAllowedShareKeys(user) {
  const ownKey = String(user?.shareKey || '').trim().toUpperCase();
  const friendKeys = Array.isArray(user?.friends)
    ? user.friends
        .map((friend) => String(friend?.shareKey || '').trim().toUpperCase())
        .filter(Boolean)
    : [];

  return [...new Set([ownKey, ...friendKeys].filter(Boolean))];
}

async function loadUserAccess(userId, projection = 'shareKey friends isPremium trialEndsAt name') {
  const user = await User.findById(userId).select(projection);
  if (!user) return null;

  return {
    user,
    ...buildAccessState(user),
    allowedShareKeys: getAllowedShareKeys(user),
  };
}

module.exports = {
  buildAccessState,
  getAllowedShareKeys,
  loadUserAccess,
};
