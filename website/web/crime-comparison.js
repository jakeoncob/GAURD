const validYear = value => Number.isInteger(value) && value >= 1900 && value <= 2200;
const rate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const validationKeys = ['modelRmseLogChange','noChangeRmseLogChange','trendRmseLogChange','medianRateErrorPct','noChangeMedianRateErrorPct'];

function reportedValidation(report, metricId) {
  const selected = report?.metrics?.[metricId];
  if (!selected || !Number.isInteger(report.holdoutRows) || report.holdoutRows <= 0 || validationKeys.some(key => rate(selected[key]) === null)) return null;
  const years = report.trainingFeatureYears;
  return {
    source:typeof report.source === 'string' ? report.source : null,
    sourceSha256:typeof report.sourceSha256 === 'string' && /^[a-f0-9]{64}$/i.test(report.sourceSha256) ? report.sourceSha256 : null,
    trainingDate:typeof report.trainingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(report.trainingDate) ? report.trainingDate : null,
    trainingRows:Number.isInteger(report.trainingRows) && report.trainingRows > 0 ? report.trainingRows : null,
    trainingFeatureYears:validYear(years?.start) && validYear(years?.end) && years.start <= years.end ? {start:years.start,end:years.end} : null,
    holdoutRows:report.holdoutRows,
    metric:Object.fromEntries(validationKeys.map(key => [key,selected[key]])),
  };
}

/** Missing is null; observed years stay explicit; the horizon is exactly +4. */
export function normalizeCityComparison(payload = {}, requestedGeoid) {
  if (payload.geoid && payload.geoid !== requestedGeoid) throw new Error('The response belongs to a different city.');
  if (payload.unit !== 'per100000') throw new Error('Crime rates must be provided per 100,000 people.');
  const baselineYear = validYear(payload.baselineYear) ? payload.baselineYear : null;
  const predictedYear = baselineYear === null ? null : baselineYear + 4;
  const nationalMatches = baselineYear !== null && payload.nationalYear === baselineYear;
  const forecastMatches = predictedYear !== null && payload.predictedYear === predictedYear;
  const series = [
    {key:'national',label:'National rate',shortLabel:'National',year:nationalMatches ? baselineYear : null,value:nationalMatches ? rate(payload.nationalRate) : null,state:'observed',missingLabel:'National rate not available'},
    {key:'current',label:'Reported city crime',shortLabel:'Reported',year:baselineYear,value:baselineYear === null ? null : rate(payload.currentRate),state:'observed',missingLabel:'City rate not available'},
    {key:'predicted',label:'City prediction, +4 years',shortLabel:'Predicted',year:predictedYear,value:forecastMatches ? rate(payload.predictedRate) : null,state:'forecast',missingLabel:'Forecast not available'},
  ];
  const available = series.filter(s => s.value !== null).length, warnings = [];
  if (rate(payload.nationalRate) !== null && !nationalMatches) warnings.push('The national rate needs to match the city’s reporting year.');
  if (rate(payload.predictedRate) !== null && !forecastMatches) warnings.push('The prediction needs to be exactly four years after the city’s reporting year.');
  if (baselineYear === null && (rate(payload.currentRate) !== null || rate(payload.predictedRate) !== null)) warnings.push('A reporting year is needed before these rates can be shown.');
  return {geoid:requestedGeoid,unit:'per100000',forecastHorizonYears:4,
    metric:{id:typeof payload.metric?.id === 'string' ? payload.metric.id : 'crime_rate',label:typeof payload.metric?.label === 'string' ? payload.metric.label : 'Crime rate',definition:typeof payload.metric?.definition === 'string' ? payload.metric.definition : null},
    baselineYear,predictedYear,series,status:available === 3 ? 'ready' : available ? 'partial' : 'pending',
    sources:Array.isArray(payload.sources) ? payload.sources : [],modelVersion:typeof payload.modelVersion === 'string' ? payload.modelVersion : null,dataCutoff:typeof payload.dataCutoff === 'string' ? payload.dataCutoff : null,
    note:typeof payload.note==='string'?payload.note:null,
    provenance:{status:payload.provenance?.status==='unverified_export'?'unverified_export':'unspecified',validationAvailable:payload.provenance?.validationAvailable===true,reportedValidation:reportedValidation(payload.provenance?.reportedValidation,payload.metric?.id)},warnings};
}
export function chartScale(series) {
  const values = series.map(s => s.value).filter(v => v !== null);
  if (!values.length) return null;
  const maximum = Math.max(...values); if (maximum === 0) return 1;
  const target = maximum * 1.15, magnitude = 10 ** Math.floor(Math.log10(target));
  return ([1,2,2.5,5,10].find(v => v*magnitude >= target) ?? 10)*magnitude;
}
export function formatRate(value) { return value === null ? 'Not available' : new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value); }
const el = (tag, className, text) => { const e=document.createElement(tag);e.className=className;e.textContent=text;return e; };

