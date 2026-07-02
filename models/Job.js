const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  location: {
    type: String,
    default: ''
  },
  jobUrl: {
    type: String,
    default: ''
  },
  source: {
    type: String,
    enum: ['LinkedIn', 'Indeed', 'Glassdoor', 'Naukri', 'Monster', 'Manual', 'Other'],
    default: 'Manual'
  },
  salary: {
    type: String,
    default: ''
  },
  jobType: {
    type: String,
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote', 'Hybrid', 'Other'],
    default: 'Full-time'
  },
  description: {
    type: String,
    default: ''
  },
  requirements: [{ type: String }],
  status: {
    type: String,
    enum: ['Applied', 'Interviewing', 'Offers', 'Rejected', 'Archived', 'Favorites'],
    default: 'Applied'
  },
  appliedDate: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String,
    default: ''
  },
  resumeUsed: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resume',
    default: null
  },
  interviewDates: [{
    date: Date,
    type: String,
    notes: String
  }],
  contactPerson: {
    name: String,
    email: String,
    phone: String,
    role: String
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

module.exports = mongoose.model('Job', jobSchema);
