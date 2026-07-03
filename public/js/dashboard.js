if (!requireAuth()) throw new Error('Not authenticated');

renderSidebar('dashboard');
renderTopbar();

let trendsChart = null;
let statusChart = null;

async function loadDashboard() {
  try {
    const data = await apiCall('/dashboard/stats');
    
    // Stats
    document.getElementById('statAllTime').textContent = data.stats.allTime;
    document.getElementById('statMonthly').textContent = data.stats.monthly;
    document.getElementById('statWeekly').textContent = data.stats.weekly;
    
    // Trends chart
    renderTrendsChart(data.trends);
    
    // Status chart
    renderStatusChart(data.statusCounts);
    
    // Recent applications
    renderRecentTable(data.recentApplications);
    
    // Plan usage
    renderPlanUsage(data.plan);
    
    // Portal distribution
    renderPortalDist(data.portalDistribution);
    
  } catch (err) {
    console.error('Dashboard error:', err);
    showToast('Failed to load dashboard data', 'error');
  }
}

function renderTrendsChart(trends) {
  const ctx = document.getElementById('trendsChart');
  if (!ctx) return;
  
  if (trendsChart) trendsChart.destroy();
  
  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.3)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)');
  
  trendsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trends.map(t => t.label),
      datasets: [{
        label: 'Applications',
        data: trends.map(t => t.count),
        borderColor: '#6C5CE7',
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#6C5CE7',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1A1A2E',
          padding: 12,
          borderRadius: 8,
          titleFont: { size: 13, weight: 'bold' },
          bodyFont: { size: 13 }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { font: { size: 12 } }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 12 } }
        }
      }
    }
  });
}

function renderStatusChart(statusCounts) {
  const ctx = document.getElementById('statusChart');
  if (!ctx) return;
  
  if (statusChart) statusChart.destroy();
  
  const labels = Object.keys(statusCounts).filter(k => statusCounts[k] > 0);
  const values = labels.map(k => statusCounts[k]);
  const colors = ['#74B9FF', '#FDCB6E', '#00B894', '#FF7675', '#B2BBC3', '#FD79A8'];
  
  if (labels.length === 0) {
    ctx.parentElement.innerHTML = '<div class="empty-state">No applications yet</div>';
    return;
  }
  
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderWidth: 3,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12 }, padding: 12, usePointStyle: true, pointStyle: 'circle' }
        },
        tooltip: {
          backgroundColor: '#1A1A2E',
          padding: 12,
          borderRadius: 8
        }
      },
      cutout: '65%'
    }
  });
}

function renderRecentTable(applications) {
  const tbody = document.getElementById('recentTableBody');
  if (!tbody) return;
  
  if (!applications || applications.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No applications yet</td></tr>';
    return;
  }
  
  tbody.innerHTML = applications.map(job => `
    <tr>
      <td><strong>${escapeHtml(job.title)}</strong></td>
      <td>${escapeHtml(job.company || '—')}</td>
      <td><span class="job-item-portal">${escapeHtml(job.portal)}</span></td>
      <td><span class="status-badge status-${job.status}">${job.status}</span></td>
      <td>${timeAgo(job.appliedDate)}</td>
    </tr>
  `).join('');
}

function renderPlanUsage(plan) {
  const jobExtPercent = Math.min((plan.jobExtractions.used / plan.jobExtractions.limit) * 100, 100);
  const tailoredPercent = Math.min((plan.tailoredResumes.used / plan.tailoredResumes.limit) * 100, 100);
  
  document.getElementById('planName').textContent = `${plan.name} Plan`;
  document.getElementById('jobExtCount').textContent = `${plan.jobExtractions.used} / ${plan.jobExtractions.limit}`;
  document.getElementById('jobExtBar').style.width = `${jobExtPercent}%`;
  document.getElementById('tailoredCount').textContent = `${plan.tailoredResumes.used} / ${plan.tailoredResumes.limit}`;
  document.getElementById('tailoredBar').style.width = `${tailoredPercent}%`;
}

function renderPortalDist(portals) {
  const container = document.getElementById('portalDist');
  if (!container) return;
  
  if (!portals || portals.length === 0) {
    container.innerHTML = '<div style="padding:12px 0;font-size:13px;color:var(--text-muted);">No portal data</div>';
    return;
  }
  
  const maxCount = Math.max(...portals.map(p => p.count));
  
  container.innerHTML = portals.map(p => `
    <div class="portal-dist-item">
      <span>${escapeHtml(p._id)}</span>
      <div class="portal-dist-bar">
        <div class="portal-dist-fill" style="width:${(p.count / maxCount) * 100}%"></div>
      </div>
      <strong>${p.count}</strong>
    </div>
  `).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

loadDashboard();