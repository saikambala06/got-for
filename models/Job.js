const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    company: { type: String, required: true, trim: true },
    location: { type: String, default: '' },
    salary: { type: String, default: '' },
    status: {
      type: String,
      enum: ['Applied', 'Interviewing', 'Offer', 'Rejected', 'Archived'],
      default: 'Applied'
    },
    favorite: { type: Boolean, default: false },
    source: { type: String, default: '' },
    jobUrl: { type: String, default: '' },
    notes: { type: String, default: '' },
    skills: [{ type: String }],
    appliedOn: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Job || mongoose.model('Job', JobSchema);
