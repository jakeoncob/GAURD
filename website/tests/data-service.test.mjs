import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseCsv, buildCrimeData, parseTrainingSummary } from '../scripts/import-partner.mjs';
import { areaDataProvider } from '../web/data-service.js';
import { dataConfig } from '../web/config.js';

const originalFetch = globalThis.fetch;
const originalConfig = { ...dataConfig };
const productionData = JSON.parse(await fs.readFile(new URL('../web/data/city-crime.json', import.meta.url), 'utf8'));
const productionCatalog = JSON.parse(await fs.readFile(new URL('../web/data/city-catalog.json', import.meta.url), 'utf8'));

test('the saved site data is reproducible from the retained exports without overriding conflicting predictions',async()=>{
 const read=name=>fs.readFile(new URL(`../data-sources/partner/${name}`,import.meta.url));
 const names=['frontend_forecasts.csv','national_rates_by_year.csv','city_forecasts_vs_national.csv'];
 const inputs=await Promise.all(names.map(read));const training=await read('training_summary.json');
 const reportedValidation=parseTrainingSummary(JSON.parse(training.toString('utf8')));
 reportedValidation.sourceSha256=createHash('sha256').update(training).digest('hex');
 const reproduced=buildCrimeData({forecastsCsv:inputs[0].toString('utf8'),nationalCsv:inputs[1].toString('utf8'),comparisonsCsv:inputs[2].toString('utf8'),catalog:productionCatalog,reportedValidation,sourceFiles:inputs.map((bytes,i)=>({filename:`exports/${names[i]}`,sha256:createHash('sha256').update(bytes).digest('hex')}))});
 assert.equal(reproduced.provenance.comparisonPolicy,'strict_agreement');
 assert.equal(reproduced.provenance.staleComparisonForecastCount,0);
 assert.deepEqual(reproduced,productionData);
});

test('production static provider joins all 644 crime records to the same category and reporting-year national benchmark', async () => {
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(String(url));
    const allowed = {
      './data/city-crime.json': new URL('../web/data/city-crime.json', import.meta.url),
      './data/city-catalog.json': new URL('../web/data/city-catalog.json', import.meta.url),
    };
    assert.ok(allowed[String(url)], `Unexpected request during static integration test: ${url}`);
    return { ok: true, status: 200, json: async () => JSON.parse(await fs.readFile(allowed[String(url)], 'utf8')) };
  };
  Object.assign(dataConfig, originalConfig, { mode: 'static' });
  try {
    assert.equal(productionData.schemaVersion, 2);
    const capabilities = await areaDataProvider.getCapabilities();
    assert.equal(capabilities.connected, true);
    assert.equal(capabilities.forecastCityCount, 322);
    assert.equal(capabilities.unit, 'per100000');
    assert.deepEqual(capabilities.forecastHorizons, [4]);
    assert.deepEqual(Object.keys(capabilities.metrics).sort(), ['property', 'violent']);
    const catalog = await areaDataProvider.getCityCatalog();
    assert.equal(catalog.cities.length, 323);
    assert.deepEqual(catalog, productionCatalog);

    let tested = 0;
    const forecasts=parseCsv(await fs.readFile(new URL('../data-sources/partner/frontend_forecasts.csv',import.meta.url),'utf8'));
    const sourceById=new Map(forecasts.map(row=>[`${row.geoid}/${row.target}`,row]));
    for(const source of productionData.provenance.sourceFiles){
      const bytes=await fs.readFile(new URL(`../data-sources/partner/${source.filename.split('/').at(-1)}`,import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256,'Production provenance must match the retained supplied files');
    }
    const reported=productionData.provenance.reportedValidation;
    if(reported){
      const bytes=await fs.readFile(new URL(`../data-sources/partner/${reported.source.split('/').at(-1)}`,import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),reported.sourceSha256);
    }
    const baselines = new Set();
    for (const city of catalog.cities) {
      const supplied = productionData.cities[city.geoid];
      assert.ok(supplied, `Catalog city missing from production data: ${city.geoid}`);
      for (const metric of ['violent', 'property']) {
        const result = await areaDataProvider.getCityComparison(city.geoid, { metric });
        const record = supplied.metrics[metric];
        assert.equal(result.geoid, city.geoid);
        assert.equal(result.metric.id, metric);
        assert.equal(result.metric.label, productionData.metrics[metric].label);
        assert.equal(result.metric.definition, productionData.metrics[metric].definition);
        assert.equal(result.unit, 'per100000');
        if (!record) {
          assert.equal(city.geoid, '1571550', 'Only Honolulu should lack supplied metric records');
          assert.equal(result.status, 'pending');
          assert.equal(result.baselineYear, null);
          assert.equal(result.predictedYear, null);
          assert.deepEqual(result.series.map(series => series.value), [null, null, null]);
          assert.match(result.note, /No forecast was supplied/);
          continue;
        }
        const national = productionData.national[String(record.baselineYear)];
        const source=sourceById.get(`${city.geoid}/${metric}`);
        assert.ok(source,'Every displayed metric must come from the authoritative forecast CSV');
        assert.equal(record.currentRate,Number(source.current_rate_per_100k));
        assert.equal(record.predictedRate,Number(source.predicted_rate_per_100k),'Do not restore a stale prediction from the redundant comparison file');
        assert.equal(record.baselineYear,Number(source.as_of_year));
        assert.equal(record.predictedYear,Number(source.forecast_year));
        assert.equal(result.status, 'ready', `${city.geoid}/${metric} should have all three bars`);
        assert.equal(result.baselineYear, record.baselineYear);
        assert.equal(result.predictedYear, record.baselineYear + 4);
        assert.deepEqual(result.series.map(series => series.value), [national.rates[metric], record.currentRate, record.predictedRate]);
        assert.deepEqual(result.series.map(series => series.year), [record.baselineYear, record.baselineYear, record.predictedYear]);
        assert.ok(result.series.every(series => Number.isFinite(series.value) && series.value > 0), 'Missing records must not become zero bars');
        assert.equal(result.sources[0].year, record.baselineYear);
        assert.equal(result.note, record.note);
        assert.equal(result.modelVersion, record.modelVersion);
        assert.equal(result.provenance.validationAvailable, true);
        assert.deepEqual(result.warnings, []);
        baselines.add(record.baselineYear);
        tested++;
      }
    }
    assert.equal(tested, 644);
    assert.deepEqual([...baselines].sort(), [2019, 2020, 2021, 2022, 2023]);
    assert.equal(requests.filter(url => url === './data/city-crime.json').length, 1, 'The shared export should be loaded once');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(dataConfig, originalConfig);
  }
});

