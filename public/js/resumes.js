if (!requireAuth()) throw new Error('Not authenticated');

renderSidebar('resumes');
renderTopbar();

let currentResumeId = null;
let resumes = [];

async function loadResumes() {
  try {
    const data = await apiCall('/resumes');
    resumes = data.resumes;
    renderResumeList();
  } catch (err) {
    showToast('Failed to load resumes', 'error');
  }
}

function renderResumeList() {
  const list = document.getElementById('resumeList');
  if (!list) return;
  
  if (resumes.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📄</div>
        <p>No resumes yet. Upload one to get started!</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = resumes.map(r => `
    <div class="resume-item ${r._id === currentResumeId ? 'active' : ''}" onclick="selectResume('${r._id}')">
      <div class="resume-item-info">
        <div class="resume-item-name">${escapeHtml(r.name)}</div>
        <div class="resume-item-date">${formatDate(r.updatedAt)}${r.matchScore ? ' • ' + r.matchScore + '% match' : ''}</div>
      </div>
      ${r.isDefault ? '<span class="resume-item-badge">Default</span>' : ''}
    </div>
  `).join('');
}

async function selectResume(id) {
  currentResumeId = id;
  renderResumeList();
  
  try {
    const data = await apiCall(`/resumes/${id}`);
    renderEditor(data.resume);
  } catch (err) {
    showToast('Failed to load resume', 'error');
  }
}

function renderEditor(resume) {
  const editor = document.getElementById('resumeEditor');
  const title = document.getElementById('editorTitle');
  const actions = document.getElementById('editorActions');
  
  title.textContent = resume.name;
  actions.style.display = 'flex';
  
  const p = resume.parsedData;
  
  editor.innerHTML = `
    <div class="editor-section">
      <h4>Personal Information</h4>
      <div class="form-row">
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="editName" value="${escapeHtml(p.name || '')}">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="editEmail" value="${escapeHtml(p.email || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Phone</label>
          <input type="text" id="editPhone" value="${escapeHtml(p.phone || '')}">
        </div>
        <div class="form-group">
          <label>Location</label>
          <input type="text" id="editLocation" value="${escapeHtml(p.location || '')}">
        </div>
      </div>
    </div>
    
    <div class="editor-section">
      <h4>Summary</h4>
      <textarea id="editSummary" rows="4" placeholder="Write a brief professional summary...">${escapeHtml(p.summary || '')}</textarea>
    </div>
    
    <div class="editor-section">
      <h4>Skills</h4>
      <div class="tags-input" id="skillsContainer">
        ${(p.skills || []).map(s => `<span class="tag">${escapeHtml(s)}<span class="tag-remove" onclick="removeSkill(this, '${escapeHtml(s)}')">×</span></span>`).join('')}
        <input type="text" id="skillInput" placeholder="Add skill and press Enter" onkeydown="handleSkillKeydown(event)">
      </div>
    </div>
    
    <div class="editor-section">
      <h4>Experience</h4>
      <div id="experienceList">
        ${(p.experience || []).map((exp, i) => `
          <div class="experience-item">
            <span>${escapeHtml(exp)}</span>
            <span class="item-remove" onclick="removeExperience(${i})">×</span>
          </div>
        `).join('')}
      </div>
      <input type="text" id="expInput" placeholder="Add experience entry and press Enter" 
        onkeydown="handleExpKeydown(event)" style="margin-top:8px">
    </div>
    
    <div class="editor-section">
      <h4>Education</h4>
      <div id="educationList">
        ${(p.education || []).map((edu, i) => `
          <div class="education-item">
            <span>${escapeHtml(edu)}</span>
            <span class="item-remove" onclick="removeEducation(${i})">×</span>
          </div>
        `).join('')}
      </div>
      <input type="text" id="eduInput" placeholder="Add education entry and press Enter" 
        onkeydown="handleEduKeydown(event)" style="margin-top:8px">
    </div>
    
    ${(p.projects && p.projects.length > 0) ? `
    <div class="editor-section">
      <h4>Projects</h4>
      ${p.projects.map(proj => `<div class="experience-item"><span>${escapeHtml(proj)}</span></div>`).join('')}
    </div>
    ` : ''}
    
    ${(p.certifications && p.certifications.length > 0) ? `
    <div class="editor-section">
      <h4>Certifications</h4>
      ${p.certifications.map(cert => `<div class="experience-item"><span>${escapeHtml(cert)}</span></div>`).join('')}
    </div>
    ` : ''}
  `;
  
  // Store current data for saving
  editor.dataset.resumeId = resume._id;
  window.currentResumeData = p;
}

let currentSkills = [];
let currentExperience = [];
let currentEducation = [];

function refreshCurrentData() {
  currentSkills = [];
  currentExperience = [];
  currentEducation = [];
  
  document.querySelectorAll('#skillsContainer .tag').forEach(t => {
    currentSkills.push(t.textContent.replace('×', '').trim());
  });
  document.querySelectorAll('#experienceList .experience-item span:first-child').forEach(t => {
    currentExperience.push(t.textContent);
  });
  document.querySelectorAll('#educationList .education-item span:first-child').forEach(t => {
    currentEducation.push(t.textContent);
  });
}

function handleSkillKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target;
    const value = input.value.trim();
    if (value) {
      const container = document.getElementById('skillsContainer');
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.innerHTML = `${escapeHtml(value)}<span class="tag-remove" onclick="removeSkill(this, '${escapeHtml(value)}')">×</span>`;
      container.insertBefore(tag, input);
      input.value = '';
    }
  }
}

