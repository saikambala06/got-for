const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  jobsViewed: { type: Number, default: 0 },
  jobsApplied: { type: Number, default: 0 }
}, { timestamps: true });

statsSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Stats', statsSchema);
