// Renders the Home fit quiz result: Gemma's best-match listing, the search sources behind it,
// the filtered Zillow search link, and Google's search suggestions (required with Search grounding).
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=text??'';return node;};
const link=(href,text)=>{const anchor=document.createElement('a');anchor.href=href;anchor.target='_blank';anchor.rel='noreferrer noopener';anchor.textContent=text;return anchor;};
const safe=value=>{try{const parsed=new URL(value);return parsed.protocol==='https:'?parsed.href:null;}catch{return null;}};
export async function requestHomeMatch({geoid,answers},{signal}={}){
 const response=await fetch('/api/ai/homes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({geoid,answers}),signal});
 const data=await response.json();
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Home search is unavailable. Try again.');
 return data;
}
export function renderHomeMatch(container,result){
 container.replaceChildren();
 if(typeof result.summary==='string'&&result.summary)container.append(el('p','review-summary',result.summary));
 const match=result.status==='ready'&&result.match&&typeof result.match==='object'?result.match:null;
 if(match){
  const article=el('article','home-match'),list=document.createElement('dl');
  article.append(el('h3','',match.address));
  for(const [label,value] of [['Price',match.price],['Beds',match.beds],['Baths',match.baths],['Sq ft',match.sqft]])if(typeof value==='string'&&value)list.append(el('dt','',label),el('dd','',value));
  article.append(list);
  if(match.highlights)article.append(el('p','',match.highlights));
  if(match.reason)article.append(el('p','home-reason',match.reason));
  container.append(article);
 }
 const sources=(Array.isArray(result.sources)?result.sources:[]).filter(source=>safe(source?.url));
 if(sources.length){const line=el('p','home-sources','Found via ');sources.forEach((source,index)=>{if(index)line.append(', ');line.append(link(safe(source.url),typeof source.title==='string'&&source.title?source.title:'source'));});container.append(line);}
 if(safe(result.zillowUrl)){const line=el('p','home-zillow');line.append(link(safe(result.zillowUrl),'Open this search on Zillow ↗'));container.append(line);}
 container.append(el('p','option-note','Gemma reads listings from web search results and can misread them or show one that already sold. Confirm every detail on the listing site.'));
 if(result.searchedAt){const date=new Date(result.searchedAt);if(!Number.isNaN(date.valueOf()))container.append(el('p','review-timestamp',`Searched ${date.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`));}
 if(typeof result.searchSuggestions==='string'&&result.searchSuggestions){const frame=document.createElement('iframe');frame.className='search-suggestions';frame.title='Google Search suggestions';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.srcdoc=result.searchSuggestions;container.append(frame);}
}
