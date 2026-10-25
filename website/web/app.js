import { areaDataProvider } from './data-service.js';
import { normalizeCityComparison, renderCrimeComparison } from './crime-comparison.js';
import { regionalBasemapLayers, stateLabelFeatures, stateLabelsLayer } from './map-labels.js';
import { initializeWorkspace, mapPadding, reducedMotion } from './workspace.js';
import { guideReply } from './data-guide.js';
import { containPopupScroll } from './map-hover.js';
import { aiStatus, requestGemma, renderReview, answerText } from './research.js';
import { requestHomeMatch, renderHomeMatch } from './home-match.js';
import { setupHomeQuiz, describeHomeProfile } from './home-quiz.js';

const $ = s => document.querySelector(s);
const icons = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  expand: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  sprout: '<path d="M12 21v-8m0 3C3 16 3 7 3 7s9 0 9 9Zm0-3C12 4 21 4 21 4s0 9-9 9Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-9v.1"/>',
  trend: '<path d="M4 4v16h16M7 14l4-4 4 2 5-7m-5 0h5v5"/>',
  news: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8m-8 4h4m-4 4h8m0-4h.1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  display:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-5-12h10"/>',
  move:'<path d="M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.pin}</svg>`; }
function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
paintIcons();

let map, regions = [], cities = [], selectedArea = null, hoveredId = null, selectedRequest;
let selectedComparison=null;
let selectedMetric=new URLSearchParams(location.search).get('metric')==='property'?'property':'violent';
const metricDefinitions={violent:{id:'violent',label:'Violent crime'},property:{id:'property',label:'Property crime'}};
const emptyComparison=geoid=>normalizeCityComparison({unit:'per100000',metric:metricDefinitions[selectedMetric]},geoid);
document.querySelectorAll('[name="crime-metric"]').forEach(input=>{input.checked=input.value===selectedMetric;});
let regionIndexError = false, catalogError = false, mapReady = false;
const initialView = { center: [-96, 39], zoom: 3.35 };
const motion = () => reducedMotion() ? 0 : 650;
const announce = message => { $('#announcements').textContent = message; };
const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isCity = area => area?.kind === 'city';
const areaSource = area => isCity(area) ? 'cities' : 'regions';
const cityFeatures = () => ({type:'FeatureCollection',features:cities.map(city=>({type:'Feature',id:city.id,properties:{id:city.id,name:city.name,geoid:city.geoid,stateAbbr:city.stateAbbr,country:city.country},geometry:{type:'Point',coordinates:[city.longitude,city.latitude]}}))});
function syncCityMarkers() { map?.getSource('cities')?.setData(cityFeatures()); }
function syncStateLabels() { map?.getSource('state-labels')?.setData(stateLabelFeatures(regions, map.getZoom())); }

function regionButton(region, className = 'suggested-area') {
  const button = document.createElement('button');
  button.className = className;
  const mark = document.createElement('span'); mark.className = 'icon'; mark.innerHTML = icon('pin');
  const copy = document.createElement('span');
  const name = document.createElement('strong'); name.textContent = region.name;
  const country = document.createElement('small'); country.textContent = isCity(region) ? (className==='suggested-area'?region.stateName:`${region.stateName} · ${region.stateAbbr}`) : region.country;
  copy.append(name, country); button.append(mark, copy);
  if (className === 'suggested-area') {
    const arrow = document.createElement('span'); arrow.className = 'row-arrow'; arrow.textContent = '→'; arrow.ariaHidden = 'true'; button.append(arrow);
  }
  button.addEventListener('click', () => { selectArea(region); closeSearch(); });
  return button;
}

