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

    // Saved defaults for the "Quick Download" tailoring flow — remembered
    // per-user so every quick download reuses the same look/settings.
    quickDownloadDefaults: {
      template: { type: String, default: 'Classic' },
      textColor: { type: String, default: '#1a1d29' },
      accentColor: { type: String, default: '#0ea5a4' },
      format: { type: String, enum: ['pdf', 'docx'], default: 'docx' },
      tailoringLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
      noMetrics: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
