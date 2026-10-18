let currentCSV = "";
let currentFilename = "";
let currentHeaders = [];
let chatHistory = [];
let analysisChartInstance = null;
const sessionAnalyses = [];

// Loader
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
  }, 800);
  initTheme();
});

// ---------- Theme toggle (dark/light) ----------
function initTheme() {
  const saved = localStorage.getItem('nexus-theme') || 'dark';
  applyTheme(saved);
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('nexus-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '🌙' : '☀️';
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- Drag & Drop / file loading ----------
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
  if (!/\.(csv|txt)$/i.test(file.name)) {
    alert('Please upload a CSV file'); return;
  }
  if(file.size > 1.5 * 1024 * 1024){alert("Choose a CSV smaller than 1.5 MB.");return;}
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

// Lightweight client-side CSV split, used only for the preview table.
// The server does the real, quote-aware parsing for analysis.
function loadData(csv) {
  const records=[];let row=[],field='',quoted=false;
  for(let i=0;i<csv.length;i++){const c=csv[i];if(quoted){if(c==='"'){if(csv[i+1]==='"'){field+='"';i++}else quoted=false}else field+=c}else if(c==='"')quoted=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field.replace(/\r$/,''));if(row.some(x=>x.trim()))records.push(row);row=[];field=''}else field+=c}
  if(field||row.length){row.push(field);if(row.some(x=>x.trim()))records.push(row)}
  inspectDataset(csv);
  currentHeaders=(records[0]||[]).map(x=>x.trim());
  document.getElementById('activeFile').textContent=currentFilename;
  document.getElementById('fileMeta').textContent=Math.max(0,records.length-1)+' rows · '+currentHeaders.length+' cols';
  document.querySelector('#dataTable thead').innerHTML='<tr>'+currentHeaders.map(h=>'<th>'+escapeHtml(h)+'</th>').join('')+'</tr>';
  document.querySelector('#dataTable tbody').innerHTML=records.slice(1,11).map(row=>'<tr>'+currentHeaders.map((_,i)=>'<td>'+escapeHtml(row[i]||'')+'</td>').join('')+'</tr>').join('');
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
  chatHistory = [];
  if (analysisChartInstance) { analysisChartInstance.destroy(); analysisChartInstance = null; }
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

// ---------- Analysis (calls /api/analyze) ----------
async function sendQuestion() {
  const input = document.getElementById('questionInput');
  const btn = document.getElementById('sendBtn');
  if(btn.disabled)return;
  const question = input.value.trim();
  if (!question) return;

  if (!currentCSV) {
    alert('Please upload a CSV file first'); return;
  }

  addMessage(question, 'user');
  chatHistory.push({ role: 'user', content: question });
  input.value = '';
  btn.disabled = true;

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

    document.getElementById(typingId)?.remove();

    if (data.success) {
      addMessage(data.analysis, 'ai', true);
      chatHistory.push({ role: 'assistant', content: data.analysis });
      showResult(data.analysis, data.model, data.rowCount);
      drawChart(data.chartData);
      sessionAnalyses.unshift({filename:currentFilename,question,analysis:data.analysis,chart:data.chartData,model:data.model,rows:data.rowCount,time:new Date().toLocaleTimeString()});
      sessionAnalyses.splice(10); loadSavedHistory();
    } else {
      addMessage('Error: ' + data.error, 'ai');
    }
  } catch (err) {
    document.getElementById(typingId)?.remove();
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

function showResult(analysis, model, rowCount) {
  document.getElementById('resultPanel').style.display = 'block';
  document.getElementById('resultContent').innerHTML = renderMarkdown(analysis);
  const label = model && model.startsWith('gemini') ? `Gemini (${model})`
    : model === 'demo (API failed)' ? 'Demo Mode (API failed — see message above)'
    : 'Computed statistics';
  document.getElementById('resultModel').textContent = label + (rowCount ? ` · ${rowCount.toLocaleString()} rows analyzed` : '');
  document.getElementById('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- Real chart, driven by real chartData from the backend ----------
function drawChart(chartData) {
  const canvas = document.getElementById('analysisChart');
  if(typeof Chart==='undefined'){document.getElementById('chartArea').textContent='Chart library unavailable. Statistics and report remain available.';return;}
  if (analysisChartInstance) {
    analysisChartInstance.destroy();
    analysisChartInstance = null;
  }
  if (!chartData || !chartData.labels || !chartData.labels.length) return;

  const ctx = canvas.getContext('2d');
  const type = ['bar', 'line', 'pie', 'doughnut'].includes(chartData.type) ? chartData.type : 'bar';

  analysisChartInstance = new Chart(ctx, {
    type,
    data: {
      labels: chartData.labels,
      datasets: [{
        label: chartData.title || 'Result',
        data: chartData.values,
        backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#10b981', '#0ea5e9', '#eab308', '#ef4444', '#8b5cf6', '#14b8a6'],
        borderColor: '#6366f1',
        borderWidth: type === 'line' ? 2 : 0,
        fill: type === 'line' ? false : true,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: !!chartData.title, text: chartData.title, color: '#e2e2e8' },
        legend: { labels: { color: '#e2e2e8' }, display: type === 'pie' || type === 'doughnut' },
      },
      scales: (type === 'pie' || type === 'doughnut') ? {} : {
        x: { ticks: { color: '#8888a0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#8888a0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
      }
    }
  });
}

// ---------- Chat panel (calls /api/chat) ----------
// Wired to the same question box's "quick ask" suggestions when no CSV question is needed.

function renderMarkdown(text) {
  return escapeHtml(String(text))
    .replace(/## (.*)/g, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/```([\w]*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/• (.*)/g, '<li>$1</li>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ---------- Export: polished PDF (falls back to text if the PDF lib fails to load) ----------
function exportAnalysis() {
  const resultEl = document.getElementById('resultContent');
  if (!resultEl || !resultEl.innerHTML.trim()) { alert('No analysis to export yet'); return; }

  if (typeof html2pdf === 'undefined') {
    const content = resultEl.innerText;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'analysis_report.txt'; a.click();
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.style.padding = '24px';
  wrapper.style.fontFamily = 'Inter, sans-serif';
  wrapper.style.color = '#111';
  wrapper.innerHTML = `
    <h1 style="font-size:20px;margin-bottom:4px;">Nexus AI — Analysis Report</h1>
    <p style="color:#666;font-size:12px;margin-bottom:16px;">${escapeHtml(currentFilename || 'dataset')} · ${new Date().toLocaleString()}</p>
    <div>${resultEl.innerHTML}</div>
  `;

  html2pdf().from(wrapper).set({
    margin: 10,
    filename: 'analysis_report.pdf',
    html2canvas: { backgroundColor: '#ffffff' },
  }).save();
}

fetch('/api/status').then(r=>r.json()).then(s=>{document.getElementById('aiStatus').textContent=s.aiConfigured?'AI key configured. Provider access is checked on submission. Use sanitized data only; a sample and summary are sent to Gemini.':'Computed statistics available. AI answers require server configuration. Use sample data to try the demo.';if(!s.aiConfigured)document.getElementById('modelSelect').value='demo'}).catch(()=>{document.getElementById('aiStatus').textContent='Service unavailable. Please retry.'});

function renderHistory(){const list=document.getElementById('historyList');list.replaceChildren();sessionAnalyses.forEach(item=>{const row=document.createElement('div');row.style.cssText='padding:12px 0;border-bottom:1px solid #7774;display:flex;gap:16px;align-items:center;justify-content:space-between';const label=document.createElement('span');label.textContent=item.filename+' · '+item.question+' · '+item.time;const button=document.createElement('button');button.className='btn-ghost';button.textContent='View result';button.onclick=()=>{showResult(item.analysis,item.model,item.rows);drawChart(item.chart)};row.append(label,button);list.append(row)})}

async function inspectDataset(csv){document.getElementById('qualityStatus').textContent='Inspecting full dataset…';try{const r=await fetch('/api/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csvData:csv})});const d=await r.json();if(!r.ok)throw Error(d.error);document.getElementById('qualityStatus').textContent=d.rowCount+' rows · '+d.headers.length+' columns · '+d.quality.missingCells+' missing cells · '+d.quality.duplicateRows+' duplicate rows';document.getElementById('qualityDetails').textContent=d.quality.correlations.length?'Numeric correlations (not causation): '+d.quality.correlations.map(c=>c.a+' / '+c.b+': '+c.r).join(' · '):'No nonconstant numeric column pairs available for correlation.';for(const id of ['chartX','chartY']){const el=document.getElementById(id);el.replaceChildren();for(const h of d.headers){const o=document.createElement('option');o.value=h;o.textContent=h;el.append(o)}}const numeric=d.headers.find(h=>d.stats[h].type==='numeric');if(numeric)document.getElementById('chartY').value=numeric}catch(e){document.getElementById('qualityStatus').textContent=e.message}}
document.getElementById('buildChart').onclick=async()=>{try{const r=await fetch('/api/chart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csvData:currentCSV,x:document.getElementById('chartX').value,y:document.getElementById('chartY').value,aggregation:document.getElementById('aggregation').value})});const d=await r.json();if(!r.ok)throw Error(d.error);document.getElementById('resultPanel').style.display='block';document.getElementById('resultModel').textContent='Computed chart · '+d.shownGroups+' groups';document.getElementById('resultContent').textContent=d.title+'\n'+d.labels.map((label,i)=>label+': '+d.values[i]).join('\n');drawChart(d);document.getElementById('qualityStatus').textContent='Chart built from full dataset: '+d.shownGroups+' of '+d.groupCount+' groups displayed.'}catch(e){document.getElementById('qualityStatus').textContent=e.message}};
async function loadSavedHistory(){try{const r=await fetch('/api/runs');const runs=await r.json();const list=document.getElementById('historyList');list.replaceChildren();if(!runs.length){list.textContent='No saved analyses yet.';return}for(const item of runs){const row=document.createElement('div');row.style.cssText='padding:14px 0;display:flex;gap:16px;align-items:center;flex-wrap:wrap';const name=document.createElement('span');name.textContent=item.filename+' · '+item.question;const view=document.createElement('button');view.className='btn-ghost';view.textContent='View saved result';view.onclick=()=>{showResult(item.result.analysis,item.result.model,item.result.rowCount);drawChart(item.result.chartData)};const link=document.createElement('a');link.href='/api/runs/'+item.id+'.json';link.textContent='Download JSON';row.append(name,view,link);list.append(row)}}catch{document.getElementById('historyList').textContent='History unavailable. Please retry.'}}
loadSavedHistory();
