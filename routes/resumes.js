const express = require('express');
const Resume = require('../models/Resume');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const resumes = await Resume.find({ user: req.userId }).sort({ updatedAt: -1 });
    res.json({ resumes });
  } catch (err) {
    res.status(500).json({ error: 'Could not load resumes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const resume = await Resume.findOne({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    res.status(400).json({ error: 'Invalid resume id' });
  }
});

// Create a new resume. Used both by "Build from Scratch" (pre-fills personal
// info from the account profile) and any future "Upload Resume" flow.
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Resume name is required' });

    const count = await Resume.countDocuments({ user: req.userId });

    let personal = { name: '', email: '', phone: '', location: '', linkedin: '', portfolio: '' };
    if (req.body.prefillFromProfile) {
      const user = await User.findById(req.userId);
      if (user) {
        personal = {
          name: user.name || '',
          email: user.email || '',
          phone: user.phone || '',
          location: user.location || '',
          linkedin: user.linkedin || '',
          portfolio: user.portfolio || ''
        };
      }
    }

    const resume = await Resume.create({
      user: req.userId,
      title,
      isDefault: count === 0,
      personal
    });
    res.status(201).json({ resume });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create resume' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.body.isDefault === true) {
      await Resume.updateMany({ user: req.userId }, { $set: { isDefault: false } });
    }

    // Whitelist updatable fields so arbitrary keys can't be injected
    const allowed = [
      'title', 'isDefault', 'personal', 'summary', 'experience', 'education',
      'skills', 'projects', 'certifications', 'achievements', 'languages', 'publications'
    ];
    const update = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    });

    const resume = await Resume.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ resume });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update resume' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const resume = await Resume.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete resume' });
  }
});

module.exports = router;
