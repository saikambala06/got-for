const express = require('express');
const cors = require('cors');
require('dotenv').config();

const resumeRoutes = require('./routes/resumes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes Setup
app.use('/api/resumes', resumeRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: "Server running", provider: "xAI Grok Engine active" });
});

app.listen(PORT, () => {
  console.log(`JobTrail backend initializing...`);
  console.log(`Server actively running on port ${PORT}`);
});
