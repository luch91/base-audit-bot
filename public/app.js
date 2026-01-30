let currentPage = 1;
const LIMIT = 20;
const REFRESH_INTERVAL = 15000;

// Fetch and update stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();

    document.getElementById('totalContracts').textContent = stats.totalContracts;
    document.getElementById('totalAudited').textContent = stats.totalAudited;
    document.getElementById('totalSkipped').textContent = stats.totalSkipped;
    document.getElementById('lastBlock').textContent = stats.monitorState.lastProcessedBlock;

    document.getElementById('criticalCount').textContent = stats.criticalFindings;
    document.getElementById('highCount').textContent = stats.highFindings;
    document.getElementById('mediumCount').textContent = stats.mediumFindings;
    document.getElementById('lowCount').textContent = stats.lowFindings;

    // Update status indicator
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (stats.monitorState.isRunning) {
      dot.className = 'dot running';
      text.textContent = 'Monitor Running — Block ' + stats.monitorState.lastProcessedBlock;
    } else {
      dot.className = 'dot stopped';
      text.textContent = 'Monitor Stopped';
    }
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

// Fetch and render audit table
async function fetchAudits(page) {
  currentPage = page || 1;
  try {
    const res = await fetch(`/api/audits?page=${currentPage}&limit=${LIMIT}&order=desc`);
    const data = await res.json();

    const tbody = document.getElementById('auditTableBody');

    if (data.audits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No audits yet. Waiting for contract deployments...</td></tr>';
      return;
    }

    tbody.innerHTML = data.audits.map(function(audit) {
      const shortAddr = audit.contractAddress.slice(0, 6) + '...' + audit.contractAddress.slice(-4);
      const time = new Date(audit.auditedAt).toLocaleString();
      const riskClass = 'risk-' + audit.overallRisk;

      return '<tr onclick="showAudit(\'' + audit.id + '\')">' +
        '<td>' + escapeHtml(audit.contractName) + '</td>' +
        '<td class="address-cell">' + shortAddr + '</td>' +
        '<td><span class="risk-badge ' + riskClass + '">' + audit.overallRisk.toUpperCase() + '</span></td>' +
        '<td>' + audit.findings.length + '</td>' +
        '<td>' + (audit.sourceAvailable ? 'Verified' : 'No') + '</td>' +
        '<td>' + time + '</td>' +
        '</tr>';
    }).join('');

    // Pagination
    renderPagination(data.total, data.page, data.totalPages);
  } catch (err) {
    console.error('Failed to fetch audits:', err);
  }
}

function renderPagination(total, page, totalPages) {
  const container = document.getElementById('pagination');
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  var html = '';
  for (var i = 1; i <= Math.min(totalPages, 10); i++) {
    var cls = i === page ? ' active' : '';
    html += '<button class="' + cls + '" onclick="fetchAudits(' + i + ')">' + i + '</button>';
  }
  container.innerHTML = html;
}

