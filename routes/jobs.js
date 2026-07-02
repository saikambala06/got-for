const express = require('express');
const auth = require('../middleware/auth');
const Job = require('../models/Job');
const Application = require('../models/Application');

const router = express.Router();

// Get all jobs
router.get('/', auth, async (req, res) => {
  try {
    const { status, search, source } = req.query;
    const query = { userId: req.userId };

    if (status) query.status = status;
    if (source) query.source = source;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    const jobs = await Job.find(query).sort({ appliedDate: -1 }).populate('resumeUsed', 'name');
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single job
router.get('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, userId: req.userId }).populate('resumeUsed', 'name parsedData');
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create job application
router.post('/', auth, async (req, res) => {
  try {
    const jobData = { ...req.body, userId: req.userId };
    const job = new Job(jobData);
    await job.save();

    // Log application
    const application = new Application({
      userId: req.userId,
      jobId: job._id,
      action: 'applied',
      newStatus: job.status
    });
    await application.save();

    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update job
router.put('/:id', auth, async (req, res) => {
  try {
    const oldJob = await Job.findOne({ _id: req.params.id, userId: req.userId });
    if (!oldJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const previousStatus = oldJob.status;
    const job = await Job.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );

    // Log status change
    if (previousStatus !== req.body.status) {
      const application = new Application({
        userId: req.userId,
        jobId: job._id,
        action: 'status_change',
        previousStatus,
        newStatus: req.body.status
      });
      await application.save();
    }

    res.json(job);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete job
router.delete('/:id', auth, async (req, res) => {
  try {
    const job = await Job.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    await Application.deleteMany({ jobId: req.params.id });
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get job statistics
router.get('/stats/counts', auth, async (req, res) => {
  try {
    const statuses = ['Applied', 'Interviewing', 'Offers', 'Rejected', 'Archived', 'Favorites'];
    const counts = {};

    for (const status of statuses) {
      counts[status] = await Job.countDocuments({ userId: req.userId, status });
    }

    res.json(counts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export jobs
router.get('/export/csv', auth, async (req, res) => {
  try {
    const jobs = await Job.find({ userId: req.userId }).sort({ appliedDate: -1 });
    
    let csv = 'Title,Company,Location,Status,Source,Job Type,Applied Date,Salary,Notes\n';
    jobs.forEach(job => {
      csv += `"${job.title}","${job.company}","${job.location}","${job.status}","${job.source}","${job.jobType}","${job.appliedDate}","${job.salary}","${job.notes}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=job_applications.csv');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