async function loadIndex() {
  const [regional, catalog, capabilities] = await Promise.allSettled([
    fetch('./data/region-index.json').then(response=>{if(!response.ok)throw new Error('Region list unavailable');return response.json();}),
    areaDataProvider.getCityCatalog(),
    areaDataProvider.getCapabilities(),
  ]);
  if(regional.status==='fulfilled')regions=regional.value.filter(region=>region.countryCode==='US');else regionIndexError=true;
  if(catalog.status==='fulfilled')cities=catalog.value.cities.filter(city=>city.countryCode==='US');else catalogError=true;
  $('#city-coverage').textContent=catalogError?'City list unavailable. Try reloading.':`${cities.length.toLocaleString()} U.S. cities`;
  if(!catalogError&&capabilities.status==='fulfilled'&&capabilities.value.forecastCityCount)$('#city-coverage').textContent=`${capabilities.value.forecastCityCount.toLocaleString()} city forecasts`;
  $('#suggested-areas').replaceChildren();
  for(const geoid of ['2507000','1714000','4805000']){const city=cities.find(c=>c.geoid===geoid);if(city)$('#suggested-areas').append(regionButton(city));}
  if(!cities.length)$('#suggested-areas').textContent=regions.length?'The city list is temporarily unavailable. Search for a state.':'Places could not load. Reload to try again.';
  syncCityMarkers();
  syncStateLabels();
  workspace.refreshCityList();
  if($('#area-search').value)renderSearch();
  const params=new URLSearchParams(location.search),requestedCity=params.get('city'),requestedRegion=params.get('area');
  const found=requestedCity?cities.find(c=>c.geoid===requestedCity):regions.find(r=>r.id===requestedRegion);
  if(found)selectArea(found,{focus:false});
}

function switchTab(name) {
  document.querySelectorAll('[data-tab]').forEach(button => {
    const active = button.dataset.tab === name;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  });
  $('#overview-tab').hidden = name !== 'overview'; $('#context-tab').hidden = name !== 'context';
}
document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'context' : button.dataset.tab === 'overview' ? 'context' : 'overview';
    switchTab(next); $(`[data-tab="${next}"]`).focus();
  });
});

async function selectArea(region, { navigate = true, focus = true } = {}) {
  if(region?.countryCode!=='US')return;
  cancelChatResearch();
  if (mapReady && selectedArea) map.setFeatureState({ source: areaSource(selectedArea), id: selectedArea.id }, { selected: false });
  selectedArea = region;
  syncChatContext(true);
  selectedComparison=null;
  workspace.setPanelExpanded(true);
  $('#welcome-panel').hidden = true; $('#selected-panel').hidden = false;
  $('#area-name').textContent = region.name; $('#area-country').textContent = isCity(region) ? region.stateName : region.country;
  $('#area-kind').textContent = isCity(region) ? '' : `${region.type || 'Region'} · Choose a supported city`;
  $('.area-sidebar').scrollTop = 0;
  switchTab('overview');
  $('#city-overview').hidden=!isCity(region);$('#region-overview').hidden=isCity(region);
  $('#city-context').hidden=!isCity(region);$('#region-context').hidden=isCity(region);
  $('#retry-city-data').hidden=true;
  if(isCity(region)){
    $('#comparison-city').textContent=region.name;
    $('#comparison-location').textContent=`${region.stateName} · Four-year crime outlook`;
    $('#city-state').textContent=region.stateName;
    $('#city-population').textContent=region.basePopulation.toLocaleString('en-US');
    $('#city-land-area').textContent=`${region.landAreaSqMi.toLocaleString('en-US',{maximumFractionDigits:1})} sq mi`;
    renderCrimeComparison($('#city-comparison'),emptyComparison(region.geoid),region.name,{loading:true});
    $('#city-result-summary').textContent='Loading this city’s outlook…';
  }else{
    const covered=region.countryCode==='US'?cities.filter(c=>c.stateName===region.name):[];
    $('#region-coverage').textContent=covered.length?`${covered.length} supported ${covered.length===1?'city':'cities'} in ${region.name}. Select one for its national, current, and four-year comparison.`:'This region has no cities in the supplied coverage list. Search for a supported US city above.';
    $('#region-cities').replaceChildren(...covered.map(city=>regionButton(city)));
  }
  $('#news-search-link').hidden=!isCity(region);$('#home-quiz-link').hidden=!isCity(region);
  if (mapReady) {
    map.setFeatureState({ source: areaSource(region), id: region.id }, { selected: true });
    if (navigate) focusArea(region);
  }
  updateSelectionUrl();
  if(focus) {
    $('#area-name').focus({preventScroll:true});
    if(innerWidth<=1000) $('.area-sidebar').scrollIntoView({behavior:'instant',block:'start'});
  }
  if(isCity(region)) workspace.openDialog('comparison-dialog',$('#open-comparison'));
  announce(`${region.name}, ${isCity(region)?region.stateName:region.country} selected. Its crime outlook and data coverage are available in the place panel.`);
  await loadComparison();
}
function updateSelectionUrl(){
  const url=new URL(location.href);url.searchParams.delete('area');url.searchParams.delete('city');url.searchParams.delete('metric');
  if(selectedArea){url.searchParams.set(isCity(selectedArea)?'city':'area',isCity(selectedArea)?selectedArea.geoid:selectedArea.id);if(isCity(selectedArea))url.searchParams.set('metric',selectedMetric);}
  history.replaceState(null,'',url);
}
async function loadComparison(){
  const region=selectedArea;if(!region)return;
  selectedRequest?.abort(); selectedRequest = new AbortController();selectedComparison=null;
  const request=selectedRequest;
  $('#retry-city-data').hidden=true;
  if(isCity(region))renderCrimeComparison($('#city-comparison'),emptyComparison(region.geoid),region.name,{loading:true});
  try {
    if(isCity(region)){
      const comparison=await areaDataProvider.getCityComparison(region.geoid,{metric:selectedMetric,signal:request.signal});
      if(!request.signal.aborted&&selectedArea?.id===region.id){selectedComparison=comparison;renderCrimeComparison($('#city-comparison'),comparison,region.name);$('#city-result-summary').textContent=comparison.status==='ready'?'':comparison.status==='partial'?'Some rates are unavailable.':'No forecast available.';announce(`${region.name}: ${comparison.metric.label} comparison ${comparison.status==='ready'?'loaded':'unavailable'}.`);}
    }else await areaDataProvider.getAreaSummary(region.id,{signal:request.signal});
  }catch(error){if(error.name!=='AbortError'&&!request.signal.aborted&&selectedArea?.id===region.id){
    if(isCity(region)){renderCrimeComparison($('#city-comparison'),emptyComparison(region.geoid),region.name,{error});$('#retry-city-data').hidden=false;$('#city-result-summary').textContent='The data could not be loaded. Open the comparison to retry.';}
    announce('Crime data is temporarily unavailable. You can still explore the map.');
  }}
}
$('#retry-city-data').addEventListener('click',loadComparison);
document.querySelectorAll('[name="crime-metric"]').forEach(input=>input.addEventListener('change',()=>{if(!input.checked)return;cancelChatResearch();selectedMetric=input.value;syncChatContext(true);updateSelectionUrl();loadComparison();}));

