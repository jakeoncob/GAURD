const validYear = value => Number.isInteger(value) && value >= 1900 && value <= 2200;
const validRate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const number = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:1}).format(value);
function itemFor(comparison,key,year){
  if(!validYear(year))return null;
  const item=comparison?.series?.find(item=>item.key===key);
  return item?.year===year&&validRate(item.value)?item:null;
}
function change(value,baseline){
  if(value===baseline)return 'unchanged';
  if(baseline===0)return 'percentage change unavailable from zero';
  return `${number(Math.abs((value/baseline-1)*100))}% ${value>baseline?'increase':'decrease'}`;
}
export function describeComparison(comparison,cityName,{currentYear=new Date().getFullYear()}={}){
  if(!comparison)return 'Choose a city to see its forecast.';
  if(comparison.unit!=='per100000')return 'Comparable rates per 100,000 people are unavailable.';
  const baseline=comparison.baselineYear,forecast=validYear(baseline)&&comparison.predictedYear===baseline+4?comparison.predictedYear:null;
  const current=itemFor(comparison,'current',baseline),national=itemFor(comparison,'national',baseline),predicted=itemFor(comparison,'predicted',forecast);
  const parts=[`${cityName||'This city'} · ${comparison.metric?.label||'Crime rate'}. Annual rates per 100,000 people.`];
  parts.push(current?`${baseline} reported: ${number(current.value)}.`:'Reported rate unavailable.');
  if(national)parts.push(`U.S. ${baseline}: ${number(national.value)}.`);
  else parts.push('Matching national rate unavailable.');
  if(predicted)parts.push(`${forecast} forecast: ${number(predicted.value)}${current?` (${change(predicted.value,current.value)})`:''}.`);
  else parts.push('Four-year forecast unavailable.');
  if(predicted&&forecast<currentYear)parts.push('Historical projection.');
  return parts.join(' ');
}
export function guideReply(question,{comparison,cityName,aiConnected=false}={}){
  const text=typeof question==='string'?question.trim().toLowerCase():'';
  if(/\b(news|headlines?|articles?|gemma|live ai|ai chatbot|web search|research)\b/.test(text))return aiConnected?'Choose a city first so Gemma can research its recent news.':'Live Gemma and news retrieval are not connected. You can still explore the city charts.';
  if(/\b(safe|safer|safest|dangerous|recommend|housing|famil(?:y|ies)|moving|where (?:should|to)|live|home|personal (?:risk|probability))\b/.test(text))return 'Citywide crime rates do not measure your family’s personal risk. Consider neighborhood conditions and your other needs, too.';
  if(/\b(defin(?:e|ition)|meaning|what (?:is|are)|difference between|categor(?:y|ies)|include|counts? as)\b/.test(text)&&/\b(violent|property|crime|categor(?:y|ies))\b/.test(text)){
    if(/property/.test(text)&&!/violent/.test(text))return 'Property crime includes burglary, larceny-theft, and motor vehicle theft.';
    return 'Violent crime includes murder, rape, robbery, and aggravated assault. Property crime includes burglary, larceny-theft, and motor vehicle theft.';
  }
  if(/\b(map|explore|search|find|navigate|zoom|pan|keyboard|controls?|city list|city dots?|state)\b/.test(text)||text==='help')return 'Search a city and state, choose City list, or click a city dot. Use +/− to zoom and arrow controls to pan without dragging.';
  if(/\b(validation|accuracy|error)\b/.test(text)){
    const report=comparison?.provenance?.reportedValidation;
    return report?`Median absolute percentage error: ${number(report.metric.medianRateErrorPct)}% across ${number(report.holdoutRows)} holdout observations. This is not a confidence interval for one city.`:'Choose a city to see validation details.';
  }
  if(/\b(chart|bars?|rates?|forecast|predic(?:t|tion|ted|tor)|outlook|baseline|national|reported|numbers?|change|comparison|compare|model|years?|100[,.]?000)\b/.test(text))return describeComparison(comparison,cityName);
  return 'I can explain the chart, crime categories, or map controls.';
}
