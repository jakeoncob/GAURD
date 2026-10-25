import fs from 'node:fs';

// Natural Earth is public domain. Keep identities separate from model geography.
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
function simplify(points, tolerance = 0.012) {
  if (points.length <= 5) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first], [bx, by] = points[last];
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    let furthest = -1, maximum = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      const t = length ? Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy)/length)) : 0;
      const distance = (px-ax-t*dx)**2 + (py-ay-t*dy)**2;
      if (distance > maximum) { maximum = distance; furthest = i; }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  const reduced = points.filter((_, i) => keep[i]);
  return (reduced.length >= 4 ? reduced : points).map(p => p.map(v => +v.toFixed(4)));
}
const features = source.features.filter(f => f.geometry && f.properties.name).map(f => {
  const p = f.properties;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const coordinates = polygons.map(polygon => polygon.map(ring => simplify(ring)));
  const flat = coordinates.flat(2);
  const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  return {
    type: 'Feature', id: p.adm1_code,
    properties: {
      id: p.adm1_code, name: p.name_en || p.name, country: p.admin,
      countryCode: p.iso_a2, type: p.type_en || p.type || 'Region',
      longitude: p.longitude, latitude: p.latitude,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    },
    geometry: { type: 'MultiPolygon', coordinates }
  };
});
fs.writeFileSync('dist/data/regions.geojson', JSON.stringify({type: 'FeatureCollection', features}));
fs.writeFileSync('dist/data/region-index.json', JSON.stringify(features.map(f => f.properties)));
console.log(`Prepared ${features.length} selectable regions.`);
