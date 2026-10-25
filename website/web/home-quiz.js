// Home fit quiz: four multiple-choice questions (price range, bedrooms, bathrooms, square feet)
// that become a tailored question for Gemma's local review. Answers stay in this browser.
export const HOME_QUIZ=[
 {key:'price',legend:'Price range',options:[['under-250k','Under $250k','under $250k'],['250k-500k','$250k–$500k','between $250k and $500k'],['500k-750k','$500k–$750k','between $500k and $750k'],['750k-1m','$750k–$1M','between $750k and $1M'],['over-1m','Over $1M','over $1M']]},
 {key:'beds',legend:'Bedrooms',options:[['1','1 bed','1 bed'],['2','2 beds','2 beds'],['3','3 beds','3 beds'],['4','4 beds','4 beds'],['5+','5+ beds','5+ beds']]},
 {key:'baths',legend:'Bathrooms',options:[['1','1 bath','1 bath'],['1.5','1.5 baths','1.5 baths'],['2','2 baths','2 baths'],['2.5','2.5 baths','2.5 baths'],['3+','3+ baths','3+ baths']]},
 {key:'sqft',legend:'Square feet',options:[['under-1000','Under 1,000','under 1,000'],['1000-1500','1,000–1,500','between 1,000 and 1,500'],['1500-2000','1,500–2,000','between 1,500 and 2,000'],['2000-3000','2,000–3,000','between 2,000 and 3,000'],['over-3000','Over 3,000','over 3,000']]},
];
const STORAGE_KEY='gaurd-home-profile';
const phrase=(key,value)=>HOME_QUIZ.find(question=>question.key===key).options.find(([option])=>option===value)[2];
export function validateHomeAnswers(input){
 const answers={};
 for(const question of HOME_QUIZ){const value=String(input?.[question.key]??'');if(!question.options.some(([option])=>option===value))return null;answers[question.key]=value;}
 return answers;
}
export function describeHomeProfile(answers){
 const valid=validateHomeAnswers(answers);if(!valid)return '';
 return `a home priced ${phrase('price',valid.price)} with ${phrase('beds',valid.beds)}, ${phrase('baths',valid.baths)} and ${phrase('sqft',valid.sqft)} square feet`;
}
export function homeQuizQuestion(answers,cityName){
 const profile=describeHomeProfile(answers);if(!profile)return '';
 return `I am considering ${profile} in ${cityName}. What does recent local reporting say about housing, neighborhood safety and crime trends that someone looking at that kind of home should know?`;
}
// Zillow search for the quiz answers. Zillow has no public listings API, so the quiz opens Zillow's own
// for-sale search with the price, bed, bath and square-foot filters applied to the selected city.
const RANGES={price:{'under-250k':[null,250000],'250k-500k':[250000,500000],'500k-750k':[500000,750000],'750k-1m':[750000,1000000],'over-1m':[1000000,null]},sqft:{'under-1000':[null,1000],'1000-1500':[1000,1500],'1500-2000':[1500,2000],'2000-3000':[2000,3000],'over-3000':[3000,null]}};
const bounds=([min,max])=>({...(min!==null?{min}:{}),...(max!==null?{max}:{})});
export function zillowSearchUrl(answers,cityName){
 const valid=validateHomeAnswers(answers);if(!valid||typeof cityName!=='string'||!cityName.trim())return '';
 const filterState={price:bounds(RANGES.price[valid.price]),beds:{min:parseInt(valid.beds,10)},baths:{min:parseFloat(valid.baths)},sqft:bounds(RANGES.sqft[valid.sqft]),sort:{value:'globalrelevanceex'}};
 const state={usersSearchTerm:cityName.trim(),isMapVisible:true,isListVisible:true,filterState};
 return `https://www.zillow.com/homes/for_sale/?searchQueryState=${encodeURIComponent(JSON.stringify(state))}`;
}
export function homeAnswerLabels(answers){const valid=validateHomeAnswers(answers);if(!valid)return null;return Object.fromEntries(HOME_QUIZ.map(question=>[question.key,question.options.find(([option])=>option===valid[question.key])[1]]));}
// The sentence sent to Gemma for the home match, in the wording the product owner asked for.
export function homeMatchPrompt(answers,cityName,zillowUrl){
 const labels=homeAnswerLabels(answers);if(!labels||typeof cityName!=='string'||!cityName.trim())return '';
 const price=labels.price.includes('–')?`between ${labels.price}`:`priced ${labels.price.toLowerCase()}`,sqft=labels.sqft.includes('–')?labels.sqft:labels.sqft.toLowerCase();
 return `Pull me the best match for a house listed on Zillow: ${zillowUrl} located in ${cityName.trim()} ${price} with ${labels.baths} and ${labels.beds} and ${sqft} sqft.`;
}
export function loadHomeProfile(){try{return validateHomeAnswers(JSON.parse(localStorage.getItem(STORAGE_KEY)??'null'));}catch{return null;}}
export function saveHomeProfile(answers){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(answers));}catch{/* Optional per-browser convenience. */}}
export function setupHomeQuiz(form,onSubmit){
 const saved=loadHomeProfile(),submit=form.querySelector('[type="submit"]');
 for(const question of HOME_QUIZ){
  const fieldset=document.createElement('fieldset');fieldset.className='quiz-question';
  const legend=document.createElement('legend');legend.textContent=question.legend;
  const options=document.createElement('div');options.className='quiz-options';
  for(const [value,text] of question.options){
   const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');
   input.type='radio';input.name=question.key;input.value=value;input.required=true;input.checked=saved?.[question.key]===value;
   span.textContent=text;label.append(input,span);options.append(label);
  }
  fieldset.append(legend,options);form.insertBefore(fieldset,submit);
 }
 form.addEventListener('submit',event=>{
  event.preventDefault();
  const answers=validateHomeAnswers(Object.fromEntries(new FormData(form)));if(!answers)return;
  saveHomeProfile(answers);onSubmit(answers);
 });
}