function removeSkill(el, skill) {
  el.parentElement.remove();
}

function handleExpKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target;
    const value = input.value.trim();
    if (value) {
      const list = document.getElementById('experienceList');
      const item = document.createElement('div');
      item.className = 'experience-item';
      item.innerHTML = `<span>${escapeHtml(value)}</span><span class="item-remove" onclick="this.parentElement.remove()">×</span>`;
      list.appendChild(item);
      input.value = '';
    }
  }
}

function removeExperience(idx) {
  const list = document.getElementById('experienceList');
  list.children[idx].remove();
}

function handleEduKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target;
    const value = input.value.trim();
    if (value) {
      const list = document.getElementById('educationList');
      const item = document.createElement('div');
      item.className = 'education-item';
      item.innerHTML = `<span>${escapeHtml(value)}</span><span class="item-remove" onclick="this.parentElement.remove()">×</span>`;
      list.appendChild(item);
      input.value = '';
    }
  }
}

function removeEducation(idx) {
  const list = document.getElementById('educationList');
  list.children[idx].remove();
}

async function saveResume() {
  if (!currentResumeId) return;
  
  refreshCurrentData();
  
  const parsedData = {
    name: document.getElementById('editName').value,
    email: document.getElementById('editEmail').value,
    phone: document.getElementById('editPhone').value,
    location: document.getElementById('editLocation').value,
    summary: document.getElementById('editSummary').value,
    skills: currentSkills,
    experience: currentExperience,
    education: currentEducation,
    projects: window.currentResumeData?.projects || [],
    certifications: window.currentResumeData?.certifications || []
  };
  
  try {
    await apiCall(`/resumes/${currentResumeId}`, {
      method: 'PUT',
      body: JSON.stringify({ parsedData })
    });
    showToast('Resume saved successfully', 'success');
    loadResumes();
  } catch (err) {
    showToast('Failed to save resume', 'error');
  }
}

async function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    const fileType = file.name.split('.').pop().toLowerCase();
    
    showToast('Parsing resume...', 'info');
    
    try {
      const data = await apiCall('/resumes/upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          fileContent: base64,
          fileType
        })
      });
      
      showToast('Resume parsed successfully!', 'success');
      await loadResumes();
      selectResume(data.resume._id);
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function downloadResume() {
  if (!currentResumeId) return;
  window.open(`/api/resumes/${currentResumeId}/download?token=${getToken()}`, '_blank');
}

