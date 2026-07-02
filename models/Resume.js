const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  originalFileName: {
    type: String,
    default: ''
  },
  fileType: {
    type: String,
    enum: ['pdf', 'docx', 'manual'],
    default: 'manual'
  },
  fileData: {
    type: String,
    default: ''
  },
  parsedData: {
    fullName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    summary: { type: String, default: '' },
    skills: [{ type: String }],
    experience: [{
      title: String,
      company: String,
      location: String,
      startDate: String,
      endDate: String,
      description: String,
      current: Boolean
    }],
    education: [{
      degree: String,
      institution: String,
      location: String,
      startDate: String,
      endDate: String,
      gpa: String
    }],
    certifications: [{ type: String }],
    languages: [{ type: String }],
    links: [{
      label: String,
      url: String
    }]
  },
  tailoredVersions: [{
    jobTitle: String,
    jobDescription: String,
    tailoredContent: Object,
    createdAt: { type: Date, default: Date.now }
  }],
  isTailored: {
    type: Boolean,
    default: false
  },
  parentResumeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resume',
    default: null
  },
  status: {
    type: String,
    enum: ['draft', 'complete', 'tailored'],
    default: 'draft'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Resume', resumeSchema);
