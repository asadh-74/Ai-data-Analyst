// Deterministic scheduled reporting over versioned CSV snapshots. No external delivery.
const fs=require('node:fs'),crypto=require('node:crypto');const {parseCSV}=require('./api/analyze');
const file=process.env.REPORT_JOBS_FILE||'/tmp/nexus-report-jobs.json';let sessions={};try{sessions=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function save(){fs.writeFileSync(file+'.tmp',JSON.stringify(sessions),{mode:0o600});fs.renameSync(file+'.tmp',file)}
function csvCell(s){s=String(s??'');if(/^[=+@-]/.test(s.trimStart()))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
function build(sources){
 if(!Array.isArray(sources)||sources.length<1||sources.length>5)throw Error('Import between one and five CSV sources');
 let headers,rows=[],input=0,duplicates=0;const seen=new Set();
 for(const s of sources){if(typeof s.csvData!=='string'||s.csvData.length>1000000)throw Error('Each source must be a CSV below 1 MB');let parsed=parseCSV(s.csvData);const hs=parsed.headers.map(h=>h.toLowerCase().replace(/\s+/g,'_'));if(new Set(hs).size!==hs.length)throw Error('Headers collide after normalization');if(!headers)headers=hs;if(headers.length!==hs.length||headers.some(h=>!hs.includes(h)))throw Error('All sources must contain the same columns');
 for(const raw of parsed.rows){input++;if(input>20000)throw Error('Use at most 20,000 combined rows');const row=Object.fromEntries(parsed.headers.map((h,i)=>[hs[i],raw[h].trim()]));const key=JSON.stringify(headers.map(h=>row[h]));if(seen.has(key)){duplicates++;continue}seen.add(key);rows.push(row)}}
 for(const h of ['date','order_id','revenue','cost','region'])if(!headers.includes(h))throw Error('Required columns: date, order_id, revenue, cost, region');
 const idCounts=new Map();for(const r of rows)idCounts.set(r.order_id,(idCounts.get(r.order_id)||0)+1);
 let exceptions=[],clean=[];for(const [i,r]of rows.entries()){
 const reasons=[];if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)reasons.push('invalid date');
 if(!r.order_id)reasons.push('missing order ID');else if(idCounts.get(r.order_id)>1)reasons.push('conflicting order ID; all versions excluded');
 for(const h of ['revenue','cost'])if(!/^\d+(\.\d{1,2})?$/.test(r[h])||!Number.isFinite(Number(r[h]))||Number(r[h])>1000000000)reasons.push('invalid '+h);
 if(!r.region)reasons.push('missing region');if(reasons.length){exceptions.push({row:i+1,orderId:r.order_id,reasons});continue}clean.push(r)}
 if(!clean.length)throw Error('No valid rows remain after validation');
 let revenue=0,cost=0;const groups=new Map();for(const r of clean){const rev=Math.round(Number(r.revenue)*100),c=Math.round(Number(r.cost)*100);revenue+=rev;cost+=c;let g=groups.get(r.region)||{region:r.region,orders:0,revenue:0,cost:0};g.orders++;g.revenue+=rev;g.cost+=c;groups.set(r.region,g)}
 const dates=clean.map(r=>r.date).sort();return {generatedAt:new Date().toISOString(),sources:sources.map(s=>String(s.name||'CSV source').slice(0,120)),period:{from:dates[0],to:dates.at(-1)},quality:{inputRows:input,duplicatesRemoved:duplicates,exceptions:exceptions.length,validRows:clean.length,exceptionPreview:exceptions.slice(0,50)},kpis:{orders:clean.length,revenue:revenue/100,cost:cost/100,profit:(revenue-cost)/100,margin:revenue?Number(((revenue-cost)/revenue*100).toFixed(2)):null,averageOrder:revenue/100/clean.length},regions:[...groups.values()].map(g=>({...g,revenue:g.revenue/100,cost:g.cost/100})),cleanedCsv:[headers.map(csvCell).join(','),...clean.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\n'),basis:'Computed from uploaded CSV snapshots; no external refresh or email delivery'};
}
function state(sid){if(!sessions[sid]){if(Object.keys(sessions).length>=100)delete sessions[Object.keys(sessions)[0]];sessions[sid]={jobs:[],reports:[],updated:Date.now()}}sessions[sid].updated=Date.now();return sessions[sid]}
function execute(s,job,now=Date.now()){
 try{const result=build(job.sources);const report={id:crypto.randomUUID(),jobId:job.id,title:job.title,created:new Date(now).toISOString(),result};s.reports.unshift(report);s.reports=s.reports.slice(0,20);job.lastStatus='completed';job.lastReportId=report.id;job.lastError=null}
 catch(e){job.lastStatus='failed';job.lastError=e.message}
 job.lastRun=new Date(now).toISOString();job.nextRun=now+job.intervalSeconds*1000;
}
function tick(now=Date.now()){let changed=false;for(const [sid,s]of Object.entries(sessions)){if(now-s.updated>86400000){delete sessions[sid];changed=true;continue}for(const job of s.jobs)if(job.enabled&&job.nextRun<=now){execute(s,job,now);changed=true}}if(changed)save()}
const timer=setInterval(()=>{try{tick()}catch{console.error('Report scheduler could not save state')}},5000);timer.unref();
function summary(s){return {jobs:s.jobs.map(({sources,...j})=>({...j,sourceNames:sources.map(x=>x.name)})),reports:s.reports.map(({result,...r})=>({...r,kpis:result.kpis,quality:result.quality})),scheduler:'Runs while the web service is awake. Free hosting may suspend it; overdue jobs run on wake. Files reset on redeploy unless durable storage is configured.'}}
async function handle(req,res,sid,p){if(!p.startsWith('/api/business/'))return false;const s=state(sid);
 try{
 if(req.method==='GET'&&p==='/api/business/state'){tick();res.json(summary(s));return true}
 const download=p.match(/^\/api\/business\/reports\/([a-f0-9-]+)\.(json|csv|html)$/);if(req.method==='GET'&&download){const r=s.reports.find(x=>x.id===download[1]);if(!r){res.status(404).json({error:'Report not found in this session'});return true}const type=download[2];res.setHeader('Content-Disposition','attachment; filename="business-report.'+type+'"');if(type==='json')res.json(r);else if(type==='csv'){res.setHeader('Content-Type','text/csv');res.end(r.result.cleanedCsv)}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(render(r))}return true}
 if(req.method!=='POST'){res.status(405).json({error:'Use POST'});return true}let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>2*1024*1024){res.status(413).json({error:'Sources exceed 2 MB'});return true}chunks.push(c)}const body=JSON.parse(Buffer.concat(chunks).toString());
 if(p==='/api/business/preview'){res.json(build(body.sources));return true}
 if(p==='/api/business/jobs'){
 if(s.jobs.length>=5)throw Error('Limit: five schedules per session');build(body.sources);if(![15,3600,86400,604800].includes(body.intervalSeconds))throw Error('Choose a supported interval');
 const job={id:crypto.randomUUID(),title:String(body.title||'Business report').slice(0,100),sources:body.sources,intervalSeconds:body.intervalSeconds,enabled:true,nextRun:Date.now()+body.intervalSeconds*1000,lastStatus:'scheduled'};s.jobs.unshift(job);save();res.status(201).json(summary(s));return true}
 const match=p.match(/^\/api\/business\/jobs\/([a-f0-9-]+)\/(run|toggle|delete)$/);if(match){const job=s.jobs.find(j=>j.id===match[1]);if(!job){res.status(404).json({error:'Schedule not found'});return true}if(match[2]==='run')execute(s,job);if(match[2]==='toggle'){job.enabled=!job.enabled;job.nextRun=Date.now()+job.intervalSeconds*1000}if(match[2]==='delete')s.jobs=s.jobs.filter(j=>j.id!==job.id);save();res.json(summary(s));return true}
 res.status(404).json({error:'Not found'});
 }catch(e){res.status(422).json({error:e instanceof SyntaxError?'Invalid JSON':e.message})}return true;
}
function render(r){const x=r.result;return `<!doctype html><html><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font:16px system-ui;max-width:900px;margin:50px auto;color:#172134}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}table{width:100%}small{color:#526077}@media print{button{display:none}}</style><button onclick="print()">Print / Save as PDF</button><h1>${esc(r.title)}</h1><p>${esc(r.created)} · ${esc(x.period.from)} to ${esc(x.period.to)}</p><h2>Business performance</h2><p>Orders: ${x.kpis.orders} · Revenue: ${x.kpis.revenue.toFixed(2)} · Profit: ${x.kpis.profit.toFixed(2)} · Margin: ${x.kpis.margin??'N/A'}%</p><table><tr><th>Region</th><th>Orders</th><th>Revenue</th><th>Cost</th></tr>${x.regions.map(g=>`<tr><td>${esc(g.region)}</td><td>${g.orders}</td><td>${g.revenue.toFixed(2)}</td><td>${g.cost.toFixed(2)}</td></tr>`).join('')}</table><p>Quality: ${x.quality.duplicatesRemoved} duplicates removed · ${x.quality.exceptions} exceptions excluded.</p><small>${esc(x.basis)}. Use one currency across all sources. Source files: ${x.sources.map(esc).join(', ')}.</small></html>`}
module.exports={build,handle,tick,execute};