// Download with auth
async function downloadResume() {
  if (!currentResumeId) return;
  try {
    const response = await fetch(`/api/resumes/${currentResumeId}/download`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume.html`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Download failed', 'error');
  }
}

async function createNewResume() {
  try {
    const data = await apiCall('/resumes', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Resume', parsedData: {} })
    });
    showToast('New resume created', 'success');
    await loadResumes();
    selectResume(data.resume._id);
  } catch (err) {
    showToast('Failed to create resume', 'error');
  }
}

// ===== TAILOR MODAL =====
function openTailorModal() {
  const select = document.getElementById('tailorResumeSelect');
  select.innerHTML = resumes.map(r => `<option value="${r._id}">${escapeHtml(r.name)}</option>`).join('');
  
  document.getElementById('tailorStep1').classList.remove('hidden');
  document.getElementById('tailorStep2').classList.add('hidden');
  document.getElementById('tailorModal').style.display = 'flex';
}

function closeTailorModal() {
  document.getElementById('tailorModal').style.display = 'none';
  document.getElementById('tailorJobDesc').value = '';
  document.getElementById('tailorJobTitle').value = '';
  document.getElementById('tailorCompany').value = '';
}

async function analyzeTailor() {
  const resumeId = document.getElementById('tailorResumeSelect').value;
  const jobDescription = document.getElementById('tailorJobDesc').value;
  const jobTitle = document.getElementById('tailorJobTitle').value;
  const company = document.getElementById('tailorCompany').value;
  
  if (!resumeId) { showToast('Please select a resume', 'warning'); return; }
  if (jobDescription.length < 20) { showToast('Please provide a more detailed job description', 'warning'); return; }
  
  const btn = document.getElementById('analyzeBtn');
  setButtonLoading(btn, true);
  
  try {
    const result = await apiCall('/resumes/tailor', {
      method: 'POST',
      body: JSON.stringify({ resumeId, jobDescription, jobTitle, company })
    });
    
    renderTailorResults(result);
    document.getElementById('tailorStep1').classList.add('hidden');
    document.getElementById('tailorStep2').classList.remove('hidden');
    setButtonLoading(btn, false);
  } catch (err) {
    showToast(err.message, 'error');
    setButtonLoading(btn, false);
  }
}

function renderTailorResults(result) {
  const container = document.getElementById('tailorResults');
  const scoreClass = result.matchScore >= 70 ? 'good' : result.matchScore >= 40 ? 'medium' : 'low';
  
  container.innerHTML = `
    <div class="match-score-container">
      <div class="match-score-circle ${scoreClass}">${result.matchScore}%</div>
      <div class="match-score-info">
        <h3>Match Score</h3>
        <p>${result.matchingSkills.length} of ${result.jobKeywords.length} keywords matched</p>
      </div>
    </div>
    
    <div class="skills-comparison">
      <div class="skills-col matching">
        <h4>✓ Matching Skills (${result.matchingSkills.length})</h4>
        <div>${result.matchingSkills.map(s => `<span class="skill-tag matching">${escapeHtml(s)}</span>`).join('') || '<p style="font-size:13px;color:var(--text-muted);">No matching skills found</p>'}</div>
      </div>
      <div class="skills-col missing">
        <h4>✕ Missing Skills (${result.missingSkills.length})</h4>
        <div>${result.missingSkills.map(s => `<span class="skill-tag missing">${escapeHtml(s)}</span>`).join('') || '<p style="font-size:13px;color:var(--text-muted);">No missing skills!</p>'}</div>
      </div>
    </div>
    
    <div class="tailor-summary-box">
      <h4>📝 Tailored Summary</h4>
      <p style="font-size:14px;line-height:1.6;">${escapeHtml(result.tailoredSummary)}</p>
    </div>
    
    ${result.suggestions.length > 0 ? `
    <div>
      <h4 style="font-size:14px;font-weight:700;margin-bottom:10px;">💡 Suggestions</h4>
      ${result.suggestions.map(s => `
        <div class="suggestion-item">
          <strong>${escapeHtml(s.title)}</strong>
          ${s.message ? `<p>${escapeHtml(s.message)}</p>` : ''}
          ${s.items ? `<p>${s.items.map(i => escapeHtml(i)).join(', ')}</p>` : ''}
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    <div style="background:var(--bg);padding:16px;border-radius:var(--radius-sm);margin-top:12px;">
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">A tailored resume has been saved as a new version in your resumes list.</p>
      <div style="display:flex;gap:10px;">
        <button class="btn-primary" onclick="closeTailorModal(); loadResumes();">View Resumes</button>
        <button class="btn-secondary" onclick="closeTailorModal()">Close</button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadResumes();