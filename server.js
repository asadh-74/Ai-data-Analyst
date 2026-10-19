const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto=require('node:crypto');
const runFile=process.env.ANALYSIS_HISTORY_FILE||'/tmp/nexus-analysis-history.json';
let histories={};try{histories=JSON.parse(fs.readFileSync(runFile,'utf8'))}catch{}
function persist(){fs.writeFileSync(runFile+'.tmp',JSON.stringify(histories),{mode:0o600});fs.renameSync(runFile+'.tmp',runFile)}
const analyze=require('./api/analyze');
const handlers = { '/api/analyze': require('./api/analyze'), '/api/chat': require('./api/chat'), '/api/inspect':(req,res)=>{try{res.json(analyze.inspect(req.body.csvData))}catch{res.status(422).json({error:'Invalid CSV: check unique headers, quoting and row lengths.'})}}, '/api/chart':(req,res)=>{try{res.json(analyze.chart(req.body))}catch{res.status(422).json({error:'Select valid columns and a numeric measure.'})}} };
const business=require('./business');
const assets = {'/reports':'reports.html','/reports.js':'reports.js','/workspace.css':'workspace.css','/':'index.html','/index.html':'index.html','/style.css':'style.css','/script.js':'script.js'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript'};
const windows = new Map();
const server = http.createServer(async(req,res)=>{
  res.status = n => {res.statusCode=n;return res};
  let sid=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('analysis_session='))?.split('=')[1];
  if(!/^[a-f0-9]{48}$/.test(sid||'')){sid=crypto.randomBytes(24).toString('hex');res.setHeader('Set-Cookie','analysis_session='+sid+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400'+(process.env.RENDER?'; Secure':''))}
  res.json = obj => {
    if(req.url.split('?')[0]==='/api/analyze'&&obj.success){
      const run={id:crypto.randomUUID(),created:new Date().toISOString(),filename:String(req.body.filename||'data.csv').slice(0,150),question:String(req.body.question).slice(0,2000),result:obj};
      histories[sid]=[run,...(histories[sid]||[])].slice(0,10);
      const sessions=Object.keys(histories);if(sessions.length>100)delete histories[sessions[0]];
      try{persist();obj.runId=run.id}catch{obj.historyWarning='History storage unavailable; analysis succeeded.'}
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj));
  };
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const pathname = new URL(req.url,'http://localhost').pathname;
  if(await business.handle(req,res,sid,pathname))return;
  if(pathname==='/api/runs'&&req.method==='GET')return res.json(histories[sid]||[]);
  if(pathname.startsWith('/api/runs/')&&req.method==='GET'){
    const id=pathname.slice('/api/runs/'.length).replace(/\.json$/,'');const run=(histories[sid]||[]).find(x=>x.id===id);
    if(!run)return res.status(404).json({error:'Analysis not found in this browser session'});
    res.setHeader('Content-Disposition','attachment; filename="analysis-result.json"');return res.json(run);
  }
  if(pathname==='/health') return res.json({status:'ok'});
  if(pathname==='/api/status') return res.json({aiConfigured:!!process.env.GEMINI_API_KEY, fallback:'Computed statistics; not an AI answer'});
  if(handlers[pathname]){
    if(req.method==='OPTIONS') return handlers[pathname](req,res);
    if(req.method!=='POST') return res.status(405).json({error:'Use POST'});
    const key=req.socket.remoteAddress, now=Date.now();
    if(windows.size>1000) for(const [k,v] of windows) if(now-v.start>60000) windows.delete(k);
    let rate=windows.get(key);if(!rate||now-rate.start>60000){rate={start:now,n:0};windows.set(key,rate)}
    if(++rate.n>20) return res.status(429).json({error:'Too many requests. Try again in a minute.'});
    try{
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024){res.status(413).json({error:'CSV request exceeds 2 MB'});return}chunks.push(chunk)}
      req.body=JSON.parse(Buffer.concat(chunks).toString());
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)) return res.status(400).json({error:'Expected a JSON object'});
      await handlers[pathname](req,res);
    }catch{if(!res.writableEnded)res.status(400).json({error:'Invalid request. Send a JSON object with valid fields.'})}
    return;
  }
  if(req.method!=='GET'&&req.method!=='HEAD') return res.status(405).json({error:'Use GET'});
  if(!assets[pathname]) return res.status(404).json({error:'Not found'});
  res.setHeader('Content-Type',types[path.extname(assets[pathname])]);
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(path.join(__dirname,assets[pathname])).pipe(res);
});
if(require.main===module) server.listen(Number(process.env.PORT||3000),'0.0.0.0');
module.exports=server;
