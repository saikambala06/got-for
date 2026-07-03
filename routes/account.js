const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.put('/profile', async (req, res) => {
  try {
    const { name, location, phone, linkedin, portfolio } = req.body;
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: { name, location, phone, linkedin, portfolio } },
      { new: true, runValidators: true }
    ).select('-password');
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update profile' });
  }
});

router.put('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.userId);
    const match = await bcrypt.compare(currentPassword || '', user.password);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update password' });
  }
});

module.exports = router;
