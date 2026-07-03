const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String },
  avatar: { type: String, default: '' },
  plan: { type: String, enum: ['free', 'pro'], default: 'free' },
  jobExtractions: { type: Number, default: 0 },
  jobExtractionsLimit: { type: Number, default: 6 },
  tailoredResumes: { type: Number, default: 0 },
  tailoredResumesLimit: { type: Number, default: 2 },
  connectedAccounts: [{
    provider: String,
    email: String
  }]
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