// Show audit detail modal
async function showAudit(id) {
  try {
    const res = await fetch('/api/audits/' + id);
    const audit = await res.json();

    const detail = document.getElementById('auditDetail');
    const riskClass = 'risk-' + audit.overallRisk;

    var findingsHtml = '';
    if (audit.findings.length > 0) {
      findingsHtml = audit.findings.map(function(f) {
        var sevClass = 'severity-badge ' + f.severity;
        return '<div class="finding-card">' +
          '<div class="finding-card-header">' +
          '<span class="finding-type">' + escapeHtml(f.type) + '</span>' +
          '<span class="' + sevClass + '">' + f.severity.toUpperCase() + '</span>' +
          '</div>' +
          '<div class="finding-description">' + escapeHtml(f.description) + '</div>' +
          '<div class="finding-suggestion">Fix: ' + escapeHtml(f.suggestion) + '</div>' +
          '<div class="finding-meta">' +
          'Line ' + f.line +
          (f.cweId ? ' | ' + f.cweId : '') +
          (f.category ? ' | ' + f.category : '') +
          ' | Confidence: ' + (f.confidence * 100).toFixed(0) + '%' +
          '</div>' +
          '</div>';
      }).join('');
    } else {
      findingsHtml = '<p style="color: #8b949e;">No vulnerabilities detected.</p>';
    }

    detail.innerHTML =
      '<div class="detail-header">' +
      '<h2>' + escapeHtml(audit.contractName) + '</h2>' +
      '<span class="risk-badge ' + riskClass + '" style="margin-top:8px;display:inline-block;">' + audit.overallRisk.toUpperCase() + '</span>' +
      '</div>' +
      '<div class="detail-meta">' +
      '<div><strong>Address:</strong> ' + audit.contractAddress + '</div>' +
      '<div><strong>Deployer:</strong> ' + audit.deployer + '</div>' +
      '<div><strong>TX:</strong> ' + audit.deploymentTxHash + '</div>' +
      '<div><strong>Block:</strong> ' + audit.blockNumber + '</div>' +
      '<div><strong>Deployed:</strong> ' + new Date(audit.deployedAt * 1000).toLocaleString() + '</div>' +
      '<div><strong>Audited:</strong> ' + new Date(audit.auditedAt).toLocaleString() + '</div>' +
      (audit.compilerVersion ? '<div><strong>Compiler:</strong> ' + escapeHtml(audit.compilerVersion) + '</div>' : '') +
      (audit.analysisTimeMs ? '<div><strong>Analysis Time:</strong> ' + (audit.analysisTimeMs / 1000).toFixed(1) + 's</div>' : '') +
      '</div>' +
      '<div class="detail-findings">' +
      '<h3>Findings (' + audit.findings.length + ')</h3>' +
      findingsHtml +
      '</div>' +
      '<p style="margin-top:16px;font-size:13px;color:#8b949e;">' + escapeHtml(audit.summary) + '</p>';

    document.getElementById('auditModal').classList.add('active');
  } catch (err) {
    console.error('Failed to fetch audit detail:', err);
  }
}

function closeModal() {
  document.getElementById('auditModal').classList.remove('active');
}

// Close modal on outside click
document.getElementById('auditModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// On-demand audit
async function auditContract() {
  const input = document.getElementById('contractAddress');
  const btn = document.getElementById('auditBtn');
  const status = document.getElementById('auditFormStatus');
  const address = input.value.trim();

  // Validate
  if (!address) {
    status.className = 'form-status error';
    status.textContent = 'Please enter a contract address';
    return;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    status.className = 'form-status error';
    status.textContent = 'Invalid address format. Must be 0x followed by 40 hex characters.';
    return;
  }

  // Disable button, show loading
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  status.className = 'form-status loading';
  status.textContent = 'Fetching source code and analyzing with AI... This may take up to 2 minutes.';

  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });

    const data = await res.json();

    if (!res.ok) {
      status.className = 'form-status error';
      status.textContent = data.error || 'Audit failed';
      if (data.suggestion) {
        status.textContent += ' — ' + data.suggestion;
      }
      return;
    }

    // Success
    status.className = 'form-status success';
    if (data.status === 'cached') {
      status.textContent = 'Contract was previously audited. Showing cached results.';
    } else {
      status.textContent = 'Audit complete! Found ' + data.audit.findings.length + ' issue(s).';
    }

    // Refresh the audit list and show the result
    await fetchAudits(1);
    showAudit(data.audit.id);

    // Clear input
    input.value = '';

  } catch (err) {
    status.className = 'form-status error';
    status.textContent = 'Request failed: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Contract';
  }
}

// Allow Enter key to submit
document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('contractAddress');
  if (input) {
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        auditContract();
      }
    });
  }
});

// Monitor control
async function controlMonitor(action) {
  try {
    await fetch('/api/monitor/' + action, { method: 'POST' });
    setTimeout(fetchStats, 1000);
  } catch (err) {
    console.error('Failed to ' + action + ' monitor:', err);
  }
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initial load
fetchStats();
fetchAudits(1);

// Auto-refresh
setInterval(function() {
  fetchStats();
  fetchAudits(currentPage);
}, REFRESH_INTERVAL);