function focusArea(region) {
  if (!map) return;
  if(isCity(region)){map.easeTo({center:[region.longitude,region.latitude],padding:mapPadding(),zoom:9,duration:motion()});return;}
  const b = region.bbox;
  if (b && b[2]-b[0] < 180) {
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding:mapPadding(), maxZoom:8, duration:motion() });
  } else map.easeTo({ center: [region.longitude, region.latitude], zoom: 4, duration: motion() });
}

function clearSelection() {
  cancelChatResearch();
  if (selectedArea && mapReady) map.setFeatureState({ source: areaSource(selectedArea), id: selectedArea.id }, { selected: false });
  selectedRequest?.abort(); selectedArea = null;selectedComparison=null;
  syncChatContext(true);
  $('#area-search').value = '';
  $('#selected-panel').hidden = true; $('#welcome-panel').hidden = false;
  const url = new URL(location.href); url.searchParams.delete('area');url.searchParams.delete('city');url.searchParams.delete('metric'); history.replaceState(null, '', url);
  announce('Selection cleared. Choose another region.');
  $('#area-search').focus({preventScroll:true});
  if(innerWidth<=1000) window.scrollTo({top:0,behavior:'instant'});
}
$('#clear-selection').addEventListener('click', clearSelection);

function renderSearch() {
  const query = normalize($('#area-search').value.trim());
  const results = $('#search-results'); results.replaceChildren(); results.hidden = false;
  if (!regions.length && !cities.length) {
    const p = document.createElement('p'); p.className = 'search-empty'; p.textContent = regionIndexError&&catalogError ? 'Places could not load. Reload to try again.' : 'Loading places…'; results.append(p); return;
  }
  let matches;
  if (query) {
    const words=query.split(' ');
    const cityMatches=cities.filter(c=>words.every(word=>normalize(`${c.name} ${c.sourceName} ${c.stateName} ${c.stateAbbr} ${c.geoid}`).includes(word)));
    const regionMatches=regions.filter(r=>words.every(word=>normalize(`${r.name} ${r.country}`).includes(word)));
    const sort=(a,b)=>Number(normalize(b.name).startsWith(query))-Number(normalize(a.name).startsWith(query))||a.name.localeCompare(b.name)||(a.stateAbbr??'').localeCompare(b.stateAbbr??'');
    const exactCities=cityMatches.filter(c=>normalize(c.name)===query);
    const exactRegions=regionMatches.filter(r=>normalize(r.name)===query);
    matches=[...exactCities.sort(sort),...exactRegions.sort(sort),...cityMatches.filter(c=>!exactCities.includes(c)).sort(sort),...regionMatches.filter(r=>!exactRegions.includes(r)).sort(sort)];
  } else matches=['2507000','1714000','4805000','3651000','0644000'].map(id=>cities.find(c=>c.geoid===id)).filter(Boolean);
  matches.slice(0, 12).forEach(r => results.append(regionButton(r, 'search-result')));
  if (!matches.length) {
    const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = 'No matching places. Try a city with its state, such as Springfield MA.'; results.append(empty);
  } else {
    const footer = document.createElement('div'); footer.className = 'search-footer'; footer.textContent = query ? `${matches.length.toLocaleString()} matching ${matches.length === 1 ? 'place' : 'places'}${matches.length > 12 ? ' · showing the first 12' : ''}` : `${cities.length} supported US cities · Add a state to narrow your search`; results.append(footer);
  }
  workspace.announceSearch(`${matches.length} matching places. ${matches.length?'Press down arrow to explore results.':'Try adding a city or state name.'}`);
}
function closeSearch() { $('#search-results').hidden = true; workspace.announceSearch(''); }
$('#area-search').addEventListener('input', renderSearch);
$('#area-search').addEventListener('focus', renderSearch);
$('#area-search').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); if(!$('#search-results').hidden)$('#search-results .search-result')?.click(); }
  if (event.key === 'ArrowDown') { event.preventDefault(); if($('#search-results').hidden)renderSearch(); $('#search-results .search-result')?.focus(); }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); }
});
$('#search-results').addEventListener('keydown', event => {
  const buttons = [...$('#search-results').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
  if (event.key === 'Escape') { $('#area-search').focus(); closeSearch(); }
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('.search-wrap')) closeSearch(); });
document.addEventListener('focusin', event => { if (!event.target.closest('.search-wrap')) closeSearch(); });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !document.querySelector('dialog[open]') && $('#chat-panel').hidden) { event.preventDefault(); $('#area-search').focus(); }
});

async function initializeMap() {
  if (!window.maplibregl) { $('#map-loading').hidden = true; $('#map-error').hidden = false; return; }
  try {
    const response = await fetch('./assets/basemap.json');
    if (!response.ok) throw new Error('Map style unavailable');
    const basemap = await response.json();
    map = new maplibregl.Map({ container: 'map', ...initialView, padding:mapPadding(), minZoom: 1.25, maxZoom: 12, renderWorldCopies: false, attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, style: {
      version: 8,
      glyphs: basemap.glyphs,
      sprite: basemap.sprite,
      sources: {
        ...basemap.sources,
        countries: { type: 'geojson', data: './data/countries.geojson' },
        'state-labels': { type:'geojson', data:stateLabelFeatures(regions, initialView.zoom) },
        cities: { type:'geojson', data:cityFeatures(), promoteId:'id' },
        regions: { type: 'geojson', data: './data/regions.geojson', promoteId: 'id', tolerance: .6 }
      },
      layers: [
        { id: 'gaurd-water', type: 'background', paint: { 'background-color': '#e4f0fa' } },
        { id: 'gaurd-land', type: 'fill', source: 'countries', paint: { 'fill-color': '#fbfcfd', 'fill-outline-color': '#fbfcfd' } },
        ...regionalBasemapLayers(basemap.layers),
        { id: 'region-fill', type: 'fill', source: 'regions', filter: ['==', ['get','countryCode'], 'US'], paint: { 'fill-color': ['case', ['boolean',['feature-state','selected'],false], '#79aacf', '#bdd5e8'], 'fill-opacity': ['case', ['boolean',['feature-state','selected'],false], .36, ['boolean',['feature-state','hover'],false], .19, 0] } },
        { id: 'region-lines', type: 'line', source: 'regions', maxzoom:7, paint: { 'line-color': '#6f899f', 'line-opacity':1, 'line-width': ['interpolate',['linear'],['zoom'],1,.35,5,.7,9,1.15] } },
        { id: 'region-active', type: 'line', source: 'regions', filter: ['==', ['get','countryCode'], 'US'], paint: { 'line-color': '#3f6f96', 'line-width': ['case',['boolean',['feature-state','selected'],false],2,['boolean',['feature-state','hover'],false],1.3,0], 'line-opacity': .9 } },
        stateLabelsLayer,
        { id:'city-points',type:'circle',source:'cities',minzoom:5,paint:{'circle-radius':['case',['boolean',['feature-state','selected'],false],8,4.5],'circle-color':['case',['boolean',['feature-state','selected'],false],'#3f6f96','#b6d5eb'],'circle-stroke-color':'#376889','circle-stroke-width':1.5}},
      ]
    }});
    map.touchZoomRotate.disableRotation();
    // Map is a dedicated desktop workspace; on mobile, preserve page scrolling.
    if (matchMedia('(max-width: 1000px)').matches) map.cooperativeGestures.enable();
    map.getCanvas().setAttribute('aria-label','Interactive map. Use arrow keys to pan, plus and minus to zoom. City search and the city list offer alternatives to the map.');
    map.on('style.load',syncCityMarkers);
    map.on('style.load',syncStateLabels);
    map.on('zoomend',syncStateLabels);
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });
    let popupTimer, popupDismissed = false, hoveredCityId = null;
    const dismissPopupSoon = () => { clearTimeout(popupTimer); popupTimer = setTimeout(() => popup.remove(), 500); };
    function showMapPopup(coordinates, content) {
      if(popupDismissed)return;
      clearTimeout(popupTimer);
      popup.setLngLat(coordinates).setDOMContent(content).addTo(map);
      const element=popup.getElement();
      containPopupScroll(element);
      element.onmouseenter=()=>clearTimeout(popupTimer);
      element.onmouseleave=dismissPopupSoon;
    }
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){popupDismissed=true;popup.remove();}});
    map.on('mousemove', 'region-fill', event => {
      if (!mapReady || !event.features?.length) return;
      if(map.queryRenderedFeatures(event.point,{layers:['city-points']}).length)return;
      const feature = event.features[0];
      const changed = hoveredId !== feature.id;
      if (changed) {
        if (hoveredId) map.setFeatureState({source:'regions',id:hoveredId},{hover:false});
        hoveredId = feature.id; map.setFeatureState({source:'regions',id:hoveredId},{hover:true});
        popupDismissed = false;
      }
      map.getCanvas().style.cursor = 'pointer';

    });
    map.on('mouseleave', 'region-fill', () => {
      if (hoveredId) map.setFeatureState({source:'regions',id:hoveredId},{hover:false});
      hoveredId = null; dismissPopupSoon(); map.getCanvas().style.cursor = '';
    });
    map.on('click', 'region-fill', event => {
      if (!event.features?.length) return;
      if(map.queryRenderedFeatures(event.point,{layers:['city-points']}).length)return;
      const properties = event.features[0].properties;
      const region = regions.find(r => r.id === properties.id);
      if (region) { popup.remove(); selectArea(region); }
    });
    map.on('click','city-points',event=>{
      const city=cities.find(c=>c.geoid===event.features?.[0]?.properties.geoid);
      if(city){popup.remove();selectArea(city);}
    });
    map.on('mousemove','city-points',event=>{
      const feature=event.features?.[0];if(!feature)return;map.getCanvas().style.cursor='pointer';
      if(hoveredCityId!==feature.properties.geoid){hoveredCityId=feature.properties.geoid;popupDismissed=false;}
      const content=document.createElement('div');content.textContent=`${feature.properties.name}, ${feature.properties.stateAbbr}`;
      const caption=document.createElement('div');caption.className='hover-country';caption.textContent='Open city comparison';content.append(caption);
      showMapPopup(feature.geometry.coordinates,content);
    });
    for(const layer of ['city-points']){
      map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',layer,()=>{hoveredCityId=null;dismissPopupSoon();map.getCanvas().style.cursor='';});
    }
    map.on('sourcedata', event => {
      if (!mapReady && event.sourceId === 'regions' && map.isSourceLoaded('regions')) {
        mapReady = true; $('#map-loading').hidden = true;
        if (selectedArea) { map.setFeatureState({source:areaSource(selectedArea),id:selectedArea.id},{selected:true}); focusArea(selectedArea); }
      }
    });
    let offlineNotified = false;
    map.on('error', event => {
      if (event.sourceId === 'openmaptiles') {
        if (!offlineNotified) { announce('Background tiles are unavailable. The regional boundary map remains available.'); offlineNotified = true; }
      } else if (event.sourceId === 'regions' || event.sourceId === 'countries') {
        $('#map-error').hidden = false; $('#map-loading').hidden = true;
      } else if (!offlineNotified) {
        announce('Some background labels are unavailable. The regional boundary map remains available.'); offlineNotified = true;
      }
    });
    map.on('moveend', () => popup.remove());
    map.on('load', () => { $('#map-loading').hidden = true;syncCityMarkers(); });
  } catch { $('#map-loading').hidden = true; $('#map-error').hidden = false; }
}
$('#reset-map').addEventListener('click', () => { map?.easeTo({ ...initialView, padding:mapPadding(), bearing:0, pitch:0, duration:motion() }); announce('Map returned to the overview.'); });
$('#zoom-in').addEventListener('click', () => map?.zoomIn({ duration: motion()/2 }));
$('#zoom-out').addEventListener('click', () => map?.zoomOut({ duration: motion()/2 }));
$('#retry-map').addEventListener('click', () => location.reload());

let chatOpened = false, chatTrigger, aiConfigured=false, chatRequest, pendingChatMessage, chatHistory=[];
function cancelChatResearch(){
  chatRequest?.abort();chatRequest=null;
  if(pendingChatMessage){pendingChatMessage.textContent='Response stopped.';pendingChatMessage.removeAttribute('aria-busy');pendingChatMessage=null;}
}
function checkAIConnection(){return aiStatus().then(status=>{aiConfigured=status.configured;$('#ai-connection-status').textContent=aiConfigured?'City data & local news':'Data guide · Gemma not connected';}).catch(()=>{aiConfigured=false;$('#ai-connection-status').textContent='Gemma unavailable';});}
const connectionReady=checkAIConnection();
function chatGreeting(){return isCity(selectedArea)?`I can explain ${selectedArea.name}’s numbers, compare another city, or check local news. What would you like to know?`:'I can explain crime data, compare cities, or check local news. Tell me a city and state to get started.';}
function syncChatContext(reset=false){
  const city=isCity(selectedArea);
  $('#chat-context').textContent=city?`${selectedArea.name}, ${selectedArea.stateAbbr} · ${metricDefinitions[selectedMetric].label}`:'Ask about a U.S. city';
  const suggestions=city?[['Explain this city’s crime outlook in simple terms.','Explain chart'],['What does recent local news say about this city?','Local news'],['How accurate are these forecasts?','Model accuracy']]:[['How can you help me explore cities?','Get started'],['How do I compare two cities?','Compare cities'],['How accurate are the forecasts?','Model accuracy']];
  document.querySelectorAll('.chat-suggestions [data-question]').forEach((button,index)=>{button.dataset.question=suggestions[index][0];button.textContent=suggestions[index][1];});
  if(reset){chatHistory=[];if(chatOpened){$('#chat-messages').replaceChildren();addChatMessage(chatGreeting());}}
}
function addChatMessage(text, role = 'assistant') {
  const message = document.createElement('p'); message.className = `chat-message ${role}`; message.textContent = text; $('#chat-messages').append(message); $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}
function toggleChat(open) {
  if(!open)cancelChatResearch();
  if(open && $('#chat-panel').hidden) chatTrigger = document.activeElement;
  if(open) $('.pan-controls').open=false;
  $('#chat-panel').hidden = !open; $('#companion-toggle').setAttribute('aria-expanded', String(open));
  $('#companion-toggle').setAttribute('aria-label', open ? 'Close Gemma companion' : 'Open Gemma companion');
  document.body.classList.toggle('chat-open',open);
  if (open && !chatOpened) { addChatMessage(chatGreeting()); chatOpened = true; }
  syncChatModality();
  if(open) $('#chat-input').focus(); else (chatTrigger?.checkVisibility()?chatTrigger:$('#companion-toggle')).focus({preventScroll:true});
}
function syncChatModality() {
  const modal = !$('#chat-panel').hidden && (innerWidth<=1000 || innerHeight<=600);
  $('#chat-panel').setAttribute('aria-modal',String(modal));
  $('#chat-scrim').hidden = !modal;
  document.documentElement.classList.toggle('chat-modal',modal);
  for(const selector of ['.app-header','#explorer','.companion-dock']) $(selector).inert = modal;
}
window.addEventListener('resize',syncChatModality);
$('#chat-panel').addEventListener('keydown',event=>{
  if(event.key!=='Tab'||$('#chat-panel').getAttribute('aria-modal')!=='true')return;
  const controls=[...$('#chat-panel').querySelectorAll('button,input,a[href],[tabindex="0"],iframe')].filter(el=>el.checkVisibility()),first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
$('#companion-toggle').addEventListener('click', () => toggleChat($('#chat-panel').hidden));
$('#close-chat').addEventListener('click', () => toggleChat(false));
$('#chat-scrim').addEventListener('click',()=>toggleChat(false));
$('#ask-area').addEventListener('click', () => {
  toggleChat(true);
  if (selectedArea) replyToQuestion(isCity(selectedArea)?'Explain this city’s crime outlook in simple terms.':`Which cities can I explore in ${selectedArea.name}?`);
});
$('#ask-comparison').addEventListener('click',()=>{
  const dialog=$('#comparison-dialog');
  dialog.addEventListener('close',()=>{toggleChat(true);replyToQuestion('Explain this city’s crime outlook in simple terms.');},{once:true});
  dialog.close('open-guide');
});
async function replyToQuestion(question) {
  cancelChatResearch();
  addChatMessage(question, 'user');
  const request=new AbortController();chatRequest=request;
  const message=document.createElement('div');message.className='chat-message assistant';message.textContent='Gemma is thinking…';message.setAttribute('aria-busy','true');pendingChatMessage=message;$('#chat-messages').append(message);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
  try{
    await connectionReady;if(!aiConfigured&&!request.signal.aborted)await checkAIConnection();if(request.signal.aborted)return;
    if(!aiConfigured){message.textContent=guideReply(question,{comparison:selectedComparison,cityName:isCity(selectedArea)?`${selectedArea.name}, ${selectedArea.stateAbbr}`:undefined});return;}
    const review=await requestGemma({geoid:isCity(selectedArea)?selectedArea.geoid:undefined,metric:selectedMetric,question,history:chatHistory},{signal:request.signal,chat:true});
    if(!request.signal.aborted){
      renderReview(message,review,{onCitySelect:city=>{const area=cities.find(item=>item.geoid===city.geoid);if(area){toggleChat(false);selectArea(area);}}});
      chatHistory=[...chatHistory,{role:'user',text:question},{role:'assistant',text:answerText(review)}].slice(-8);
      message.scrollIntoView({behavior:'instant',block:'nearest'});
    }
  }
  catch(error){if(error.name!=='AbortError'){message.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.className='text-button chat-retry';retry.textContent='Try again';retry.addEventListener('click',()=>replyToQuestion(question));message.append(retry);}}
  finally{message.removeAttribute('aria-busy');if(chatRequest===request){chatRequest=null;pendingChatMessage=null;}}
}
let reviewRequest;
let lastResearchAction=null;
async function openResearch({question,note}={}){
 lastResearchAction=()=>openResearch({question,note});
 if(!isCity(selectedArea))return;
 reviewRequest?.abort();const request=new AbortController();reviewRequest=request;
 $('#research-city').textContent=`${selectedArea.name}, ${selectedArea.stateAbbr}`;$('#research-eyebrow').textContent='Local news';$('#research-note').textContent=note??'';$('#research-note').hidden=!note;
 $('#research-content').replaceChildren();$('#research-status').textContent='Researching recent coverage…';$('#retry-research').hidden=true;
 workspace.openDialog('research-dialog');
 try{const review=await requestGemma({geoid:selectedArea.geoid,metric:selectedMetric,...(question?{question}:{})},{signal:request.signal});if(!request.signal.aborted){$('#research-status').textContent='';renderReview($('#research-content'),review);$('#retry-research').hidden=review.status!=='unverified';}}
 catch(error){if(error.name!=='AbortError'){$('#research-status').textContent=error.message;$('#retry-research').hidden=false;}}
}
$('#news-search-link').addEventListener('click',()=>openResearch());
$('#retry-research').addEventListener('click',()=>lastResearchAction?.());
$('#research-dialog').addEventListener('close',()=>reviewRequest?.abort());
$('#research-comparison').addEventListener('click',()=>{const dialog=$('#comparison-dialog');dialog.addEventListener('close',()=>openResearch(),{once:true});dialog.close('open-review');});
function openHomeQuiz(opener){if(isCity(selectedArea))workspace.openDialog('home-quiz-dialog',opener);}
$('#home-quiz-link').addEventListener('click',event=>openHomeQuiz(event.currentTarget));
$('#home-quiz-comparison').addEventListener('click',()=>{const dialog=$('#comparison-dialog');dialog.addEventListener('close',()=>openHomeQuiz($('#home-quiz-link')),{once:true});dialog.close('open-quiz');});
async function openHomeMatch(answers){
 if(!isCity(selectedArea))return;
 reviewRequest?.abort();const request=new AbortController();reviewRequest=request;lastResearchAction=()=>openHomeMatch(answers);
 $('#research-eyebrow').textContent='Home match';$('#research-city').textContent=`${selectedArea.name}, ${selectedArea.stateAbbr}`;
 $('#research-note').textContent=`Asked about ${describeHomeProfile(answers)}.`;$('#research-note').hidden=false;
 $('#research-content').replaceChildren();$('#research-status').textContent='Searching current listings…';$('#retry-research').hidden=true;
 workspace.openDialog('research-dialog');
 try{const result=await requestHomeMatch({geoid:selectedArea.geoid,answers},{signal:request.signal});if(!request.signal.aborted){$('#research-status').textContent='';renderHomeMatch($('#research-content'),result);$('#retry-research').hidden=result.status!=='unverified';}}
 catch(error){if(error.name!=='AbortError'){$('#research-status').textContent=error.message;$('#retry-research').hidden=false;}}
}
setupHomeQuiz($('#home-quiz-form'),answers=>{$('#home-quiz-dialog').close('quiz-submitted');openHomeMatch(answers);});
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); const question = $('#chat-input').value.trim(); if (!question) return; $('#chat-input').value = ''; replyToQuestion(question); });
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => replyToQuestion(button.dataset.question)));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#chat-panel').hidden && !document.querySelector('dialog[open]')) toggleChat(false); });

