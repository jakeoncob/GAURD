const $ = selector => document.querySelector(selector);
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let savedMotion = null;
try { savedMotion = localStorage.getItem('gaurd-reduced-motion'); } catch { /* Optional preference storage. */ }
document.body.dataset.reducedMotion = String(savedMotion === null ? motionPreference.matches : savedMotion === 'true');
export const reducedMotion = () => document.body.dataset.reducedMotion === 'true';
const headerBottom = () => $('.app-header').getBoundingClientRect().bottom + (innerWidth <= 1000 ? scrollY : 0);

export function mapPadding() {
  if (innerWidth <= 1000) return {top:Math.min(Math.max(0,headerBottom() + 16), innerHeight * .4), bottom:Math.min(innerHeight * .43, 300), left:20, right:20};
  const panel = $('.area-sidebar').getBoundingClientRect();
  return {top:Math.min(112,innerHeight*.3), bottom:Math.min(88,innerHeight*.25), left:$('#panel-content').hidden ? 72 : panel.right + 28, right:112};
}

export function initializeWorkspace({getCities, getCityStatus, chooseCity, panMap, layoutChanged}) {
  const dialogOpeners = new WeakMap();
  let searchNotice;

  function setPanelExpanded(expanded) {
    $('#panel-content').hidden = !expanded;
    $('#panel-toggle').setAttribute('aria-expanded', String(expanded));
    $('#panel-toggle').setAttribute('aria-label', expanded ? 'Minimize place panel' : 'Expand place panel');
    $('#panel-toggle span').textContent = expanded ? '−' : '+';
    document.body.classList.toggle('panel-collapsed', !expanded);
    layoutChanged();
  }
  $('#panel-toggle').addEventListener('click', () => setPanelExpanded($('#panel-content').hidden));

  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  function refreshCityList() {
    const words = normalize($('#city-list-search').value).split(' ').filter(Boolean);
    const cities = getCities();
    const matches = cities.filter(city => words.every(word => normalize(`${city.name} ${city.stateName} ${city.stateAbbr}`).includes(word)))
      .sort((a,b) => a.name.localeCompare(b.name) || a.stateAbbr.localeCompare(b.stateAbbr));
    $('#city-list-status').textContent = getCityStatus() === 'loading' ? 'Loading the city list…' : getCityStatus() === 'error' ? 'The city list could not load. Please reload to try again.' : `${matches.length} of ${cities.length} supported cities${words.length ? ' match your search' : ''}.`;
    const fragment = document.createDocumentFragment();
    matches.forEach(city => {
      const button = document.createElement('button'); button.className = 'suggested-area'; button.dataset.geoid = city.geoid;
      const mark = document.createElement('span'); mark.className = 'city-initial'; mark.textContent = city.stateAbbr; mark.ariaHidden = 'true';
      const copy = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = city.name;
      const state = document.createElement('small'); state.textContent = `${city.stateName} · ${city.stateAbbr}`;
      const arrow = document.createElement('span'); arrow.className = 'row-arrow'; arrow.textContent = '↗'; arrow.ariaHidden = 'true';
      copy.append(name,state); button.append(mark,copy,arrow);
      button.addEventListener('click', () => { $('#cities-dialog').close('city-selected'); chooseCity(city); });
      fragment.append(button);
    });
    $('#city-list').replaceChildren(fragment);
  }
  $('#city-list-search').addEventListener('input', refreshCityList);

  function openDialog(id, opener = document.activeElement) {
    const dialog = $(`#${id}`);
    if (!dialog || dialog.open) return;
    dialog.returnValue = '';
    dialogOpeners.set(dialog, opener);
    if (id === 'cities-dialog') refreshCityList();
    dialog.showModal();
    (id === 'cities-dialog' ? $('#city-list-search') : dialog.querySelector('h2')).focus({preventScroll:true});
  }
  document.querySelectorAll('dialog').forEach(dialog => {
    const heading = dialog.querySelector('h2');
    if (!heading.id) heading.id = `${dialog.id}-title`;
    heading.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'city-selected' || dialog.returnValue === 'open-city-list') return;
      const opener = dialogOpeners.get(dialog);
      if (opener?.checkVisibility()) opener.focus({preventScroll:true});
    });
  });
  $('#open-city-list').addEventListener('click', () => {
    $('#display-dialog').close('open-city-list');
    openDialog('cities-dialog', $('[data-dialog="cities-dialog"]'));
  });

  function refreshMotionControl() {
    const reduced = reducedMotion();
    $('#motion-toggle').setAttribute('aria-pressed', String(reduced));
    $('#motion-toggle').setAttribute('aria-label', `Reduce motion: ${reduced ? 'on' : 'off'}`);
    $('#motion-toggle').textContent = reduced ? 'On' : 'Off';
  }
  refreshMotionControl();
  $('#motion-toggle').addEventListener('click', () => {
    document.body.dataset.reducedMotion = String(!reducedMotion());
    try { localStorage.setItem('gaurd-reduced-motion', String(reducedMotion())); } catch { /* The control still works without storage. */ }
    savedMotion = String(reducedMotion());
    $('#motion-description').textContent = reducedMotion() ? 'Reduced motion is on. Map transitions are paused.' : 'Motion is on. You can turn reduced motion on at any time.';
    refreshMotionControl();
  });
  motionPreference.addEventListener('change', () => {
    if (savedMotion !== null) return;
    document.body.dataset.reducedMotion = String(motionPreference.matches); refreshMotionControl();
  });

  document.querySelectorAll('[data-pan]').forEach(button => button.addEventListener('click', () => {
    const distance = Math.min(innerWidth, innerHeight) * .22;
    const offsets = {north:[0,-distance],south:[0,distance],west:[-distance,0],east:[distance,0]};
    panMap(offsets[button.dataset.pan]);
  }));
  function closePanControls() {
    const details = $('.pan-controls');
    if (!details.open) return;
    if (details.contains(document.activeElement)) details.querySelector('summary').focus();
    details.open = false;
  }
  document.addEventListener('pointerdown', event => { if (!event.target.closest('.pan-controls')) closePanControls(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanControls(); });
  function resizeWorkspace() {
    document.documentElement.style.setProperty('--header-bottom', `${headerBottom()}px`);
    document.documentElement.style.setProperty('--footer-height', `${$('.page-footer').getBoundingClientRect().height}px`);
    layoutChanged();
  }
  window.addEventListener('resize', resizeWorkspace);
  new ResizeObserver(resizeWorkspace).observe($('.app-header'));
  new ResizeObserver(resizeWorkspace).observe($('.page-footer'));
  $('.search-box kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  resizeWorkspace();

  return {
    setPanelExpanded, openDialog, refreshCityList,
    announceSearch(message) { clearTimeout(searchNotice); searchNotice = setTimeout(() => { $('#search-status').textContent = message; }, 200); },
  };
}
