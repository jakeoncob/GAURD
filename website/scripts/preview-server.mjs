import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {handleAI} from '../server/gemma.js';
// Local QA: binds 127.0.0.1:4173 and reads .env.local. Hosted (Render, Railway, Fly): PORT is set by the host,
// so bind every interface and let environment variables override the file. Keys never come from the browser.
const PORT=Number(process.env.PORT)||4173;
const HOST=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
const env={};
try{for(const line of (await readFile('.env.local','utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}}catch{}
for(const key of ['GEMINI_API_KEY','GOOGLE_AI_API_KEY','GEMMA_MODEL','GEMMA_RESEARCH_MODEL'])if(process.env[key])env[key]=process.env[key];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain','.txt':'text/plain'};
http.createServer(async(req,res)=>{
 try{
  // Rebuild the public URL from the proxy headers so the handler's same-origin check matches what the browser sent.
  const proto=(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();
  const host=(req.headers['x-forwarded-host']||req.headers.host||`${HOST}:${PORT}`).split(',')[0].trim();
  const url=new URL(req.url,`${proto}://${host}`);
  if(url.pathname.startsWith('/api/ai/')){
   const body=[];for await(const chunk of req)body.push(chunk);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(body)}:{})});
   const response=await handleAI(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const file=resolve('web','.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(resolve('web')+sep)||!(await stat(file)).isFile()){res.writeHead(404);res.end();return;} // sep, not '/', so the check also passes on Windows
  res.setHeader('content-type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(500);res.end('Unavailable');}
}).listen(PORT,HOST,()=>console.log(`GAURD preview: http://${HOST==='0.0.0.0'?'localhost':HOST}:${PORT}${env.GEMINI_API_KEY||env.GOOGLE_AI_API_KEY?'':' (Gemma not connected: set GEMINI_API_KEY)'}`));