/** Shared zero-based scale, distinct forecast styling, and accessible values. */
export function renderCrimeComparison(container, comparison, cityName, {loading=false,error=null}={}) {
  const scale=chartScale(comparison.series);container.replaceChildren();
  const heading=el('div','comparison-heading',''),title=el('h3','',comparison.metric.label);title.id='crime-chart-title';
  heading.append(title,el('span',`comparison-badge ${comparison.status}`,loading?'Loading':error?'Unavailable':comparison.status==='ready'?'4-year outlook':comparison.status==='partial'?'Partial data':'No forecast'));container.append(heading,el('p','comparison-unit','Annual offenses per 100,000 people'));
  const figure=el('figure',`crime-chart ${scale===null?'is-empty':''}`,'');figure.tabIndex=0;figure.setAttribute('aria-label',`Crime comparison for ${cityName}. All values are per 100,000 people.`);
  const visual=el('div','chart-visual','');visual.setAttribute('aria-hidden','true');const grid=el('div','chart-grid','');
  for(let i=0;i<3;i++){const line=el('div','chart-gridline','');line.style.bottom=`${i*50}%`;if(scale!==null)line.append(el('span','',new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(scale*i/2)));grid.append(line);}visual.append(grid);
  const bars=el('div','chart-bars','');
  comparison.series.forEach(item=>{const column=el('div',`chart-column ${item.key}`,''),track=el('div',`chart-track ${item.value===null?'is-missing':''}`,'');
    if(item.value!==null){const fill=el('div','chart-fill','');fill.style.height=`${item.value/scale*100}%`;if(item.value===0)fill.classList.add('is-zero');track.append(fill);}else track.append(el('span','chart-pending-label',loading?'Loading':'Unavailable'));
    column.append(el('span','chart-value',item.value===null?'—':formatRate(item.value)),track);bars.append(column);});visual.append(bars);figure.append(visual);
  const labels=el('div','chart-labels','');labels.setAttribute('aria-hidden','true');comparison.series.forEach(item=>{const label=el('div','','');label.append(el('strong','',item.shortLabel),el('span','',item.year!==null?`${item.year}${item.state==='forecast'?' · +4 years':''}`:item.state==='forecast'?'+4 years':'Not supplied'));labels.append(label);});figure.append(labels);
  const table=el('table','sr-only',''),caption=el('caption','',`${comparison.metric.label} per 100,000 people`),body=document.createElement('tbody');table.append(caption);
  comparison.series.forEach(item=>{const row=document.createElement('tr'),label=el('th','',`${item.label}${item.year!==null?` (${item.year})`:''}`);label.scope='row';row.append(label,el('td','',item.value===null?item.missingLabel:formatRate(item.value)));body.append(row);});table.append(body);figure.append(table);container.append(figure);
  if(!loading&&!error&&comparison.status==='ready'){
    const [national,current,predicted]=comparison.series.map(s=>s.value),findings=el('div','comparison-findings','');
    for(const [value,label] of [[national>0?`${Math.abs((current/national-1)*100).toFixed(1)}% ${current>=national?'above':'below'}`:'Not comparable',`vs. national · ${comparison.baselineYear}`],[current>0?`${Math.abs((predicted/current-1)*100).toFixed(1)}% ${predicted>=current?'increase':'decrease'}`:'Change unavailable',`Forecast change · ${comparison.baselineYear}–${comparison.predictedYear}`]]){const item=el('div','','');item.append(el('strong','',value),el('span','',label));findings.append(item);}container.append(findings);
  }
  let note=error?'Couldn’t load rates. Please retry.':loading?'Loading rates…':comparison.status==='pending'?'No forecast available.':comparison.status==='partial'?'Some rates are unavailable.':`Reported: ${comparison.baselineYear} · Forecast: ${comparison.predictedYear} (+4 years).`;
  if(comparison.predictedYear&&comparison.predictedYear<new Date().getFullYear())note+=' Historical projection.';
  if(comparison.warnings.length)note+=` ${comparison.warnings.join(' ')}`;const explanation=el('p','comparison-note',note);explanation.setAttribute('role','status');container.append(explanation);
  const sources=comparison.sources.filter(s=>s&&typeof s.title==='string');
  if(sources.length||comparison.modelVersion||comparison.dataCutoff||comparison.provenance.reportedValidation){const details=el('details','comparison-sources','');details.append(el('summary','','Model & sources'));
    if(comparison.metric.definition)details.append(el('p','',comparison.metric.definition));
    sources.forEach(source=>{const p=document.createElement('p');let url;try{url=new URL(source.url);}catch{url=null;}
      if(url&&['https:','http:'].includes(url.protocol)){const a=el('a','',source.title);a.href=url.href;a.target='_blank';a.rel='noreferrer';p.append(a);}else p.textContent=source.title;
      if(source.year)p.append(document.createTextNode(` · ${source.year}`));details.append(p);});
    if(comparison.modelVersion)details.append(el('p','',`Model: ${comparison.modelVersion}`));if(comparison.dataCutoff)details.append(el('p','',`Data through: ${comparison.dataCutoff}`));
    const validation=comparison.provenance.reportedValidation;
    if(validation){const m=validation.metric;details.append(el('p','',`Validation: ${formatRate(validation.holdoutRows)} holdout observations. Median absolute percentage error: ${formatRate(m.medianRateErrorPct)}% (no change: ${formatRate(m.noChangeMedianRateErrorPct)}%).`));details.append(el('p','',`RMSE, log change: ${m.modelRmseLogChange.toFixed(3)} (no change: ${m.noChangeRmseLogChange.toFixed(3)}; trend: ${m.trendRmseLogChange.toFixed(3)}).`));}
    details.append(el('p','','Citywide estimates; local conditions vary. Validation errors are not individual confidence intervals.'));
    container.append(details);}
}
