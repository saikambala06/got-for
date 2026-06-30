const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// Cached MongoDB Connection Configuration
let cachedMongoose = null;
async function connectDatabase() {
  if (cachedMongoose && mongoose.connection.readyState === 1) {
    return cachedMongoose;
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI environment variable inside configuration settings.");
  }
  mongoose.set('strictQuery', true);
  cachedMongoose = await mongoose.connect(process.env.MONGODB_URI, {
    bufferCommands: false,
  });
  return cachedMongoose;
}

// Mongoose Data Schemas
const JobSchema = new mongoose.Schema({
  company: { type: String, required: true },
  role: { type: String, required: true },
  location: { type: String, default: "Remote" },
  status: { type: String, enum: ['Applied', 'Interviewing', 'Offers', 'Rejected', 'Archived', 'Favorites'], default: 'Applied' },
  dateApplied: { type: Date, default: Date.now },
  notes: { type: String, default: "" }
}, { timestamps: true });

const ResumeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['Upload', 'Scratch'], default: 'Upload' },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const ProfileSchema = new mongoose.Schema({
  name: { type: String, default: "Sai Kambala" },
  email: { type: String, default: "saikambala111@gmail.com" },
  provider: { type: String, default: "Google" }
}, { timestamps: true });

const Job = mongoose.models.Job || mongoose.model('Job', JobSchema);
const Resume = mongoose.models.Resume || mongoose.model('Resume', ResumeSchema);
const Profile = mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);

// --- API ENDPOINTS ---

// Jobs CRUD
app.get('/api/jobs', async (req, res) => {
  try { await connectDatabase(); const data = await Job.find().sort({ dateApplied: -1 }); res.status(200).json({ success: true, data }); } 
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/jobs', async (req, res) => {
  try { await connectDatabase(); const data = await Job.create(req.body); res.status(201).json({ success: true, data }); } 
  catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try { await connectDatabase(); await Job.findByIdAndDelete(req.params.id); res.status(200).json({ success: true }); } 
  catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// Resumes CRUD
app.get('/api/resumes', async (req, res) => {
  try { await connectDatabase(); const data = await Resume.find().sort({ createdAt: -1 }); res.status(200).json({ success: true, data }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/resumes', async (req, res) => {
  try { await connectDatabase(); const data = await Resume.create(req.body); res.status(201).json({ success: true, data }); }
  catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// Profile Management
app.get('/api/profile', async (req, res) => {
  try { 
    await connectDatabase(); 
    let data = await Profile.findOne();
    if (!data) data = await Profile.create({}); 
    res.status(200).json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/profile', async (req, res) => {
  try { await connectDatabase(); const data = await Profile.findOneAndUpdate({}, req.body, { new: true, upsert: true }); res.status(200).json({ success: true, data }); }
  catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

module.exports = app;
