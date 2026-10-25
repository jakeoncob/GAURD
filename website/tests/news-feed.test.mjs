import test from 'node:test';import assert from 'node:assert/strict';
import {evidenceFromFeed,fetchNews,normalizeReview} from '../server/gemma.js';
const now=new Date('2026-10-24T20:00:00Z');
const rss=items=>`<rss><channel><title>feed</title>${items.join('')}</channel></rss>`;
test('feed items supply the decoded headline and the actual publication date',()=>{
 const evidence=evidenceFromFeed(rss(['<item><title>Real &amp; dated headline - Example News</title><link>https://example.org/report</link><pubDate>Fri, 14 Aug 2026 12:00:00 GMT</pubDate><source url="https://example.org">Example News</source></item>']),now);
 assert.equal(evidence.sources[0].publishedAt,'2026-08-14');assert.equal(evidence.sources[0].title,'Real & dated headline');assert.equal(evidence.sources[0].publisher,'Example News');
 const raw={summary:'Summary',articles:[{sourceId:1,publishedAt:'2026-10-12',relevantToCity:true,context:'Context'}]};
 const review=normalizeReview(raw,evidence,now);assert.equal(review.status,'ready');assert.equal(review.articles[0].publishedAt,'2026-08-14');assert.equal(review.searchSuggestions,undefined);
});
test('undated, malformed, or private-address items are dropped and a failed feed cannot become a no-news claim',async()=>{
 for(const item of ['<item><title>No date</title><link>https://example.org/report</link></item>','<item><title>Bad date</title><link>https://example.org/report</link><pubDate>someday</pubDate></item>','<item><title>Private</title><link>https://127.0.0.1/private</link><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate></item>','<item><title>Local</title><link>https://intranet.local/report</link><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate></item>']){
  assert.equal(evidenceFromFeed(rss([item]),now).sources.length,0);
 }
 const context={name:'Boston',state:'Massachusetts'};
 for(const fetcher of [async()=>new Response('Blocked',{status:403}),async()=>{throw new Error('network');}]){
  const evidence=await fetchNews(context,{now,fetcher});assert.equal(evidence.searched,false);assert.equal(normalizeReview({noRelevantNews:true,articles:[]},evidence,now).status,'unverified');
 }
 const requested=[];await fetchNews(context,{now,fetcher:async url=>{requested.push(url);return new Response(rss([]));}});
 assert.equal(requested.length,1);assert.match(requested[0],/^https:\/\/news\.google\.com\/rss\/search\?q=/);
});

test('RSS fallback preserves dated headlines and Gemma-only synthesis after search failure',async()=>{
 const {researchArea,cityContext}=await import('../server/gemma.js');const calls=[];
 const fetcher=async(url,options)=>{calls.push(url);if(url.startsWith('https://news.google.com'))return new Response(rss(['<item><title>Boston housing update</title><link>https://example.org/report</link><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate></item>']));const body=JSON.parse(options.body);if(body.tools)return Response.json({error:{}},{status:400});assert.match(body.contents[0].parts[0].text,/headlines only/);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({summary:'A housing update was reported [1].',articles:[{sourceId:1,relevantToCity:true,context:'A Boston housing update [1].'}]})}]}}]});};
 const result=await researchArea(cityContext('2507000','violent'),'Housing news',{GEMINI_API_KEY:'test'},{fetcher,now});assert.equal(result.status,'ready');assert.equal(result.articles[0].title,'Boston housing update');assert.equal(result.summary,'A housing update was reported.');assert.equal(calls.length,3);for(const url of calls.filter(u=>!u.startsWith('https://news.google.com')))assert.match(url,/models\/gemma-/);
});
test('a malformed feed is not an empty-news result',async()=>{const evidence=await fetchNews({name:'Boston',state:'Massachusetts'},{now,fetcher:async()=>new Response('<html>Service error</html>')});assert.equal(evidence.searched,false);});
