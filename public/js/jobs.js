if (!requireAuth()) throw new Error('Not authenticated');

renderSidebar('job-tracker');
renderTopbar();

let currentStatus = 'All';
let currentJobId = null;
let allJobs = [];
let searchQuery = '';

async function loadJobs() {
  try {
    const data = await apiCall(`/jobs${currentStatus !== 'All' ? `?status=${currentStatus}` : ''}`);
    allJobs = data.jobs;
    renderJobList();
    await loadStatusCounts();
  } catch (err) {
    showToast('Failed to load jobs', 'error');
  }
}

async function loadStatusCounts() {
  try {
    const data = await apiCall('/jobs');
    const counts = { All: 0, Applied: 0, Interviewing: 0, Offers: 0, Rejected: 0, Archived: 0, Favorites: 0 };
    data.jobs.forEach(j => {
      counts.All++;
      counts[j.status] = (counts[j.status] || 0) + 1;
    });
    Object.keys(counts).forEach(key => {
      const el = document.getElementById(`count${key}`);
      if (el) el.textContent = counts[key];
    });
  } catch (err) {}
}

function renderJobList() {
  const list = document.getElementById('jobList');
  if (!list) return;
  
  let filtered = allJobs;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = allJobs.filter(j => 
      j.title.toLowerCase().includes(q) || 
      (j.company || '').toLowerCase().includes(q) ||
      (j.location || '').toLowerCase().includes(q)
    );
  }
  
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>No applications found</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = filtered.map(job => `
    <div class="job-item ${job._id === currentJobId ? 'active' : ''}" onclick="selectJob('${job._id}')">
      <div class="job-item-header">
        <div class="job-item-title">${escapeHtml(job.title)}</div>
        <span class="status-badge status-${job.status}">${job.status}</span>
      </div>
      <div class="job-item-company">${escapeHtml(job.company || 'Company not specified')}</div>
      <div class="job-item-meta">
        <span>📍 ${escapeHtml(job.location || 'Remote')}</span>
        <span class="job-item-portal">${escapeHtml(job.portal)}</span>
        <span>${timeAgo(job.appliedDate)}</span>
      </div>
    </div>
  `).join('');
}

async function selectJob(id) {
  currentJobId = id;
  renderJobList();
  
  try {
    const data = await apiCall(`/jobs/${id}`);
    renderJobDetail(data.job);
  } catch (err) {
    showToast('Failed to load job details', 'error');
  }
}

function renderJobDetail(job) {
  const detail = document.getElementById('jobDetail');
  
  detail.innerHTML = `
    <div class="job-detail-title">${escapeHtml(job.title)}</div>
    <div class="job-detail-company">${escapeHtml(job.company || 'Company not specified')}</div>
    <div class="job-detail-meta">
      <div class="job-detail-meta-item">📍 ${escapeHtml(job.location || 'Not specified')}</div>
      <div class="job-detail-meta-item">🔗 ${escapeHtml(job.portal)}</div>
      <div class="job-detail-meta-item">📅 ${formatDate(job.appliedDate)}</div>
      ${job.salary ? `<div class="job-detail-meta-item">💰 ${escapeHtml(job.salary)}</div>` : ''}
    </div>
    
    <div style="margin-bottom:16px;">
      <span class="status-badge status-${job.status}" style="font-size:14px;padding:6px 16px;">${job.status}</span>
    </div>
    
    ${job.skills && job.skills.length > 0 ? `
    <div class="job-detail-section">
      <h4>Skills</h4>
      <div class="job-detail-skills">
        ${job.skills.map(s => `<span class="skill-badge">${escapeHtml(s)}</span>`).join('')}
      </div>
    </div>
    ` : ''}
    
    ${job.softSkills && job.softSkills.length > 0 ? `
    <div class="job-detail-section">
      <h4>Soft Skills</h4>
      <div class="job-detail-skills">
        ${job.softSkills.map(s => `<span class="skill-badge soft">${escapeHtml(s)}</span>`).join('')}
      </div>
    </div>
    ` : ''}
    
    ${job.jobDescription ? `
    <div class="job-detail-section">
      <h4>Job Description</h4>
      <div class="job-detail-description">${escapeHtml(job.jobDescription)}</div>
    </div>
    ` : ''}
    
    ${job.notes ? `
    <div class="job-detail-section">
      <h4>Notes</h4>
      <div class="job-detail-description">${escapeHtml(job.notes)}</div>
    </div>
    ` : ''}
    
    ${job.jobUrl ? `
    <div class="job-detail-section">
      <a href="${escapeHtml(job.jobUrl)}" target="_blank" class="btn-secondary">🔗 View Original Posting</a>
    </div>
    ` : ''}
    
    <div class="job-detail-actions">
      <select id="statusQuickChange" onchange="quickStatusChange('${job._id}', this.value)" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:13px;">
        <option value="">Change Status...</option>
        <option value="Applied">Applied</option>
        <option value="Interviewing">Interviewing</option>
        <option value="Offers">Offers</option>
        <option value="Rejected">Rejected</option>
        <option value="Archived">Archived</option>
        <option value="Favorites">Favorites</option>
      </select>
      <button class="btn-secondary btn-sm" onclick="editJob('${job._id}')">Edit</button>
      <button class="btn-sm" style="background:var(--danger);color:white;padding:7px 14px;border-radius:var(--radius-sm);font-weight:600;font-size:13px;" onclick="deleteJob('${job._id}')">Delete</button>
    </div>
  `;
}

