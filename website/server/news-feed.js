const windowDays=90;
const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const day=date=>date.toISOString().slice(0,10);
const dateWindow=now=>({end:day(now),start:day(new Date(now.getTime()-windowDays*86400000))});
const entities=text=>text.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/<[^>]+>/g,'').trim();
const citations=text=>text.replace(/\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g,'').trim(); // "[2, 4, 11]" markers mean nothing to readers; the article list is the attribution
const publicUrl=value=>{const safe=safeUrl(value);if(!safe)return null;const host=new URL(safe).hostname;return host.includes('.')&&!host.includes(':')&&!/^\d+(\.\d+){3}$/.test(host)&&!/(^|\.)(localhost|local|internal)$/.test(host)?safe:null;};
const tag=(xml,name)=>{const match=xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,'i'));return match?entities(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/,'$1')):'';};
export function newsFeedUrl(context){
 const query=`"${context.name}" ${context.state} (crime OR police OR shooting OR violence OR theft OR burglary OR safety OR housing) when:${windowDays}d`;
 return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}
export function evidenceFromFeed(xml,now=new Date()){
 const {start,end}=dateWindow(now),unique=new Map();
 for(const [,item] of String(xml??'').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const url=publicUrl(tag(item,'link')),published=Date.parse(tag(item,'pubDate'));
  if(!url||unique.has(url)||!Number.isFinite(published))continue;
  const publishedAt=day(new Date(published));if(publishedAt<start||publishedAt>end)continue;
  const publisher=tag(item,'source').slice(0,80);let title=tag(item,'title');
  if(publisher&&title.endsWith(` - ${publisher}`))title=title.slice(0,-publisher.length-3).trim();
  if(!title)continue;
  unique.set(url,{id:unique.size+1,url,title:title.slice(0,180),publisher,publishedAt});
 }
 return {sources:[...unique.values()].slice(0,20),searched:true,unavailableSources:0};
}
export async function fetchNews(context,{fetcher=fetch,now=new Date()}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000),failed={sources:[],searched:false,unavailableSources:0};
 try{
  const response=await fetcher(newsFeedUrl(context),{signal:controller.signal,headers:{accept:'application/rss+xml, application/xml, text/xml'}});
  if(!response.ok)return failed;
  const xml=await response.text();if(!/<rss\b/i.test(xml)||!/<channel\b/i.test(xml))return failed;
  return evidenceFromFeed(xml,now);
 }catch{return failed;}finally{clearTimeout(timer);}
}
