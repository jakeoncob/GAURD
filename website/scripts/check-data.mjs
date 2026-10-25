import fs from 'node:fs';
import assert from 'node:assert/strict';
const geo = JSON.parse(fs.readFileSync('web/data/regions.geojson'));
const index = JSON.parse(fs.readFileSync('web/data/region-index.json'));
assert.equal(geo.features.length, index.length);
assert.equal(new Set(index.map(r => r.id)).size, index.length, 'Area IDs must be unique');
for (const f of geo.features) {
  assert.ok(f.properties.name && f.properties.country);
  for (const polygon of f.geometry.coordinates) for (const ring of polygon) {
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1), 'Polygon rings must be closed');
    for (const p of ring) assert.ok(p.every(Number.isFinite));
  }
}
console.log(`Validated ${index.length} region identities and polygon geometries.`);
const catalog = JSON.parse(fs.readFileSync('web/data/city-catalog.json'));
assert.equal(catalog.count,catalog.cities.length);
assert.equal(new Set(catalog.cities.map(city=>city.geoid)).size,catalog.count);
for(const city of catalog.cities){
  assert.match(city.geoid,/^\d{7}$/);assert.equal(city.id,`city:${city.geoid}`);
  assert.ok(Number.isFinite(city.longitude)&&city.longitude>=-180&&city.longitude<=180);
  assert.ok(Number.isFinite(city.latitude)&&city.latitude>=-90&&city.latitude<=90);
  assert.ok(city.stateAbbr&&city.stateName&&city.sourceName);assert.ok(city.basePopulation>0);
  assert.equal(city.populationYear,null);
}
console.log(`Validated ${catalog.count} city identities, coordinates, and reference-population metadata.`);
