/**
 * Frontend State Management for the Tailoring Lifecycle
 */
let currentDiffData = null;
let activeResumePayload = {};

/**
 * Step 1: Initialize processing pipeline from selection settings
 * Matches layout structure seen in IMG20260708235454.jpg
 */
async function triggerTailoringPipeline(resumeId, jobId) {
  const intensityElement = document.querySelector('input[name="tailorLevel"]:checked');
  const level = intensityElement ? intensityElement.value : 'Medium';

  // Toggle loading splash interface shown in IMG20260708235510.jpg
  showLoadingScreen(true);

  try {
    const response = await fetch('/api/resumes/tailor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ resumeId, jobId, tailoringLevel: level })
    });

    const data = await response.json();
    showLoadingScreen(false);

    if (data.success) {
      currentDiffData = data.diff;
      initializeFinalizedPayload(data.diff);
      renderInteractiveDiffWorkspace(data.diff);
    } else {
      alert(`Error initializing matching calculations: ${data.error}`);
    }
  } catch (error) {
    showLoadingScreen(false);
    console.error("API link pipeline degradation:", error);
  }
}

/**
 * Seed initial state assuming clean baselines prior to confirmation
 */
function initializeFinalizedPayload(diff) {
  activeResumePayload = {
    summary: diff.summary ? diff.summary.suggested : '',
    skills: [...(diff.skills?.added || [])],
    experience: []
  };

  diff.experience.forEach(exp => {
    const freshExp = {
      company: exp.company,
      role: exp.role,
      bullets: exp.bullets.map(b => b.suggested || b.original)
    };
    activeResumePayload.experience.push(freshExp);
  });
}

/**
 * Step 2: Build Interactive Diff Workspace
 * Matches layout variations seen in IMG20260708235546.jpg & IMG20260708235552.jpg
 */
function renderInteractiveDiffWorkspace(diff) {
  const workspace = document.getElementById('tailor-workspace-root');
  updateMatchScoreDisplay(diff.estimatedMatchScore || 70);

  let htmlMarkup = `
    <!-- Summary Optimization Panel -->
    <div class="card shadow mb-4 p-4 border-left-primary">
      <h4 class="font-weight-bold text-gray-800">Summary Optimization</h4>
      <div class="p-3 bg-light rounded position-relative">
        <p class="text-danger strike-through mb-1">${diff.summary?.original || ''}</p>
        <p class="text-success font-weight-bold mb-0">${diff.summary?.suggested || ''}</p>
        <div class="mt-2 d-flex gap-2">
          <button class="btn btn-sm btn-success px-3" onclick="resolveSummary(true, '${diff.summary?.suggested}')">Accept Correction</button>
          <button class="btn btn-sm btn-outline-danger px-3" onclick="resolveSummary(false, '${diff.summary?.original}')">Revert</button>
        </div>
      </div>
    </div>

    <!-- Experience Alignment Panels -->
    <h4 class="font-weight-bold text-gray-800 mb-3">Work History Tailoring adjustments</h4>
  `;

  diff.experience.forEach((exp, expIdx) => {
    htmlMarkup += `
      <div class="card shadow mb-3 p-3">
        <h5 class="text-primary font-weight-bold">${exp.role} <span class="text-muted">at ${exp.company}</span></h5>
        <ul class="list-group list-group-flush mt-2">
    `;

    exp.bullets.forEach((bullet, bulletIdx) => {
      if (bullet.suggested && bullet.suggested !== bullet.original) {
        htmlMarkup += `
          <li class="list-group-item bg-light-warning my-1 p-3 border rounded bullet-diff-node" data-exp="${expIdx}" data-bullet="${bulletIdx}">
            <div class="text-muted text-decoration-line-through text-xs mb-1">Original: ${bullet.original}</div>
            <div class="text-dark font-weight-medium mb-2">Suggested: <mark class="bg-warning-light">${bullet.suggested}</mark></div>
            <div class="action-row d-flex gap-2">
              <button class="btn btn-xs btn-success py-1 px-2 text-xs" onclick="resolveBullet(this, ${expIdx}, ${bulletIdx}, '${bullet.suggested}')">✓ Accept Change</button>
              <button class="btn btn-xs btn-outline-secondary py-1 px-2 text-xs" onclick="resolveBullet(this, ${expIdx}, ${bulletIdx}, '${bullet.original}')">✕ Keep Original</button>
            </div>
          </li>
        `;
      } else {
        htmlMarkup += `<li class="list-group-item text-gray-700 text-sm">${bullet.original}</li>`;
      }
    });

    htmlMarkup += `</ul></div>`;
  });

  workspace.innerHTML = htmlMarkup;
}

function resolveSummary(accept, value) {
  activeResumePayload.summary = value;
}

function resolveBullet(buttonElement, expIdx, bulletIdx, value) {
  activeResumePayload.experience[expIdx].bullets[bulletIdx] = value;
  
  // Clean up visual node representation once handled
  const targetNode = buttonElement.closest('.bullet-diff-node');
  targetNode.className = "list-group-item text-success bg-white transition-fade p-2 text-sm";
  targetNode.innerHTML = `✓ Adjusted: ${value}`;
  
  // Incrementally optimize contextual quality score matching tracking visuals
  bumpMatchScore();
}

function updateMatchScoreDisplay(score) {
  const badge = document.getElementById('match-score-radial');
  if (badge) badge.innerText = `${score}%`;
}

function bumpMatchScore() {
  const badge = document.getElementById('match-score-radial');
  if (badge) {
    let currentScore = parseInt(badge.innerText) || 75;
    if (currentScore < 98) {
      badge.innerText = `${currentScore + 1}%`;
    }
  }
}

function showLoadingScreen(visible) {
  const loader = document.getElementById('processing-overlay-container');
  if (loader) loader.style.display = visible ? 'flex' : 'none';
}

/**
 * Step 3: Trigger PDF download mapping
 * Matches layout criteria configured inside IMG20260708235622.jpg & IMG20260708235630.jpg
 */
async function processDocumentDownload() {
  const selectedTemplate = document.querySelector('.template-card.active')?.dataset.template || 'classic';
  const selectedColor = document.querySelector('.color-dot.active')?.dataset.color || '#0056b3';

  try {
    const response = await fetch('/api/resumes/download-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        resumeData: activeResumePayload,
        customOptions: {
          templateName: selectedTemplate,
          accentColor: selectedColor,
          fontName: 'Helvetica'
        }
      })
    });

    if (!response.ok) throw new Error("Could not construct target package downstream.");

    const fileBlob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(fileBlob);
    const hiddenAnchor = document.createElement('a');
    
    hiddenAnchor.href = downloadUrl;
    hiddenAnchor.download = `Tailored_Execution_Sheet_${Date.now()}.pdf`;
    document.body.appendChild(hiddenAnchor);
    hiddenAnchor.click();
    
    window.URL.revokeObjectURL(downloadUrl);
    hiddenAnchor.remove();
  } catch (error) {
    console.error("PDF download stream crash:", error);
    alert("An error occurred while compiling your dynamic resume layout.");
  }
}
