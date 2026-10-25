import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {handleAI} from '../server/gemma.js';
const env={};
try{for(const line of (await readFile('.env.local','utf8')).split(/\r?\n/)){const m=line.match(/^([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}}catch{}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/json','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain','.txt':'text/plain'};
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:4173');
  if(url.pathname.startsWith('/api/ai/')){
   const body=[];for await(const chunk of req)body.push(chunk);
   const request=new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(body)}:{})});
   const response=await handleAI(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const file=resolve('web','.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(resolve('web')+sep)||!(await stat(file)).isFile()){res.writeHead(404);res.end();return;} // sep, not '/', so the check also passes on Windows
  res.setHeader('content-type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(500);res.end('Unavailable');}
}).listen(4173,'127.0.0.1',()=>console.log('Local QA preview: http://127.0.0.1:4173'));