document.addEventListener('click', event => {
  const opener = event.target.closest('[data-dialog]');
  if (opener) workspace.openDialog(opener.dataset.dialog,opener);
  const closer = event.target.closest('[data-close]');
  if (closer) closer.closest('dialog').close();
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const b=dialog.getBoundingClientRect(); if (event.clientX<b.left || event.clientX>b.right || event.clientY<b.top || event.clientY>b.bottom) dialog.close(); } }));

const workspace = initializeWorkspace({
  getCities:()=>cities,
  getCityStatus:()=>catalogError?'error':cities.length?'ready':'loading',
  chooseCity:city=>{selectArea(city);closeSearch();},
  panMap:offset=>map?.panBy(offset,{duration:motion()/2}),
  layoutChanged:()=>{
    if(!map)return;
    map.resize();map.setPadding(mapPadding());
    if(innerWidth<=1000)map.cooperativeGestures.enable();else map.cooperativeGestures.disable();
  },
});
loadIndex();
initializeMap();
// Expose view state, not mutable map/provider internals, for integration and QA.
window.gaurd = { getState: () => ({ selectedArea:selectedArea?.id??null,selectedGeoid:selectedArea?.geoid??null,metric:selectedMetric,comparisonStatus:selectedComparison?.status??null,mapReady,cityMarkersReady:!!map?.getSource('cities')&&map.isSourceLoaded('cities'),regionCount:regions.length,cityCount:cities.length,zoom:map?.getZoom(),center:map?.getCenter().toArray() }) };
