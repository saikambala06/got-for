const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: String, required: true },
  title: { type: String, required: true },
  location: { type: String, default: '' },
  status: {
    type: String,
    enum: ['Applied', 'Interviewing', 'Offers', 'Rejected', 'Archived', 'Favorites'],
    default: 'Applied'
  },
  source: { type: String, default: '' },
  appliedOn: { type: Date, default: Date.now },
  skills: [{ type: String }],
  softSkills: [{ type: String }],
  resumeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Resume', default: null },
  notes: { type: String, default: '' },
  isFavorite: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
