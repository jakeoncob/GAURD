import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGemma} from '../web/research.js';

test('news failures and malformed responses produce useful messages rather than JSON parser errors',async()=>{
 const original=globalThis.fetch;
 try{
  for(const response of [new Response('<html>Unavailable</html>',{status:502}),Response.json(null),Response.json([]),Response.json({}),Response.json({status:'unknown'})]){
   globalThis.fetch=async()=>response;
   await assert.rejects(requestGemma({geoid:'2507000',metric:'violent'}),/Research is temporarily unavailable\. Try again\./);
  }
  globalThis.fetch=async()=>Response.json({error:'Gemma is busy. Try again shortly.'},{status:429});
  await assert.rejects(requestGemma({geoid:'2507000',metric:'violent'}),/Gemma is busy/);
 }finally{globalThis.fetch=original;}
});

test('unverified research remains distinct from an explicit no-news result',async()=>{
 const original=globalThis.fetch;
 try{
  for(const status of ['ready','unverified','no_relevant_news']){
   globalThis.fetch=async()=>Response.json({status,summary:'Review result',articles:[]});
   const result=await requestGemma({geoid:'2507000',metric:'violent'});assert.equal(result.status,status);
  }
 }finally{globalThis.fetch=original;}
});
