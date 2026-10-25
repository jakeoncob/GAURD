import test from 'node:test';
import assert from 'node:assert/strict';
import {cityContext,evidenceFrom,normalizeReview,researchArea,handleAI,verifySources} from '../server/gemma.js';
const now=new Date('2026-10-24T20:00:00Z');
const grounded={candidates:[{content:{parts:[{text:'Boston local newspaper: crime-prevention program, published 2026-10-20.'}]},groundingMetadata:{webSearchQueries:['Boston MA crime prevention October 2026'],groundingChunks:[{web:{uri:'https://example.org/boston-report',title:'Boston report'}},{web:{uri:'javascript:alert(1)',title:'Unsafe'}}]}}]};
const raw={summary:'A recent prevention program adds local context. The model remains unchanged.',noRelevantNews:false,articles:[{sourceId:1,title:'New prevention program',publishedAt:'2026-10-20',relevantToCity:true,context:'The city expanded a prevention program.'}]};
test('server uses trusted GEOID data and rejects unknown cities or categories',()=>{
 assert.equal(cityContext('2507000','violent').forecastRate,545.5);assert.equal(cityContext('2507000','property').forecastRate,1957.6);assert.equal(cityContext('250700','violent'),null);assert.equal(cityContext('9999999','violent'),null);assert.equal(cityContext('2507000','generic'),null);
});
test('research only includes grounded HTTPS sources in the current date window',()=>{
 const evidence=evidenceFrom(grounded);assert.equal(evidence.sources.length,1);
 const review=normalizeReview(raw,evidence,now);assert.equal(review.status,'ready');assert.equal(review.articles[0].url,'https://example.org/boston-report');
 for(const change of [{sourceId:99},{publishedAt:'2020-01-01'},{publishedAt:'2026-12-01'},{publishedAt:'2026-02-31'},{relevantToCity:false}]){
  assert.equal(normalizeReview({...raw,articles:[{...raw.articles[0],...change}]},evidence,now).status,'unverified');
 }
 assert.equal(normalizeReview({noRelevantNews:true,articles:[]},evidence,now).status,'no_relevant_news');
 assert.equal(normalizeReview({noRelevantNews:true,articles:[]},{sources:[],searched:false},now).status,'unverified');
});
test('Gemma performs both search and synthesis using only grounded evidence',async()=>{
 const requests=[];let i=0;
 const fetcher=async(url,options)=>{if(url.startsWith('https://example.org')||url.startsWith('https://news.google.com'))return new Response('<html><head><title>New prevention program</title><meta property="article:published_time" content="2026-10-20"></head></html>',{headers:{'content-type':'text/html'}});requests.push({url,options,body:JSON.parse(options.body)});return Response.json(i++===0?grounded:{candidates:[{content:{parts:[{text:JSON.stringify(raw)}]}}]});};
 const result=await researchArea(cityContext('2507000','violent'),'What is recent?',{GEMINI_API_KEY:'test-key'},{fetcher,now});
 assert.equal(result.status,'ready');assert.equal(requests.length,2);assert.deepEqual(requests[0].body.tools,[{googleSearch:{}}]);assert.equal(requests[1].body.tools,undefined);
 assert.ok(requests.every(request=>/gemma-4-31b-it:generateContent$/.test(request.url)));assert.equal(requests[0].body.generationConfig.thinkingConfig.thinkingLevel,'minimal');assert.equal(requests[0].options.headers['x-goog-api-key'],'test-key');assert.doesNotMatch(requests[0].url,/test-key/);assert.match(requests[1].body.contents[0].parts[0].text,/Allowed sources/);
});
test('home match searches with the research model first, then applies the requested wording to the grounded research only',async()=>{
 const homeAnswers={price:'250k-500k',beds:'3',baths:'2',sqft:'1500-2000'};
 const research={candidates:[{content:{parts:[{text:'1. 314 Hog Eye Rd, Abilene, TX 79602 - $340,000 - 3 beds - 2 baths - 1,653 sqft (Redfin)'}]},groundingMetadata:{webSearchQueries:['Abilene TX homes'],groundingChunks:[{web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',title:'redfin.com'}},{web:{uri:'javascript:alert(1)',title:'bad'}}],searchEntryPoint:{renderedContent:'<div>suggestions</div>'}}}]};
 const pick={candidates:[{content:{parts:[{text:JSON.stringify({found:true,address:'314 Hog Eye Rd, Abilene, TX 79602',price:'$340,000',beds:'3',baths:'2',sqft:'1,653',highlights:'Granite kitchen [1].',reason:'Fits every filter.',summary:'One listing fits.'})}]}}]};
 const requests=[];const req=body=>new Request('https://gaurd.test/api/ai/homes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const fetcher=async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,body});return Response.json(body.tools?research:pick);};
 const response=await handleAI(req({geoid:'2507000',answers:homeAnswers}),{GEMINI_API_KEY:'k'},{fetcher,now});const result=await response.json();
 assert.equal(response.status,200);assert.equal(result.kind,'home_match');assert.equal(result.status,'ready');assert.equal(result.match.address,'314 Hog Eye Rd, Abilene, TX 79602');assert.equal(result.match.highlights,'Granite kitchen.');assert.equal(result.model,'gemma-4-26b-a4b-it');assert.equal(result.searchModel,'gemma-4-31b-it');
 assert.equal(requests.length,2);assert.match(requests[0].url,/gemma-4-31b-it:generateContent$/);assert.match(requests[1].url,/gemma-4-26b-a4b-it:generateContent$/);
 assert.deepEqual(requests[0].body.tools,[{googleSearch:{}}]);assert.match(requests[0].body.contents[0].parts[0].text,/^Find the best matches for a house for sale in Boston, MA priced between \$250k–\$500k with 3 beds, 2 baths and 1,500–2,000 sqft\. Search the web/);assert.equal(requests[0].body.systemInstruction,undefined);
 assert.equal(requests[1].body.tools,undefined);const prompt=requests[1].body.contents[0].parts[0].text;assert.match(prompt,/^Pull me the best match for a house listed on Zillow: https:\/\/www\.zillow\.com\/homes\/for_sale\/\?searchQueryState=/);assert.match(prompt,/located in Boston, MA between \$250k–\$500k with 2 baths and 3 beds and 1,500–2,000 sqft\./);assert.match(prompt,/314 Hog Eye Rd/);
 assert.deepEqual(result.sources,[{id:1,url:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',title:'redfin.com'}]);assert.equal(result.searchSuggestions,'<div>suggestions</div>');assert.match(result.zillowUrl,/^https:\/\/www\.zillow\.com\/homes\/for_sale\//);
 assert.equal((await handleAI(req({geoid:'2507000',answers:{...homeAnswers,beds:'30'}}),{GEMINI_API_KEY:'k'},{fetcher,now})).status,400);
 assert.equal((await handleAI(req({answers:homeAnswers}),{GEMINI_API_KEY:'k'},{fetcher,now})).status,400);
 let calls=0;const ungroundedFetcher=async()=>{calls++;return Response.json({candidates:[{content:{parts:[{text:'Here are some listings: 1 Made Up St, $1'}]}}]});};
 const ungrounded=await (await handleAI(req({geoid:'2507000',answers:{...homeAnswers,sqft:'over-3000'}}),{GEMINI_API_KEY:'k'},{fetcher:ungroundedFetcher,now})).json();
 assert.equal(ungrounded.status,'unverified');assert.equal(ungrounded.match,null);assert.deepEqual(ungrounded.sources,[]);assert.equal(calls,2);
});
test('API validates inputs, preserves secret values, and distinguishes missing configuration from no news',async()=>{
 const req=(body,headers={})=>new Request('https://gaurd.test/api/ai/research',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const missing=await handleAI(req({geoid:'2507000',metric:'violent'}),{});assert.equal(missing.status,503);assert.equal((await missing.json()).code,'not_configured');
 assert.equal((await handleAI(req({geoid:'9999999'}),{GEMINI_API_KEY:'secret'})).status,400);
 assert.equal((await handleAI(req({geoid:'2507000'},{origin:'https://other.test'}),{GEMINI_API_KEY:'secret'})).status,403);
 const status=await handleAI(new Request('https://gaurd.test/api/ai/status'),{GEMINI_API_KEY:'secret'});assert.deepEqual(await status.json(),{configured:true,model:'gemma-4-26b-a4b-it',researchModel:'gemma-4-31b-it'});
 const fail=await handleAI(req({geoid:'2507000',question:'Provider failure test'}),{GEMINI_API_KEY:'test-private-key'},{fetcher:async()=>Response.json({error:{message:'test-private-key'}},{status:429}),now});
 const text=await fail.text();assert.match(text,/usage limit/);assert.doesNotMatch(text,/test-private-key/);
});
test('JSON primitives and arrays return a structured client error instead of crashing the API',async()=>{
 for(const value of [null,[],[{}],'Boston',42,true]){
  const request=new Request('https://gaurd.test/api/ai/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const response=await handleAI(request,{GEMINI_API_KEY:'not-used'});
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'Invalid request.'});
 }
});
test('blocked publishers produce an honest retry state without unsupported tools or another model',async()=>{
 let count=0;
 const fetcher=async(url,options)=>{
  if(url.startsWith('https://example.org')||url.startsWith('https://news.google.com'))return new Response('Blocked',{status:403});
  count++;assert.match(url,/gemma-/);assert.deepEqual(JSON.parse(options.body).tools,[{googleSearch:{}}]);return Response.json(grounded);
 };
 const result=await researchArea(cityContext('2507000','violent'),'Recent context',{GEMINI_API_KEY:'test'},{fetcher,now});
 assert.equal(result.status,'unverified');assert.equal(count,1);assert.equal(result.articles.length,0);
});
