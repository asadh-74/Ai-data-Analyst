const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const handlers = { '/api/analyze': require('./api/analyze'), '/api/chat': require('./api/chat') };
const assets = {'/':'index.html','/index.html':'index.html','/style.css':'style.css','/script.js':'script.js'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript'};
const windows = new Map();
const server = http.createServer(async(req,res)=>{
  res.status = n => {res.statusCode=n;return res};
  res.json = obj => {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(obj))};
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const pathname = new URL(req.url,'http://localhost').pathname;
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