async function quickStatusChange(jobId, newStatus) {
  if (!newStatus) return;
  try {
    await apiCall(`/jobs/${jobId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    showToast(`Status changed to ${newStatus}`, 'success');
    await loadJobs();
    selectJob(jobId);
  } catch (err) {
    showToast('Failed to update status', 'error');
  }
}

function openJobModal(jobId) {
  document.getElementById('jobModal').style.display = 'flex';
  document.getElementById('jobModalTitle').textContent = jobId ? 'Edit Application' : 'Add Job Application';
  
  if (jobId) {
    const job = allJobs.find(j => j._id === jobId);
    if (job) {
      document.getElementById('jobTitle').value = job.title;
      document.getElementById('jobCompany').value = job.company || '';
      document.getElementById('jobLocation').value = job.location || '';
      document.getElementById('jobPortal').value = job.portal;
      document.getElementById('jobStatus').value = job.status;
      document.getElementById('jobSalary').value = job.salary || '';
      document.getElementById('jobUrl').value = job.jobUrl || '';
      document.getElementById('jobDescription').value = job.jobDescription || '';
      document.getElementById('jobNotes').value = job.notes || '';
      document.getElementById('jobForm').dataset.jobId = jobId;
    }
  } else {
    document.getElementById('jobForm').reset();
    delete document.getElementById('jobForm').dataset.jobId;
  }
}

function closeJobModal() {
  document.getElementById('jobModal').style.display = 'none';
}

function editJob(jobId) {
  openJobModal(jobId);
}

async function saveJob(event) {
  event.preventDefault();
  const btn = document.getElementById('saveJobBtn');
  setButtonLoading(btn, true);
  
  const formData = {
    title: document.getElementById('jobTitle').value,
    company: document.getElementById('jobCompany').value,
    location: document.getElementById('jobLocation').value,
    portal: document.getElementById('jobPortal').value,
    status: document.getElementById('jobStatus').value,
    salary: document.getElementById('jobSalary').value,
    jobUrl: document.getElementById('jobUrl').value,
    jobDescription: document.getElementById('jobDescription').value,
    notes: document.getElementById('jobNotes').value
  };
  
  const form = document.getElementById('jobForm');
  const jobId = form.dataset.jobId;
  
  try {
    if (jobId) {
      await apiCall(`/jobs/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify(formData)
      });
      showToast('Job updated successfully', 'success');
    } else {
      await apiCall('/jobs', {
        method: 'POST',
        body: JSON.stringify(formData)
      });
      showToast('Job added successfully', 'success');
    }
    closeJobModal();
    await loadJobs();
    setButtonLoading(btn, false);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
}

async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to delete this application?')) return;
  
  try {
    await apiCall(`/jobs/${jobId}`, { method: 'DELETE' });
    showToast('Job deleted', 'success');
    currentJobId = null;
    document.getElementById('jobDetail').innerHTML = `
      <div class="empty-state-full">
        <div class="empty-icon">📋</div>
        <p>Select a job to view details</p>
      </div>
    `;
    await loadJobs();
  } catch (err) {
    showToast('Failed to delete job', 'error');
  }
}

// Status tab clicks
document.querySelectorAll('.status-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentStatus = tab.dataset.status;
    loadJobs();
  });
});

// Search
document.getElementById('jobSearch').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderJobList();
});

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadJobs();