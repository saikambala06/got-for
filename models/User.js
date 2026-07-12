const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    location: { type: String, default: '' },
    phone: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    portfolio: { type: String, default: '' },
    avatarColor: { type: String, default: '#ff8a3d' },
    // Saved defaults for the "Quick Download" flow (template, colors, tailoring
    // level, no-metrics toggle) so the customization panel remembers a user's
    // last choices instead of resetting every time. Shape is intentionally
    // loose (Mixed) since it mirrors whatever the frontend `settings` object
    // looks like — see public/quick-download.html.
    quickDownloadDefaults: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
