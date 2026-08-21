let currentCSV = "";
let currentFilename = "";
let currentHeaders = [];

// Loader
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
  }, 800);
});

// Drag & Drop
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
    alert('Please upload a CSV file'); return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    currentCSV = e.target.result;
    currentFilename = file.name;
    document.getElementById('fileInfo').textContent = `✓ ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    loadData(currentCSV);
    document.getElementById('upload').style.display = 'none';
    document.getElementById('analysis').style.display = 'block';
    document.getElementById('analysis').scrollIntoView({ behavior: 'smooth' });
  };
  reader.readAsText(file);
}

function loadData(csv) {
  const lines = csv.trim().split('\n');
  currentHeaders = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1, 11); // Show first 10

  document.getElementById('activeFile').textContent = currentFilename;
  document.getElementById('fileMeta').textContent = `${lines.length - 1} rows · ${currentHeaders.length} cols`;

  const thead = document.querySelector('#dataTable thead');
  const tbody = document.querySelector('#dataTable tbody');
  thead.innerHTML = '<tr>' + currentHeaders.map(h => `<th>${h}</th>`).join('') + '</tr>';
  tbody.innerHTML = rows.map(r => {
    const cells = r.split(',');
    return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
  }).join('');
}

function loadSample(type) {
  let csv = "";
  if (type === 'sales') {
    csv = `Month,Revenue,Orders,Region
Jan,45000,320,North
Feb,52000,380,North
Mar,48000,350,South
Apr,61000,420,East
May,58000,400,West
Jun,72000,510,North
Jul,69000,490,South
Aug,75000,530,East`;
  } else if (type === 'users') {
    csv = `UserID,Age,Country,Signups,Plan
U001,28,USA,2024-01,Pro
U002,34,UK,2024-02,Basic
U003,22,Canada,2024-01,Pro
U004,45,Germany,2024-03,Enterprise
U005,31,USA,2024-02,Basic
U006,27,France,2024-03,Pro`;
  } else {
    csv = `Date,Category,Amount,Type
2024-01-05,Software,1200.50,Expense
2024-01-12,Services,3400.00,Revenue
2024-02-01,Hardware,5600.75,Expense
2024-02-15,Consulting,8900.00,Revenue
2024-03-03,Marketing,2100.00,Expense
2024-03-20,Sales,12500.00,Revenue`;
  }
  currentCSV = csv;
  currentFilename = type + '_sample.csv';
  document.getElementById('fileInfo').textContent = `✓ Loaded ${type} sample dataset`;
  loadData(csv);
  document.getElementById('upload').style.display = 'none';
  document.getElementById('analysis').style.display = 'block';
  document.getElementById('analysis').scrollIntoView({ behavior: 'smooth' });
}

function clearData() {
  currentCSV = "";
  currentFilename = "";
  currentHeaders = [];
  document.getElementById('upload').style.display = 'block';
  document.getElementById('analysis').style.display = 'none';
  document.getElementById('resultPanel').style.display = 'none';
  document.getElementById('fileInfo').textContent = '';
  document.getElementById('chatMessages').innerHTML = `
    <div class="msg ai">
      <div class="msg-avatar">◈</div>
      <div class="msg-bubble">
        <p>Hi! I'm your AI Data Analyst. Upload a dataset and ask me anything about it.</p>
      </div>
    </div>`;
}

function ask(text) {
  document.getElementById('questionInput').value = text;
  sendQuestion();
}

async function sendQuestion() {
  const input = document.getElementById('questionInput');
  const btn = document.getElementById('sendBtn');
  const question = input.value.trim();
  if (!question) return;

  if (!currentCSV) {
    alert('Please upload a CSV file first'); return;
  }

  // Add user message
  addMessage(question, 'user');
  input.value = '';
  btn.disabled = true;

  // Show typing
  const typingId = 'typing-' + Date.now();
  document.getElementById('chatMessages').insertAdjacentHTML('beforeend', `
    <div class="msg ai" id="${typingId}">
      <div class="msg-avatar">◈</div>
      <div class="msg-bubble">
        <div class="typing"><span></span><span></span><span></span></div>
      </div>
    </div>
  `);
  scrollChat();

  try {
    const model = document.getElementById('modelSelect').value;
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, csvData: currentCSV, filename: currentFilename, model })
    });
    const data = await res.json();

    document.getElementById(typingId).remove();

    if (data.success) {
      addMessage(data.analysis, 'ai', true);
      showResult(data.analysis, model);
      drawChart(data.columns);
    } else {
      addMessage('Error: ' + data.error, 'ai');
    }
  } catch (err) {
    document.getElementById(typingId).remove();
    addMessage('Network error. Please try again.', 'ai');
  }

  btn.disabled = false;
  scrollChat();
}

function addMessage(text, sender, isMarkdown = false) {
  const div = document.createElement('div');
  div.className = 'msg ' + sender;
  const content = isMarkdown ? renderMarkdown(text) : `<p>${escapeHtml(text)}</p>`;
  div.innerHTML = `
    <div class="msg-avatar">${sender === 'ai' ? '◈' : 'You'}</div>
    <div class="msg-bubble">${content}</div>
  `;
  document.getElementById('chatMessages').appendChild(div);
  scrollChat();
}

function scrollChat() {
  const el = document.getElementById('chatMessages');
  el.scrollTop = el.scrollHeight;
}

function showResult(analysis, model) {
  document.getElementById('resultPanel').style.display = 'block';
  document.getElementById('resultContent').innerHTML = renderMarkdown(analysis);
  document.getElementById('resultModel').textContent = model === 'gemini' ? 'Gemini 1.5 Flash' : 'Demo Mode';
  document.getElementById('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function drawChart(columns) {
  const canvas = document.getElementById('analysisChart');
  const ctx = canvas.getContext('2d');
  canvas.width = 600; canvas.height = 300;

  // Simple bar chart demo
  const bars = columns.slice(0, 5);
  const values = bars.map(() => Math.floor(Math.random() * 80) + 20);
  const max = Math.max(...values);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = 80;
  const gap = 30;
  const startX = (canvas.width - (bars.length * (barWidth + gap) - gap)) / 2;

  bars.forEach((label, i) => {
    const h = (values[i] / max) * 200;
    const x = startX + i * (barWidth + gap);
    const y = canvas.height - h - 40;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#6366f1');
    grad.addColorStop(1, '#a855f7');

    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barWidth, h);

    ctx.fillStyle = '#8888a0';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + barWidth/2, canvas.height - 15);

    ctx.fillStyle = '#e2e2e8';
    ctx.fillText(values[i], x + barWidth/2, y - 8);
  });
}

function renderMarkdown(text) {
  return text
    .replace(/## (.*)/g, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/```([\w]*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/• (.*)/g, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function exportAnalysis() {
  const content = document.getElementById('resultContent').innerText;
  if (!content) { alert('No analysis to export yet'); return; }
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'analysis_report.txt'; a.click();
}
