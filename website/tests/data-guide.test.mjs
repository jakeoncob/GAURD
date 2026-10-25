import test from 'node:test';
import assert from 'node:assert/strict';
import {describeComparison,guideReply} from '../web/data-guide.js';
const comparison=overrides=>({unit:'per100000',metric:{id:'violent',label:'Violent crime'},baselineYear:2023,predictedYear:2027,series:[{key:'national',year:2023,value:200},{key:'current',year:2023,value:400},{key:'predicted',year:2027,value:300}],...overrides});
test('explains category, reporting years and rates concisely',()=>{
 const reply=describeComparison(comparison(),'Boston',{currentYear:2026});
 assert.match(reply,/Boston · Violent crime/);assert.match(reply,/2023 reported: 400/);assert.match(reply,/U.S. 2023: 200/);assert.match(reply,/2027 forecast: 300 \(25% decrease\)/);
 assert.ok(reply.split(/\s+/).length<60);assert.doesNotMatch(reply,/partner|training files|audit|Honolulu/i);
});
test('rejects mismatched years, wrong horizons, invalid rates and wrong units',()=>{
 const reply=describeComparison(comparison({predictedYear:2028,series:[{key:'national',year:2022,value:999},{key:'current',year:2023,value:-1},{key:'predicted',year:2028,value:888}]}),'Boston');
 assert.match(reply,/Reported rate unavailable/);assert.match(reply,/Matching national rate unavailable/);assert.match(reply,/Four-year forecast unavailable/);assert.doesNotMatch(reply,/999|888|-1/);
 assert.match(describeComparison(comparison({unit:'count'}),'Boston'),/per 100,000 people are unavailable/);
});
test('real zero does not become a missing value or an infinite percentage',()=>{
 const reply=describeComparison(comparison({series:[{key:'national',year:2023,value:0},{key:'current',year:2023,value:0},{key:'predicted',year:2027,value:10}]}),'Boston');
 assert.match(reply,/2023 reported: 0/);assert.match(reply,/U.S. 2023: 0/);assert.match(reply,/percentage change unavailable from zero/);assert.doesNotMatch(reply,/Infinity|NaN/);
});
test('historical horizons stay explicit, while missing values stay unavailable',()=>{
 assert.match(describeComparison(comparison({baselineYear:2020,predictedYear:2024,series:[{key:'predicted',year:2024,value:300}]}),'Boston',{currentYear:2026}),/Historical projection/);
 assert.match(describeComparison(null,'Boston'),/Choose a city/);assert.doesNotMatch(describeComparison(comparison({series:[]}),'Boston'),/rate: 0/);
});
test('live AI and news status remain accurate without a long disclaimer',()=>{
 for(const question of ['What does Gemma predict?','Read current Boston news','Is live AI connected?'])assert.match(guideReply(question,{comparison:comparison()}),/not connected/);
 assert.match(guideReply('What is violent crime?'),/aggravated assault/);assert.match(guideReply('What is property crime?'),/motor vehicle theft/);assert.match(guideReply('Help me explore'),/City list/);assert.match(guideReply('How do I zoom?'),/without dragging/);
});
test('a connected Gemma without a selected city asks for a city without claiming a connection failure',()=>{
 const answer=guideReply('Read current local news',{aiConnected:true});
 assert.match(answer,/Choose a city/);assert.doesNotMatch(answer,/not connected|unavailable/);
});
test('validation uses the selected metric and does not imply a city confidence interval',()=>{
 const reply=guideReply('How accurate is this? What is the error?',{comparison:comparison({provenance:{reportedValidation:{holdoutRows:593,metric:{medianRateErrorPct:15.8}}}})});
 assert.match(reply,/15.8%/);assert.match(reply,/593/);assert.match(reply,/not a confidence interval/);
});
test('housing and unsupported questions do not become invented recommendations',()=>{
 assert.match(guideReply('Which city is safest for my family?'),/do not measure.*personal risk/);assert.match(guideReply('Tell me a joke'),/I can explain the chart/);
});
