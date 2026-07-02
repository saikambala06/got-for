// ===== Resumes Page JavaScript =====

let selectedFile = null;
let buildSkills = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (!checkAuth()) return;

  showLoading();
  
  try {
    await loadUserData();
    await loadResumes();
    setupUpload();
    setupBuildForm();
    setupTailorForm();
  } catch (error) {
    console.error('Resumes error:', error);
  }

  hideLoading();
});

async function loadResumes() {
  try {
    const resumes = await apiCall('/resumes');
    const listSection = document.getElementById('resumeListSection');
    const createSection = document.getElementById('createResumeSection');

    if (resumes && resumes.length > 0) {
      listSection.style.display = 'block';
      createSection.style.display = 'none';
      renderResumeList(resumes);
    } else {
      listSection.style.display = 'none';
      createSection.style.display = 'block';
    }

    // Create new button
    document.getElementById('createNewBtn')?.addEventListener('click', () => {
      listSection.style.display = 'none';
      createSection.style.display = 'block';
    });
  } catch (error) {
    console.error('Load resumes error:', error);
  }
}

function renderResumeList(resumes) {
  const list = document.getElementById('resumeList');
  list.innerHTML = '';

  resumes.forEach(resume => {
    const skills = resume.parsedData?.skills?.slice(0, 5) || [];
    const statusClass = resume.status === 'complete' ? 'status-complete' : 
                        resume.status === 'tailored' ? 'status-tailored' : 'status-draft';

    const card = document.createElement('div');
    card.className = 'resume-card';
    card.innerHTML = `
      <div class="resume-card-header">
        <div>
          <div class="resume-card-title">${resume.name}</div>
          <div class="resume-card-date">${formatDate(resume.createdAt)}</div>
        </div>
        <span class="resume-card-status ${statusClass}">${resume.status}</span>
      </div>
      ${resume.parsedData?.fullName ? `<p style="font-size:13px;color:var(--gray-600);">👤 ${resume.parsedData.fullName}</p>` : ''}
      ${skills.length > 0 ? `
        <div class="resume-card-skills">
          ${skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
          ${resume.parsedData.skills.length > 5 ? `<span class="skill-tag">+${resume.parsedData.skills.length - 5}</span>` : ''}
        </div>
      ` : ''}
      <div class="resume-card-actions">
        <button class="btn btn-sm btn-outline" onclick="viewResume('${resume._id}')">👁️ View</button>
        <button class="btn btn-sm btn-primary" onclick="openTailorModal('${resume._id}')">✨ Tailor</button>
        <button class="btn btn-sm btn-danger" onclick="deleteResume('${resume._id}')">🗑️</button>
      </div>
    `;
    list.appendChild(card);
  });
}

function setupUpload() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadResumeBtn');
  const fileInfo = document.getElementById('fileUploadedInfo');
  const fileName = document.getElementById('uploadedFileName');
  const removeFileBtn = document.getElementById('removeFile');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', () => {
    selectedFile = null;
    fileInfo.style.display = 'none';
    uploadBtn.disabled = true;
    fileInput.value = '';
  });

  uploadBtn.addEventListener('click', uploadResume);
}

function handleFile(file) {
  const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!validTypes.includes(file.type)) {
    showToast('Please upload a PDF or DOCX file', 'error');
    return;
  }

  selectedFile = file;
  document.getElementById('uploadedFileName').textContent = file.name;
  document.getElementById('fileUploadedInfo').style.display = 'flex';
  document.getElementById('uploadResumeBtn').disabled = false;
}

