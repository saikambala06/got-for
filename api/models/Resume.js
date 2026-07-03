const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'My Resume' },
  isDefault: { type: Boolean, default: false },
  personalInfo: {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    portfolio: { type: String, default: '' }
  },
  summary: { type: String, default: '' },
  skills: [{ type: String }],
  experience: [{
    company: String,
    title: String,
    startDate: String,
    endDate: String,
    description: String
  }],
  education: [{
    institution: String,
    degree: String,
    startDate: String,
    endDate: String
  }],
  fileUrl: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Resume', resumeSchema);
