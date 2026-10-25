import catalog from '../web/data/city-catalog.json' with {type:'json'};
import crime from '../web/data/city-crime.json' with {type:'json'};
import violentModel from '../model-pipeline/models/violent_h4.json' with {type:'json'};
import propertyModel from '../model-pipeline/models/property_h4.json' with {type:'json'};

const rate=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const percent=(value,base)=>value!==null&&base>0?Math.round((value/base-1)*1000)/10:null;
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const available=catalog.cities.filter(city=>city.countryCode==='US');

export function cityContext(geoid,metric='violent'){
 if(!/^\d{7}$/.test(geoid??'')||!['violent','property'].includes(metric))return null;
 const city=available.find(city=>city.geoid===geoid);if(!city)return null;
 const categories={};
 for(const id of ['violent','property']){
  const record=crime.cities[geoid]?.metrics?.[id];
  const baselineYear=Number.isInteger(record?.baselineYear)?record.baselineYear:null;
  const forecastYear=baselineYear&&record?.predictedYear===baselineYear+4?record.predictedYear:null;
  const reportedRate=rate(record?.currentRate),forecastRate=forecastYear?rate(record?.predictedRate):null;
  const nationalRate=baselineYear?rate(crime.national[baselineYear]?.rates?.[id]):null;
  categories[id]={metric:crime.metrics[id].label,definition:crime.metrics[id].definition,baselineYear,reportedRate,nationalYear:baselineYear,nationalRate,forecastYear,forecastRate,forecastChangePct:percent(forecastRate,reportedRate),reportedVsNationalPct:percent(reportedRate,nationalRate),note:record?.note??null};
 }
 return {geoid,name:city.name,state:city.stateName,stateAbbr:city.stateAbbr,metricId:metric,unit:'annual offenses per 100,000 people',...categories[metric],categories};
}

export function lookupCities(query,state,metric='violent'){
 const aliases={nyc:'new york', 'new york city':'new york', 'la':'los angeles', 'dc':'washington', 'washington dc':'washington'};
 let term=normalize(query);term=aliases[term]??term;
 if(!term||term.length>100)return {matches:[],message:'Enter a city name and state.'};
 const region=normalize(state);
 let matches=available.filter(city=>!region||[normalize(city.stateName),normalize(city.stateAbbr)].includes(region));
 const exact=matches.filter(city=>[normalize(city.name),normalize(city.name.replace(/ municipality$/,'')),city.geoid,normalize(city.name+' '+city.stateAbbr),normalize(city.name+' '+city.stateName)].includes(term));
 matches=exact.length?exact:matches.filter(city=>normalize(city.name).includes(term)||normalize(city.stateName)===term||normalize(city.stateAbbr)===term);
 if(matches.length===1)return {matches:[cityContext(matches[0].geoid,metric)]};
 return {matches:matches.slice(0,30).map(({geoid,name,stateName,stateAbbr})=>({geoid,name,state:stateName,stateAbbr})),count:matches.length,message:matches.length?'Choose the city and state, then look up its GEOID for rates.':'No matching city in GAURD’s coverage. Ask for a nearby city.'};
}

export const siteContext={
 name:'GAURD — Geographic Urban Analysis of Risk Dynamics',
 purpose:'Help people explore city crime data when researching where to live.',
 cityCount:available.length,forecastCityCount:Object.keys(crime.cities).filter(id=>Object.values(crime.cities[id].metrics??{}).some(m=>rate(m.predictedRate)!==null)).length,
 definitions:crime.metrics,
 model:{name:crime.provenance.model,horizonYears:4,validation:crime.provenance.reportedValidation,featureNames:[...new Set([...violentModel.features,...propertyModel.features])],featureMeaning:'The feature list comes from the saved trained models. d1 and d5 mean changes over one and five years. These are aggregate area inputs, not individual attributes or evidence that a group causes crime. City-specific feature values and feature contributions are not present in the website export.',coverage:crime.provenance.geographyNote,uncertainty:crime.provenance.uncertaintyNote},
 sources:{rates:'Bundled reported city crime rates and same-year U.S. national rates',forecast:'Saved LightGBM forecasts; Gemma explains them and does not generate or modify the values.'},
 controls:'Type a city and state in Search or use City list. Select a city to open its three-bar comparison. Choose Violent crime or Property crime. Map +/− zooms; arrow controls pan without dragging. Display options includes Reduce motion.',
 limitations:'The reporting year is shown with every rate; it is not necessarily the current year. Forecasts are four years after that reporting year, not four years from today. An annual offense rate is not the percentage of residents who will experience crime. Neighborhood-level data, individual risk and reasons for a particular city forecast are not supplied. National benchmarks must match the reported year and crime category.',
};

export function conversationHistory(value){
 if(!Array.isArray(value))return [];
 return value.slice(-8).filter(turn=>turn&&['user','assistant'].includes(turn.role)&&typeof turn.text==='string'&&turn.text.trim()).map(turn=>({role:turn.role,text:turn.text.trim().slice(0,1500)}));
}
