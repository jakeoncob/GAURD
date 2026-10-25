// Keep overview geography readable independently of the base map's place ranking.
const stateAbbreviations = {
  Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA',
  Colorado:'CO', Connecticut:'CT', Delaware:'DE', Florida:'FL', Georgia:'GA',
  Hawaii:'HI', Idaho:'ID', Illinois:'IL', Indiana:'IN', Iowa:'IA', Kansas:'KS',
  Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA',
  Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT',
  Nebraska:'NE', Nevada:'NV', 'New Hampshire':'NH', 'New Jersey':'NJ',
  'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC', 'North Dakota':'ND',
  Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI',
  'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX',
  Utah:'UT', Vermont:'VT', Virginia:'VA', Washington:'WA', 'West Virginia':'WV',
  Wisconsin:'WI', Wyoming:'WY',
};

const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));

export function stateLabelFeatures(regions, zoom) {
  const worldSize = 512 * 2 ** zoom;
  return {
    type:'FeatureCollection',
    features:regions.filter(region => region.countryCode === 'US').map(region => {
      const district = region.type === 'Federal District';
      const name = district ? 'District of Columbia' : region.name;
      const abbreviation = district ? 'DC' : stateAbbreviations[name];
      const lines = name.split(' ');
      // Compare the label's approximate pixel footprint with the state's footprint.
      // Leave breathing room around borders; narrow eastern states retain postal codes longer.
      const [west, south, east, north] = region.bbox;
      const width = (east - west) / 360 * worldSize * .68;
      const height = (mercatorY(north) - mercatorY(south)) / (2 * Math.PI) * worldSize * .65;
      const nameWidth = Math.max(...lines.map(line => line.length)) * 6.7 + 10;
      const nameHeight = lines.length * 14 + 8;
      const fits = zoom >= 3 && width >= nameWidth && height >= nameHeight;
      return {
        type:'Feature', id:region.id,
        properties:{id:region.id, name, abbreviation, label:fits ? lines.join('\n') : abbreviation},
        geometry:{type:'Point', coordinates:[region.longitude, region.latitude]},
      };
    }),
  };
}

export function regionalBasemapLayers(layers) {
  return layers.map(layer => {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      layer = {...layer, paint:{...layer.paint, 'text-color':'#000'}};
    }
    if (['label_city', 'label_city_capital', 'label_town'].includes(layer.id)) {
      return {...layer, minzoom:Math.max(layer.minzoom ?? 0, 7)};
    }
    if (layer.id.startsWith('label_country_')) return {...layer, maxzoom:3};
    if (layer.id === 'label_state') {
      // Our US labels already follow the displayed boundaries, so avoid duplicates.
      const name = ['coalesce', ['get','name_en'], ['get','name:latin'], ['get','name']];
      return {...layer, filter:['all', layer.filter, ['!', ['in', name, ['literal', Object.keys(stateAbbreviations)]]]]};
    }
    return layer;
  });
}

export const stateLabelsLayer = {
  id:'state-labels', type:'symbol', source:'state-labels', minzoom:2.5, maxzoom:7,
  layout:{
    'text-field':['get','label'], 'text-font':['Noto Sans Regular'], 'text-size':12,
    'text-line-height':1.15, 'text-letter-spacing':.025, 'text-max-width':12,
    'text-padding':3, 'text-variable-anchor':['center','top','bottom','left','right'],
    'text-radial-offset':.4,
  },
  paint:{'text-color':'#000', 'text-halo-color':'#ffffff', 'text-halo-width':2, 'text-halo-blur':.2},
};
