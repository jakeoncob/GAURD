import test from 'node:test';import assert from 'node:assert/strict';
import {HOME_QUIZ,validateHomeAnswers,describeHomeProfile,homeQuizQuestion,homeMatchPrompt,loadHomeProfile,zillowSearchUrl} from '../web/home-quiz.js';
const answers={price:'250k-500k',beds:'3',baths:'2',sqft:'1500-2000'};
test('quiz covers price, beds, baths and square feet and rejects unknown answers',()=>{
 assert.deepEqual(HOME_QUIZ.map(question=>question.key),['price','beds','baths','sqft']);
 for(const question of HOME_QUIZ)assert.equal(question.options.length,5);
 assert.deepEqual(validateHomeAnswers(answers),answers);
 assert.equal(validateHomeAnswers({...answers,beds:'30'}),null);assert.equal(validateHomeAnswers({...answers,price:'<script>'}),null);assert.equal(validateHomeAnswers({}),null);assert.equal(validateHomeAnswers(null),null);
});
test('the Gemma question describes the home in plain words and stays within the server limit',()=>{
 const question=homeQuizQuestion(answers,'Boston, MA');
 for(const expected of [/between \$250k and \$500k/,/3 beds/,/2 baths/,/between 1,500 and 2,000 square feet/,/Boston, MA/,/recent local reporting/])assert.match(question,expected);
 assert.ok(question.length<1000);
 assert.equal(homeQuizQuestion({price:'bogus'},'Boston, MA'),'');
 assert.equal(describeHomeProfile({price:'over-1m',beds:'5+',baths:'3+',sqft:'over-3000'}),'a home priced over $1M with 5+ beds, 3+ baths and over 3,000 square feet');
 assert.equal(loadHomeProfile(),null);
});
test('the home-match prompt follows the requested wording with the Zillow link, city and every filter',()=>{
 const url=zillowSearchUrl(answers,'Abilene, TX');
 assert.equal(homeMatchPrompt(answers,'Abilene, TX',url),`Pull me the best match for a house listed on Zillow: ${url} located in Abilene, TX between $250k–$500k with 2 baths and 3 beds and 1,500–2,000 sqft.`);
 assert.match(homeMatchPrompt({price:'under-250k',beds:'5+',baths:'3+',sqft:'over-3000'},'Boston, MA','https://www.zillow.com/x'),/located in Boston, MA priced under \$250k with 3\+ baths and 5\+ beds and over 3,000 sqft\.$/);
 assert.equal(homeMatchPrompt({price:'bogus'},'Boston, MA','https://www.zillow.com/x'),'');assert.equal(homeMatchPrompt(answers,'','https://www.zillow.com/x'),'');
});
test('the Zillow search carries the city and every filter, with open-ended ranges left unbounded',()=>{
 const url=zillowSearchUrl(answers,'Abilene, TX');assert.match(url,/^https:\/\/www\.zillow\.com\/homes\/for_sale\/\?searchQueryState=/);
 const state=JSON.parse(decodeURIComponent(url.split('searchQueryState=')[1]));
 assert.equal(state.usersSearchTerm,'Abilene, TX');assert.deepEqual(state.filterState.price,{min:250000,max:500000});assert.deepEqual(state.filterState.beds,{min:3});assert.deepEqual(state.filterState.baths,{min:2});assert.deepEqual(state.filterState.sqft,{min:1500,max:2000});
 const open=JSON.parse(decodeURIComponent(zillowSearchUrl({price:'over-1m',beds:'5+',baths:'2.5',sqft:'under-1000'},'Boston, MA').split('searchQueryState=')[1])).filterState;
 assert.deepEqual(open.price,{min:1000000});assert.deepEqual(open.beds,{min:5});assert.deepEqual(open.baths,{min:2.5});assert.deepEqual(open.sqft,{max:1000});
 assert.equal(zillowSearchUrl({...answers,beds:'30'},'Boston, MA'),'');assert.equal(zillowSearchUrl(answers,''),'');
});
