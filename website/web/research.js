export async function requestGemma({geoid,metric,question,history},{signal,chat=false}={}){
 const response=await fetch(`/api/ai/${chat?'chat':'research'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({geoid,metric,...(question?{question}:{}),...(chat&&history?{history}:{})}),signal});
 let data;try{data=await response.json();}catch{throw new Error('Research is temporarily unavailable. Try again.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Research is temporarily unavailable. Try again.');
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Research is unavailable. Try again.');
 if(!['ready','no_relevant_news','unverified'].includes(data.status))throw new Error('Research is temporarily unavailable. Try again.');
 return data;
}
export async function aiStatus(){const response=await fetch('/api/ai/status');if(!response.ok)throw new Error('Status unavailable');return response.json();}
const el=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
const url=value=>{try{const parsed=new URL(value);return parsed.protocol==='https:'?parsed.href:null;}catch{return null;}};
export function answerText(result){return [result.summary,...(result.points??[]),...(result.articles??[]).map(article=>`${article.title}: ${article.context}`)].filter(text=>typeof text==='string').join('\n').slice(0,1500);}
export function renderReview(container,result,{onCitySelect}={}){
 container.replaceChildren();
 const message=result.status==='no_relevant_news'?`No relevant coverage found in the past ${result.windowDays||90} days.`:result.summary;
 container.append(el('p','review-summary',typeof message==='string'?message:'Research is unavailable. Try again.'));
 if(Array.isArray(result.points)&&result.points.length){const list=el('ul','answer-points','');for(const point of result.points.slice(0,3))if(typeof point==='string')list.append(el('li','',point));container.append(list);}
 if(result.kind==='answer'&&result.newsStatus==='unverified')container.append(el('p','review-note','Recent news couldn’t be verified. You can try Local news again.'));
 if(result.kind==='answer'&&result.newsStatus==='no_relevant_news')container.append(el('p','review-note',`No relevant coverage found in the past ${result.windowDays||90} days.`));
 if(result.articles?.length)container.append(el('h3','review-source-heading','Sources'));
 for(const source of Array.isArray(result.articles)?result.articles:[]){
  const href=url(source.url);if(!href)continue;
  const article=el('article','review-article',''),title=el('h4','',''),link=el('a','',source.title);link.href=href;link.target='_blank';link.rel='noreferrer noopener';title.append(link);
  const parsedDate=new Date(source.publishedAt+'T12:00:00Z');
  const date=el('time','',Number.isNaN(parsedDate.valueOf())?source.publishedAt:parsedDate.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}));date.dateTime=source.publishedAt;
  const meta=el('p','review-source-meta','');if(source.sourceType)meta.append(document.createTextNode(`${source.sourceType} · `));meta.append(date);
  article.append(title,meta,el('p','',source.context));container.append(article);
 }
 if(result.articles?.length)container.append(el('p','review-note','News adds context; it doesn’t change the forecast.'));
 if(result.searchedAt){const date=new Date(result.searchedAt);if(!Number.isNaN(date.valueOf()))container.append(el('p','review-timestamp',`Checked ${date.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} · Past ${result.windowDays||90} days`));}
 if(onCitySelect&&Array.isArray(result.cities)&&result.cities.length){const actions=el('div','answer-actions','');for(const city of result.cities.slice(0,3)){if(!/^\d{7}$/.test(city.geoid))continue;const button=el('button','text-button',`View ${city.name}, ${city.stateAbbr} chart`);button.type='button';button.addEventListener('click',()=>onCitySelect(city));actions.append(button);}container.append(actions);}
 if(typeof result.searchSuggestions==='string'&&result.searchSuggestions){const frame=document.createElement('iframe');frame.className='search-suggestions';frame.title='Google Search suggestions';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.srcdoc=result.searchSuggestions;container.append(frame);}
}