async function uploadResume() {
  if (!selectedFile) return;

  const resumeName = document.getElementById('resumeNameInput').value;
  if (!resumeName.trim()) {
    showToast('Please enter a resume name', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('resume', selectedFile);
  formData.append('resumeName', resumeName);

  showLoading('Parsing resume...');

  try {
    const token = getToken();
    const response = await fetch(`${API_BASE}/resumes/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    hideLoading();
    showToast('Resume parsed successfully!');
    showParsedResume(data);
    await loadResumes();
    await loadUserData(); // Refresh plan usage
  } catch (error) {
    hideLoading();
    showToast(error.message, 'error');
  }
}

function showParsedResume(resume) {
  const section = document.getElementById('parsedResumeSection');
  const createSection = document.getElementById('createResumeSection');
  const listSection = document.getElementById('resumeListSection');

  createSection.style.display = 'none';
  listSection.style.display = 'none';
  section.style.display = 'block';

  const pd = resume.parsedData;
  
  let html = `
    <div class="page-header">
      <h1 class="page-title">${resume.name}</h1>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" onclick="backToList()">← Back</button>
        <button class="btn btn-primary" onclick="openTailorModal('${resume._id}')">✨ Tailor Resume</button>
      </div>
    </div>
    <div class="parsed-resume-view">
  `;

  if (pd.fullName || pd.email || pd.phone) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Contact Information</h3>
      ${pd.fullName ? `<p><strong>${pd.fullName}</strong></p>` : ''}
      ${pd.email ? `<p>📧 ${pd.email}</p>` : ''}
      ${pd.phone ? `<p>📱 ${pd.phone}</p>` : ''}
      ${pd.location ? `<p>📍 ${pd.location}</p>` : ''}
    </div>`;
  }

  if (pd.summary) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Professional Summary</h3>
      <p>${pd.summary}</p>
    </div>`;
  }

  if (pd.skills && pd.skills.length > 0) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Skills</h3>
      <div class="resume-card-skills">
        ${pd.skills.map(s => `<span class="skill-tag">${s}</span>`).join('')}
      </div>
    </div>`;
  }

  if (pd.experience && pd.experience.length > 0) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Experience</h3>
      ${pd.experience.map(exp => `
        <div class="parsed-item">
          <div class="parsed-item-title">${exp.title || ''}</div>
          <div class="parsed-item-subtitle">${exp.company || ''} ${exp.location ? '• ' + exp.location : ''}</div>
          <div class="parsed-item-date">${exp.startDate || ''} ${exp.endDate ? '- ' + exp.endDate : ''}</div>
          ${exp.description ? `<div class="parsed-item-description">${exp.description}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  if (pd.education && pd.education.length > 0) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Education</h3>
      ${pd.education.map(edu => `
        <div class="parsed-item">
          <div class="parsed-item-title">${edu.degree || ''}</div>
          <div class="parsed-item-subtitle">${edu.institution || ''}</div>
          ${edu.gpa ? `<div class="parsed-item-date">GPA: ${edu.gpa}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  if (pd.certifications && pd.certifications.length > 0) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Certifications</h3>
      <ul>${pd.certifications.map(c => `<li>${c}</li>`).join('')}</ul>
    </div>`;
  }

  if (pd.links && pd.links.length > 0) {
    html += `<div class="parsed-section">
      <h3 class="parsed-section-title">Links</h3>
      ${pd.links.map(l => `<p><a href="${l.url}" target="_blank" style="color:var(--primary)">${l.label}: ${l.url}</a></p>`).join('')}
    </div>`;
  }

  html += '</div>';
  section.innerHTML = html;
}

function backToList() {
  document.getElementById('parsedResumeSection').style.display = 'none';
  document.getElementById('resumeListSection').style.display = 'block';
  loadResumes();
}

async function viewResume(id) {
  showLoading();
  try {
    const resume = await apiCall(`/resumes/${id}`);
    hideLoading();
    showParsedResume(resume);
  } catch (error) {
    hideLoading();
    showToast('Failed to load resume', 'error');
  }
}

function openTailorModal(resumeId) {
  document.getElementById('tailorResumeId').value = resumeId;
  document.getElementById('tailorJobTitle').value = '';
  document.getElementById('tailorJobDescription').value = '';
  openModal('tailorModal');
}

function setupTailorForm() {
  document.getElementById('tailorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const resumeId = document.getElementById('tailorResumeId').value;
    const jobTitle = document.getElementById('tailorJobTitle').value;
    const jobDescription = document.getElementById('tailorJobDescription').value;

    showLoading('Tailoring resume...');
    closeModal('tailorModal');

    try {
      const tailored = await apiCall(`/resumes/${resumeId}/tailor`, {
        method: 'POST',
        body: JSON.stringify({ jobTitle, jobDescription })
      });

      hideLoading();
      showToast('Resume tailored successfully!');
      showParsedResume(tailored);
      await loadUserData();
    } catch (error) {
      hideLoading();
      showToast(error.message, 'error');
    }
  });
}

async function deleteResume(id) {
  if (!confirm('Are you sure you want to delete this resume?')) return;

  try {
    await apiCall(`/resumes/${id}`, { method: 'DELETE' });
    showToast('Resume deleted');
    await loadResumes();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Build from scratch
function setupBuildForm() {
  document.getElementById('buildFromScratch').addEventListener('click', () => {
    const resumeName = document.getElementById('resumeNameInput').value;
    if (!resumeName.trim()) {
      showToast('Please enter a resume name first', 'error');
      return;
    }
    openModal('buildResumeModal');
  });

  // Skills input
  const skillsInput = document.getElementById('skillsInput');
  const skillsContainer = document.getElementById('skillsContainer');
  
  skillsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const skill = skillsInput.value.trim();
      if (skill && !buildSkills.includes(skill)) {
        buildSkills.push(skill);
        renderSkillBadges();
      }
      skillsInput.value = '';
    }
  });

  skillsContainer.addEventListener('click', () => skillsInput.focus());

  // Form submit
  document.getElementById('buildResumeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const resumeName = document.getElementById('resumeNameInput').value;
    
    // Parse experience
    const expText = document.getElementById('buildExperience').value;
    const experience = expText.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        title: parts[0] || '',
        company: parts[1] || '',
        startDate: parts[2] || '',
        endDate: '',
        description: '',
        current: false
      };
    });

    // Parse education
    const eduText = document.getElementById('buildEducation').value;
    const education = eduText.split('\n').filter(l => l.trim()).map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        degree: parts[0] || '',
        institution: parts[1] || '',
        endDate: parts[2] || '',
        gpa: ''
      };
    });

    // Parse certifications
    const certText = document.getElementById('buildCertifications').value;
    const certifications = certText.split('\n').filter(l => l.trim());

    const parsedData = {
      fullName: document.getElementById('buildFullName').value,
      email: document.getElementById('buildEmail').value,
      phone: document.getElementById('buildPhone').value,
      location: document.getElementById('buildLocation').value,
      summary: document.getElementById('buildSummary').value,
      skills: buildSkills,
      experience,
      education,
      certifications,
      languages: [],
      links: []
    };

    showLoading('Saving resume...');
    closeModal('buildResumeModal');

    try {
      const resume = await apiCall('/resumes/manual', {
        method: 'POST',
        body: JSON.stringify({ name: resumeName, parsedData })
      });

      hideLoading();
      showToast('Resume created successfully!');
      showParsedResume(resume);
      await loadResumes();
    } catch (error) {
      hideLoading();
      showToast(error.message, 'error');
    }
  });
}

function renderSkillBadges() {
  const container = document.getElementById('skillsContainer');
  const input = document.getElementById('skillsInput');
  
  // Remove existing badges
  container.querySelectorAll('.skill-badge').forEach(el => el.remove());
  
  // Add badges before input
  buildSkills.forEach((skill, idx) => {
    const badge = document.createElement('span');
    badge.className = 'skill-badge';
    badge.innerHTML = `${skill} <span class="remove-skill" data-idx="${idx}">✕</span>`;
    container.insertBefore(badge, input);
  });

  // Remove skill click handlers
  container.querySelectorAll('.remove-skill').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx);
      buildSkills.splice(idx, 1);
      renderSkillBadges();
    });
  });
}
