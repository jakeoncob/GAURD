import test from 'node:test';import assert from 'node:assert/strict';
import {verifySources,normalizeReview} from '../server/gemma.js';
const now=new Date('2026-10-24T20:00:00Z');
test('article page metadata supplies the actual headline and publication date',async()=>{
 const sources=await verifySources({searched:true,sources:[{id:1,url:'https://example.org/report',title:'example.org'}]},{now,fetcher:async()=>new Response('<title>Real &amp; dated headline</title><meta property="article:published_time" content="2026-08-14T12:00:00Z">',{headers:{'content-type':'text/html'}})});
 assert.equal(sources.sources[0].publishedAt,'2026-08-14');assert.equal(sources.sources[0].title,'Real & dated headline');
 const raw={summary:'Summary',articles:[{sourceId:1,publishedAt:'2026-10-12',relevantToCity:true,context:'Context'}]};
 assert.equal(normalizeReview(raw,sources,now).articles[0].publishedAt,'2026-08-14');raw.articles[0].publishedAt='2026-08-14';assert.equal(normalizeReview(raw,sources,now).status,'ready');
});
test('blocked or undated pages cannot become a no-news claim or a current article',async()=>{
 const input={searched:true,sources:[{id:1,url:'https://example.org/report',title:'Report'}]};
 for(const response of [new Response('Blocked',{status:403}),new Response('<title>No date</title>',{headers:{'content-type':'text/html'}})]){
  const sources=await verifySources(input,{now,fetcher:async()=>response});assert.equal(sources.sources.length,0);assert.equal(normalizeReview({noRelevantNews:true,articles:[]},sources,now).status,'unverified');
 }
 let called=false;await verifySources({sources:[{id:1,url:'https://127.0.0.1/private'}]},{now,fetcher:async()=>{called=true;}});assert.equal(called,false);
});
test('company releases retain their source label instead of appearing as independent reporting',async()=>{
 const evidence=await verifySources({searched:true,sources:[{id:1,url:'https://www.globenewswire.com/news-release/example',title:'Release'}]},{now,fetcher:async()=>new Response('<title>Company announcement</title><meta property="article:published_time" content="2026-10-20">',{headers:{'content-type':'text/html'}})});
 const review=normalizeReview({summary:'The company describes its program.',articles:[{sourceId:1,relevantToCity:true,context:'The company says its program expanded.'}]},evidence,now);
 assert.equal(review.articles[0].sourceType,'Company press release');
});
