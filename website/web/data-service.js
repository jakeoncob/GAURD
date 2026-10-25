import { dataConfig } from './config.js';
import { normalizeCityComparison } from './crime-comparison.js';

let crimeFilePromise;
async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Data request failed (${response.status}).`);
  return response.json();
}
async function getCrimeFile(signal) {
  // Caller cancellation must not cancel another city's shared static-data load.
  crimeFilePromise ??= getJson(dataConfig.crimeDataUrl).catch(error => { crimeFilePromise=null; throw error; });
  const data=await crimeFilePromise; signal?.throwIfAborted(); return data;
}
export const areaDataProvider = {
  async getCityCatalog({signal}={}) { return getJson('./data/city-catalog.json',signal); },
  async getCapabilities() {
    if(dataConfig.mode==='api')return {connected:true,unit:'per100000',forecastHorizons:[4]};
    const data=await getCrimeFile();
    return {connected:Object.values(data.cities??{}).some(city=>Object.keys(city.metrics??{}).length),unit:data.unit,forecastHorizons:[4],metrics:data.metrics,provenance:data.provenance,forecastCityCount:Object.values(data.cities??{}).filter(city=>Object.keys(city.metrics??{}).length).length};
  },
  async getCityComparison(geoid,{metric='violent',signal}={}) {
    if(!/^\d{7}$/.test(geoid))throw new Error('Expected a seven-digit city GEOID.');
    if(!['violent','property'].includes(metric))throw new Error('Unsupported crime category.');
    signal?.throwIfAborted();
    if(dataConfig.mode==='api'){
      if(!dataConfig.apiBaseUrl)throw new Error('The city API URL is not configured.');
      const base=dataConfig.apiBaseUrl.replace(/\/$/,'');
      const payload=await getJson(`${base}/cities/${encodeURIComponent(geoid)}/crime-comparison?horizonYears=4&metric=${metric}`,signal);
      if(payload.metric?.id!==metric)throw new Error('The response belongs to a different crime category.');
      return normalizeCityComparison(payload,geoid);
    }
    const data=await getCrimeFile(signal),city=data.cities?.[geoid]??{},record=data.schemaVersion===2?(city.metrics?.[metric]??{}):city,national=data.national?.[String(record.baselineYear)]??{};
    return normalizeCityComparison({...record,geoid,unit:data.unit,metric:data.metrics?.[metric]??data.metric,nationalRate:data.schemaVersion===2?national.rates?.[metric]:national.rate,nationalYear:national.year,provenance:data.provenance,note:record.note??city.note,sources:[...(Array.isArray(national.sources)?national.sources:[]),...(Array.isArray(record.sources)?record.sources:[])]},geoid);
  },
  async getAreaSummary(displayAreaId, { signal } = {}) {
    signal?.throwIfAborted();
    return {
      displayAreaId,
      modelAreaId: null,
      status: 'not_connected',
      geographyStatus: 'not_mapped',
      observations: [], predictions: [], news: [],
      assessment: null, sources: [], modelVersion: null, dataCutoff: null
    };
  }
};
