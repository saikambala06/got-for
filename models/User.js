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
    avatarColor: { type: String, default: '#6557f5' },
    quickDownload: {
      resumeId: { type: String, default: '' },
      templateName: { type: String, default: 'classic' },
      accentColor: { type: String, default: '#6557f5' },
      autoTailor: { type: Boolean, default: true }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
