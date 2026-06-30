const mongoose = require('mongoose');

const ResumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },
    summary: { type: String, default: '' },
    skills: { type: String, default: '' },
    experience: { type: String, default: '' },
    education: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Resume || mongoose.model('Resume', ResumeSchema);
