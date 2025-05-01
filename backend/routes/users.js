// routes/users.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Get current user's profile
router.get('/current', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ email: req.userEmail });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json(user);
  } catch (err) {
    console.error('Error fetching current user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update current user's profile
router.put('/current', authMiddleware, async (req, res) => {
  try {
    const { displayName, preferences } = req.body;
    
    const user = await User.findOne({ email: req.userEmail });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (displayName) user.displayName = displayName;
    if (preferences) user.preferences = preferences;
    
    await user.save();
    res.json(user);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;