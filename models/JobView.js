const mongoose = require('mongoose');

// A JobView is logged once per job posting the browser extension successfully
// parses while the user is logged in — this is the real "jobs viewed" event
// that powers the dashboard's Jobs Viewed line (as opposed to Jobs Applied,
// which comes from the Job collection's appliedOn field).
const JobViewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: '' },
    company: { type: String, default: '' },
    jobUrl: { type: String, default: '', index: true },
    viewedOn: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.JobView || mongoose.model('JobView', JobViewSchema);
