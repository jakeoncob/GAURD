import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildCrimeData, importPartnerDirectory, parseCsv, parseReportedValidation, parseTrainingSummary } from '../scripts/import-partner.mjs';

const catalog = { cities: [
  { geoid: '0107000', name: 'Birmingham', sourceName: 'Birmingham city', stateAbbr: 'AL' },
  { geoid: '1571550', name: 'Honolulu', sourceName: 'Urban Honolulu CDP', stateAbbr: 'HI' },
] };
const csv = rows => {
  const headers = Object.keys(rows[0]);
  const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${headers.map(cell).join(',')}\r\n${rows.map(row => headers.map(key => cell(row[key])).join(',')).join('\r\n')}\r\n`;
};
function fixture() {
  const forecasts = ['violent', 'property'].map(target => ({
    geoid: '0107000', city: 'Birmingham city', state: 'AL', target,
    as_of_year: '2020', forecast_year: '2024',
    current_rate_per_100k: target === 'violent' ? '0' : '',
    predicted_rate_per_100k: target === 'violent' ? '25.5' : 'null',
    note: 'Older baseline, with a "quoted" caveat.\nKeep the actual year.',
  }));
  const national = [
    { year: '2020', national_violent_rate_per_100k: '50', national_property_rate_per_100k: '100' },
    { year: '2024', national_violent_rate_per_100k: '40', national_property_rate_per_100k: '90' },
  ];
  const comparisons = [{
    geoid: '0107000', city: 'Birmingham city', state: 'AL',
    violent_as_of_year: '2020', violent_current_rate_per_100k: '0', violent_forecast_year: '2024',
    violent_predicted_rate_per_100k: '25.5', national_violent_rate_as_of_year: '50', national_violent_rate_2024: '40',
    property_as_of_year: '2020', property_current_rate_per_100k: '', property_forecast_year: '2024',
    property_predicted_rate_per_100k: 'null', national_property_rate_as_of_year: '100', national_property_rate_2024: '90',
  }];
  return { forecasts, national, comparisons };
}
function convert({ forecasts, national, comparisons } = fixture(),options={}) {
  return buildCrimeData({ forecastsCsv: csv(forecasts), nationalCsv: csv(national), comparisonsCsv: csv(comparisons), catalog,...options });
}

test('an explicit newer-forecast preference resolves only redundant prediction differences',()=>{
  const input=fixture();input.forecasts[0].predicted_rate_per_100k='30.5';
  assert.throws(()=>convert(input),/exports disagree/);
  const output=convert(input,{preferFrontendForecasts:true});
  assert.equal(output.cities['0107000'].metrics.violent.predictedRate,30.5);
  assert.equal(output.provenance.staleComparisonForecastCount,1);
  assert.equal(output.provenance.forecastSource,'exports/frontend_forecasts.csv');
  for(const[field,value]of[['violent_current_rate_per_100k','1'],['violent_forecast_year','2025'],['national_violent_rate_as_of_year','40']]){
    const broken=structuredClone(input);broken.comparisons[0][field]=value;
    assert.throws(()=>convert(broken,{preferFrontendForecasts:true}),/exports disagree/);
  }
  input.comparisons[0].violent_predicted_rate_per_100k='NaN';
  assert.throws(()=>convert(input,{preferFrontendForecasts:true}),/finite nonnegative/);
});

test('README validation figures are explicitly reported summaries, not inferred confidence intervals',()=>{
  const text='**Current results** (trained 2026-10-24 on 2,390 city-years, 2011-2018; hold-out 593 rows):\n| Violent | 0.279 | 0.314 | 0.417 | 15.8% (no-change: 16.7%) |\n| Property | 0.253 | 0.272 | 0.371 | 13.6% (no-change: 15.9%) |';
  const result=parseReportedValidation(text);
  assert.equal(result.trainingRows,2390);assert.equal(result.holdoutRows,593);
  assert.equal(result.metrics.violent.medianRateErrorPct,15.8);
  assert.equal(result.metrics.property.noChangeRmseLogChange,0.272);
  assert.equal('confidenceInterval' in result.metrics.violent,false);
  assert.equal(parseReportedValidation('No validation supplied'),null);
  assert.throws(()=>parseReportedValidation(text.replace('| Property','| Missing')),/both target metrics/);
  assert.throws(()=>parseReportedValidation(text.replace('593 rows','0 rows')),/invalid dates or row counts/);
});

test('training report uses actual held-out metrics and rejects incompatible models',()=>{
  const run=target=>({target,horizon:4,train_rows:2390,test_rows:593,train_years:[2011,2018],test_model:{n:593,rmse:0.28,rate_median_ape:0.158},test_baseline_no_change:{rmse:0.31,rate_median_ape:0.167},test_baseline_trend:{rmse:0.42}});
  const summary={violent_h4:run('violent'),property_h4:run('property')};
  const report=parseTrainingSummary(summary);
  assert.equal(report.source,'models/training_summary.json');assert.equal(report.metrics.violent.medianRateErrorPct,15.8);
  assert.equal(buildCrimeData({forecastsCsv:csv(fixture().forecasts),nationalCsv:csv(fixture().national),comparisonsCsv:csv(fixture().comparisons),catalog,reportedValidation:report}).provenance.validationAvailable,true);
  summary.property_h4.horizon=3;assert.throws(()=>parseTrainingSummary(summary),/invalid target, horizon/);
  summary.property_h4.horizon=4;summary.violent_h4.test_model.rmse=NaN;assert.throws(()=>parseTrainingSummary(summary),/invalid evaluation values/);
});

test('import preserves leading-zero IDs, real zero, missing values, actual years, and the unforecast city', () => {
  const output = convert();
  assert.equal(output.schemaVersion, 2);
  assert.equal(output.unit, 'per100000');
  assert.equal(output.forecastHorizonYears, 4);
  assert.deepEqual(Object.keys(output.cities).sort(), ['0107000', '1571550']);
  assert.equal(output.cities['0107000'].metrics.violent.currentRate, 0);
  assert.equal(output.cities['0107000'].metrics.property.currentRate, null);
  assert.equal(output.cities['0107000'].metrics.property.predictedRate, null);
  assert.equal(output.cities['0107000'].metrics.violent.baselineYear, 2020);
  assert.equal(output.cities['0107000'].metrics.violent.predictedYear, 2024);
  assert.equal(output.national[2020].rates.violent, 50);
  assert.equal(output.national[2024].rates.violent, 40);
  assert.equal(output.cities['0107000'].metrics.violent.note, 'Older baseline, with a "quoted" caveat.\nKeep the actual year.');
  assert.deepEqual(output.cities['1571550'].metrics, {});
  assert.match(output.cities['1571550'].note, /No forecast/);
  assert.equal(output.provenance.status, 'unverified_export');
  assert.equal(output.provenance.validationAvailable, false);
  assert.equal('typicalErrorPct' in output.cities['0107000'].metrics.violent, false);
});

test('unknown, shortened, wrong-state, and wrong-name city identities cannot silently join', () => {
  for (const [field, value, message] of [
    ['geoid', '107000', /exactly seven digits/],
    ['geoid', '9999999', /unknown city GEOID/],
    ['state', 'CA', /state does not match/],
    ['city', 'Another city', /city name does not match/],
  ]) {
    const input = fixture(); input.forecasts[0][field] = value;
    assert.throws(() => convert(input), message);
  }
});

test('duplicate city/metric rows, national years, and comparison cities are rejected', () => {
  for (const [collection, message] of [
    ['forecasts', /Duplicate forecast/], ['national', /Duplicate national year/], ['comparisons', /Duplicate national comparison city/],
  ]) {
    const input = fixture(); input[collection].push({ ...input[collection][0] });
    assert.throws(() => convert(input), message);
  }
});

test('the importer rejects invalid years, non-four-year horizons, and missing same-year national benchmarks', () => {
  for (const [field, value, message] of [
    ['forecast_year', '2025', /exactly four years/], ['as_of_year', '', /invalid reporting year/], ['as_of_year', '2020.0', /invalid reporting year/],
  ]) {
    const input = fixture(); input.forecasts[0][field] = value;
    assert.throws(() => convert(input), message);
  }
  const input = fixture(); input.national.shift();
  assert.throws(() => convert(input), /matching national benchmark year is missing/);
});

test('nonfinite, negative, and invalid numeric rates cannot become displayed values', () => {
  for (const value of ['Infinity', 'NaN', '-0.1', '0x10', '1,000', '1e999']) {
    const input = fixture(); input.forecasts[0].predicted_rate_per_100k = value;
    assert.throws(() => convert(input), /finite nonnegative number/);
  }
});

test('comparison cross-checks detect conflicting rates, years, and missing city rows', () => {
  for (const [field, value] of [
    ['violent_current_rate_per_100k', '1'], ['violent_predicted_rate_per_100k', '26'],
    ['violent_forecast_year', '2025'], ['national_violent_rate_as_of_year', '40'], ['national_property_rate_2024', '100'],
  ]) {
    const input = fixture(); input.comparisons[0][field] = value;
    assert.throws(() => convert(input), /exports disagree/);
  }
  const input = fixture(); input.forecasts.push({ ...input.forecasts[0], geoid: '1571550', city: 'Urban Honolulu CDP', state: 'HI' });
  assert.throws(() => convert(input), /national comparison row is missing/);
});

test('CSV parser handles escaped quotes and CRLF while rejecting broken structure and oversized fields', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"one, two","say ""hi"""\r\n'), [{ a: 'one, two', b: 'say "hi"' }]);
  for (const source of ['a,a\n1,2', 'a,b\n1', 'a,b\n"unfinished,2', 'a,b\n"closed"junk,2', `a\n${'x'.repeat(10_001)}`]) {
    assert.throws(() => parseCsv(source), /duplicate|wrong number|unterminated|malformed|limit/);
  }
});

test('directory import snapshots exact source bytes and leaves existing site data intact on invalid input', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gaurd-import-test-'));
  try {
    const source = path.join(temp, 'partner/exports');
    const root = path.join(temp, 'site');
    await fs.mkdir(source, { recursive: true });
    await fs.mkdir(path.join(root, 'web/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'web/data/city-catalog.json'), JSON.stringify(catalog));
    const input = fixture();
    const files = {
      'frontend_forecasts.csv': csv(input.forecasts),
      'national_rates_by_year.csv': csv(input.national),
      'city_forecasts_vs_national.csv': csv(input.comparisons),
    };
    for (const [filename, text] of Object.entries(files)) await fs.writeFile(path.join(source, filename), text);
    const output = await importPartnerDirectory(path.dirname(source), { root });
    for (const [filename, text] of Object.entries(files)) {
      assert.equal(await fs.readFile(path.join(root, 'data-sources/partner', filename), 'utf8'), text);
      assert.equal(output.provenance.sourceFiles.find(file => file.filename.endsWith(filename)).sha256, createHash('sha256').update(text).digest('hex'));
    }
    const outputPath = path.join(root, 'web/data/city-crime.json');
    const validData = await fs.readFile(outputPath, 'utf8');
    input.forecasts[0].forecast_year = '2025';
    await fs.writeFile(path.join(source, 'frontend_forecasts.csv'), csv(input.forecasts));
    await assert.rejects(importPartnerDirectory(source, { root }), /exactly four years/);
    assert.equal(await fs.readFile(outputPath, 'utf8'), validData);
    assert.equal(await fs.readFile(path.join(root, 'data-sources/partner/frontend_forecasts.csv'), 'utf8'), files['frontend_forecasts.csv']);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