test('API provider requests the selected metric and horizon, preserves actual zero rates, and rejects mismatched responses', async () => {
  let payload = {
    geoid: '0107000', unit: 'per100000', metric: { id: 'property', label: 'Property crime' },
    baselineYear: 2023, nationalYear: 2023, nationalRate: 100,
    currentRate: 0, predictedYear: 2027, predictedRate: 0,
  };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => structuredClone(payload) };
  };
  Object.assign(dataConfig, { mode: 'api', apiBaseUrl: 'https://api.example.test/' });
  try {
    const signal = new AbortController().signal;
    const result = await areaDataProvider.getCityComparison('0107000', { metric: 'property', signal });
    assert.equal(requests[0].url, 'https://api.example.test/cities/0107000/crime-comparison?horizonYears=4&metric=property');
    assert.equal(requests[0].options.signal, signal);
    assert.equal(result.status, 'ready');
    assert.equal(result.metric.id, 'property');
    assert.deepEqual(result.series.map(series => series.value), [100, 0, 0]);

    payload.metric.id = 'violent';
    await assert.rejects(areaDataProvider.getCityComparison('0107000', { metric: 'property' }), /different crime category/);
    payload.metric.id = 'property';
    payload.geoid = '2507000';
    await assert.rejects(areaDataProvider.getCityComparison('0107000', { metric: 'property' }), /different city/);
    payload.geoid = '0107000';
    payload.unit = 'count';
    await assert.rejects(areaDataProvider.getCityComparison('0107000', { metric: 'property' }), /per 100,000/);

    payload.unit = 'per100000';
    payload.metric.id = 'violent';
    const defaultMetric = await areaDataProvider.getCityComparison('0107000');
    assert.equal(defaultMetric.metric.id, 'violent');
    assert.equal(requests.at(-1).url, 'https://api.example.test/cities/0107000/crime-comparison?horizonYears=4&metric=violent');
    const requestCount = requests.length;
    await assert.rejects(areaDataProvider.getCityComparison('107000'), /seven-digit/);
    await assert.rejects(areaDataProvider.getCityComparison('0107000', { metric: 'total' }), /Unsupported crime category/);
    assert.equal(requests.length, requestCount, 'Invalid identities or categories should not make network requests');
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(dataConfig, originalConfig);
  }
});
