const mongoose = require('mongoose');

const ExperienceSchema = new mongoose.Schema({
  role: { type: String, default: '' },
  company: { type: String, default: '' },
  location: { type: String, default: '' },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  current: { type: Boolean, default: false },
  description: { type: String, default: '' }
}, { _id: false });

const EducationSchema = new mongoose.Schema({
  school: { type: String, default: '' },
  degree: { type: String, default: '' },
  field: { type: String, default: '' },
  location: { type: String, default: '' },
  startDate: { type: String, default: '' },
  endDate: { type: String, default: '' },
  current: { type: Boolean, default: false },
  description: { type: String, default: '' }
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  link: { type: String, default: '' },
  description: { type: String, default: '' }
}, { _id: false });

const CertificationSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  issuer: { type: String, default: '' },
  date: { type: String, default: '' }
}, { _id: false });

const PublicationSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  link: { type: String, default: '' },
  date: { type: String, default: '' }
}, { _id: false });

const ResumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    isDefault: { type: Boolean, default: false },

    personal: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      location: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      portfolio: { type: String, default: '' }
    },

    summary: { type: String, default: '' },
    experience: { type: [ExperienceSchema], default: [] },
    education: { type: [EducationSchema], default: [] },
    skills: { type: [String], default: [] },
    projects: { type: [ProjectSchema], default: [] },
    certifications: { type: [CertificationSchema], default: [] },
    achievements: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    publications: { type: [PublicationSchema], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Resume || mongoose.model('Resume', ResumeSchema);
