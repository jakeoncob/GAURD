import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['violent', 'property'];
const filenames = ['frontend_forecasts.csv', 'national_rates_by_year.csv', 'city_forecasts_vs_national.csv'];
const limits = { bytes: 2_000_000, rows: 10_000, columns: 100, field: 10_000 };
const modelVersion = 'LightGBM · 4-year forecast';

/** Strict CSV parser: quoted fields, escaped quotes, CRLF, and empty values are preserved. */
export function parseCsv(text, filename = 'CSV') {
  if (typeof text !== 'string' || Buffer.byteLength(text) > limits.bytes) throw new Error(`${filename}: CSV exceeds the size limit`);
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  const pushField = () => {
    if (field.length > limits.field || row.length >= limits.columns) throw new Error(`${filename}: CSV field or column limit exceeded`);
    row.push(field); field = ''; closed = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some(value => value !== '')) rows.push(row);
    row = [];
    if (rows.length > limits.rows) throw new Error(`${filename}: CSV row limit exceeded`);
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      pushRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (char === '"' || closed) throw new Error(`${filename}: malformed quoted CSV field`);
      field += char;
    }
    if (field.length > limits.field) throw new Error(`${filename}: CSV field limit exceeded`);
  }
  if (quoted) throw new Error(`${filename}: unterminated quoted CSV field`);
  if (row.length || field || closed) pushRow();
  if (!rows.length) throw new Error(`${filename}: CSV is empty`);
  const headers = rows.shift();
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error(`${filename}: missing or duplicate CSV column names`);
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`${filename}: row ${index + 2} has the wrong number of columns`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

function requireColumns(rows, columns, label) {
  if (!rows.length) throw new Error(`${label}: no data rows`);
  for (const column of columns) if (!(column in rows[0])) throw new Error(`${label}: missing column ${column}`);
}

function year(value, label) {
  if (!/^\d{4}$/.test(value ?? '') || Number(value) < 1900 || Number(value) > 2200) throw new Error(`${label}: invalid reporting year`);
  return Number(value);
}

function rate(value, label) {
  const input = String(value ?? '').trim();
  if (!input || input.toLowerCase() === 'null') return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input)) throw new Error(`${label}: rate must be a finite nonnegative number or empty`);
  const number = Number(input);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}: rate must be a finite nonnegative number or empty`);
  return number === 0 ? 0 : number;
}

function validateCity(row, catalogById, label) {
  if (!/^\d{7}$/.test(row.geoid ?? '')) throw new Error(`${label}: GEOID must contain exactly seven digits, including leading zeros`);
  const city = catalogById.get(row.geoid);
  if (!city) throw new Error(`${label}: unknown city GEOID ${row.geoid}`);
  if (row.state !== city.stateAbbr) throw new Error(`${label}: state does not match city GEOID ${row.geoid}`);
  if (row.city !== city.sourceName && row.city !== city.name) throw new Error(`${label}: city name does not match GEOID ${row.geoid}`);
  return city;
}

function same(value, expected, label) {
  if (value !== expected) throw new Error(`${label}: forecast and national comparison exports disagree`);
}

/** Read the explicitly reported results table; this does not verify model performance. */
export function parseReportedValidation(readme) {
  if (typeof readme !== 'string' || !readme.includes('**Current results**')) return null;
  const run=readme.match(/trained (\d{4}-\d{2}-\d{2}) on ([\d,]+) city-years, (\d{4})[-–](\d{4}); hold-out ([\d,]+) rows/);
  if(!run)throw new Error('README validation summary: training dates and row counts are missing');
  const trainingDate=run[1],trainingRows=Number(run[2].replaceAll(',','')),start=Number(run[3]),end=Number(run[4]),holdoutRows=Number(run[5].replaceAll(',',''));
  if(!Number.isFinite(Date.parse(trainingDate))||!Number.isSafeInteger(trainingRows)||trainingRows<=0||!Number.isSafeInteger(holdoutRows)||holdoutRows<=0||start<1900||end>2200||end<start)throw new Error('README validation summary: invalid dates or row counts');
  const metrics={};
  for(const line of readme.split(/\r?\n/)){
    const row=line.trim().match(/^\|\s*(Violent|Property)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)%\s*\(no-change:\s*([\d.]+)%\)\s*\|\s*$/i);
    if(!row)continue;
    const target=row[1].toLowerCase(),values=row.slice(2).map(Number);
    if(metrics[target]||values.some(value=>!Number.isFinite(value)||value<0))throw new Error('README validation summary: invalid or duplicate metric');
    metrics[target]=Object.fromEntries(['modelRmseLogChange','noChangeRmseLogChange','trendRmseLogChange','medianRateErrorPct','noChangeMedianRateErrorPct'].map((key,i)=>[key,values[i]]));
  }
  if(!targets.every(target=>metrics[target]))throw new Error('README validation summary: both target metrics are required');
  return {source:'README.md',trainingDate,trainingRows,trainingFeatureYears:{start,end},holdoutRows,metrics};
}

export function parseTrainingSummary(summary) {
  const metrics={};let reference;
  for(const target of targets){
    const run=summary?.[`${target}_h4`];
    if(run?.target!==target||run.horizon!==4||!Number.isInteger(run.train_rows)||run.train_rows<=0||!Number.isInteger(run.test_rows)||run.test_rows<=0||run.test_model?.n!==run.test_rows||!Array.isArray(run.train_years)||run.train_years.length!==2||run.train_years.some(value=>!Number.isInteger(value)||value<1900||value>2200)||run.train_years[0]>run.train_years[1])throw new Error('Training summary: invalid target, horizon, years or row counts');
    const values=[run.test_model.rmse,run.test_baseline_no_change?.rmse,run.test_baseline_trend?.rmse,run.test_model.rate_median_ape,run.test_baseline_no_change?.rate_median_ape];
    if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0))throw new Error('Training summary: invalid evaluation values');
    metrics[target]={modelRmseLogChange:values[0],noChangeRmseLogChange:values[1],trendRmseLogChange:values[2],medianRateErrorPct:values[3]*100,noChangeMedianRateErrorPct:values[4]*100};
    const counts=JSON.stringify([run.train_rows,run.test_rows,run.train_years]);
    if(reference&&reference!==counts)throw new Error('Training summary: category evaluation periods differ');
    reference=counts;
  }
  const run=summary.violent_h4;
  return {source:'models/training_summary.json',trainingRows:run.train_rows,trainingFeatureYears:{start:run.train_years[0],end:run.train_years[1]},holdoutRows:run.test_rows,metrics};
}

/** Convert a bounded partner handoff without inventing rates, dates, confidence, or geography. */
export function buildCrimeData({ forecastsCsv, nationalCsv, comparisonsCsv, catalog, sourceFiles = [], preferFrontendForecasts = false, reportedValidation = null }) {
  const catalogCities = Array.isArray(catalog) ? catalog : catalog?.cities;
  if (!Array.isArray(catalogCities) || !catalogCities.length) throw new Error('City catalog is empty or invalid');
  const catalogById = new Map();
  for (const city of catalogCities) {
    if (!/^\d{7}$/.test(city.geoid) || catalogById.has(city.geoid)) throw new Error('City catalog has invalid or duplicate GEOIDs');
    catalogById.set(city.geoid, city);
  }

  const forecasts = parseCsv(forecastsCsv, filenames[0]);
  const nationalRows = parseCsv(nationalCsv, filenames[1]);
  const comparisons = parseCsv(comparisonsCsv, filenames[2]);
  requireColumns(forecasts, ['geoid', 'city', 'state', 'target', 'as_of_year', 'forecast_year', 'current_rate_per_100k', 'predicted_rate_per_100k', 'note'], filenames[0]);
  requireColumns(nationalRows, ['year', ...targets.map(target => `national_${target}_rate_per_100k`)], filenames[1]);
  requireColumns(comparisons, ['geoid', 'city', 'state', ...targets.flatMap(target => [
    `${target}_as_of_year`, `${target}_current_rate_per_100k`, `${target}_forecast_year`, `${target}_predicted_rate_per_100k`,
    `national_${target}_rate_as_of_year`, `national_${target}_rate_2024`,
  ])], filenames[2]);

  const national = {};
  for (const row of nationalRows) {
    const baselineYear = year(row.year, 'National benchmark');
    if (Object.hasOwn(national, baselineYear)) throw new Error(`Duplicate national year ${baselineYear}`);
    national[baselineYear] = {
      year: baselineYear,
      rates: Object.fromEntries(targets.map(target => [target, rate(row[`national_${target}_rate_per_100k`], `${baselineYear} national ${target}`)])),
      sources: [{ title: 'National crime rates', year: baselineYear }],
    };
  }

  const cities = Object.fromEntries(catalogCities.map(city => [city.geoid, {
    name: city.name, state: city.stateAbbr, metrics: {}, note: 'No forecast was supplied for this city.',
  }]));
  for (const row of forecasts) {
    const city = validateCity(row, catalogById, 'Forecast export');
    if (!targets.includes(row.target)) throw new Error(`${city.geoid}: unknown crime target ${row.target}`);
    const record = cities[city.geoid];
    if (Object.hasOwn(record.metrics, row.target)) throw new Error(`Duplicate forecast ${city.geoid}/${row.target}`);
    const baselineYear = year(row.as_of_year, `${city.geoid}/${row.target}`);
    const predictedYear = year(row.forecast_year, `${city.geoid}/${row.target}`);
    if (predictedYear !== baselineYear + 4) throw new Error(`${city.geoid}/${row.target}: forecast horizon must be exactly four years`);
    if (!Object.hasOwn(national, baselineYear)) throw new Error(`${city.geoid}/${row.target}: matching national benchmark year is missing`);
    record.metrics[row.target] = {
      baselineYear,
      currentRate: rate(row.current_rate_per_100k, `${city.geoid}/${row.target} current`),
      predictedYear,
      predictedRate: rate(row.predicted_rate_per_100k, `${city.geoid}/${row.target} predicted`),
      note: row.note.trim() || null,
      modelVersion,
    };
    record.note = null;
  }

  const comparedCities = new Set();
  let staleComparisonForecastCount=0;
  for (const row of comparisons) {
    const city = validateCity(row, catalogById, 'National comparison export');
    if (comparedCities.has(city.geoid)) throw new Error(`Duplicate national comparison city ${city.geoid}`);
    comparedCities.add(city.geoid);
    for (const target of targets) {
      const expected = cities[city.geoid].metrics[target];
      if (!expected) throw new Error(`${city.geoid}/${target}: comparison has no matching forecast`);
      const label = `${city.geoid}/${target}`;
      same(year(row[`${target}_as_of_year`], label), expected.baselineYear, label);
      same(year(row[`${target}_forecast_year`], label), expected.predictedYear, label);
      same(rate(row[`${target}_current_rate_per_100k`], label), expected.currentRate, label);
      const comparedForecast=rate(row[`${target}_predicted_rate_per_100k`], label);
      if(comparedForecast!==expected.predictedRate){
        if(!preferFrontendForecasts)same(comparedForecast,expected.predictedRate,label);
        staleComparisonForecastCount++;
      }
      same(rate(row[`national_${target}_rate_as_of_year`], label), national[expected.baselineYear].rates[target], label);
      if (!national[2024]) throw new Error('The comparison export requires a national benchmark for 2024');
      same(rate(row[`national_${target}_rate_2024`], label), national[2024].rates[target], label);
    }
  }
  for (const [geoid, city] of Object.entries(cities)) {
    if (Object.keys(city.metrics).length && !comparedCities.has(geoid)) throw new Error(`${geoid}: national comparison row is missing`);
  }

  return {
    schemaVersion: 2,
    unit: 'per100000',
    forecastHorizonYears: 4,
    provenance: {
      status: 'unverified_export',
      teamConfirmedRealData: true,
      validationAvailable: reportedValidation?.source==='models/training_summary.json',
      model: modelVersion,
      sourceFiles,
      forecastSource: 'exports/frontend_forecasts.csv',
      comparisonPolicy: preferFrontendForecasts?'prefer_frontend_forecasts':'strict_agreement',
      staleComparisonForecastCount,
      reportedValidation,
      validationNote: reportedValidation?'Evaluation results are recorded in the model details.':'Evaluation results are unavailable.',
      geographyNote: 'City GEOIDs identify map locations. Crime rates use matched law-enforcement agency jurisdictions; their boundaries may differ from city boundaries.',
      uncertaintyNote: 'No calibrated prediction interval is available in this handoff.',
    },
    metrics: {
      violent: {
        id: 'violent', label: 'Violent crime',
        definition: 'Reported murder and nonnegligent manslaughter, rape, robbery, and aggravated assault offenses per 100,000 residents per year.',
      },
      property: {
        id: 'property', label: 'Property crime',
        definition: 'Reported burglary, larceny-theft, and motor vehicle theft offenses per 100,000 residents per year.',
      },
    },
    national,
    cities,
  };
}

export async function importPartnerDirectory(partnerDirectory, { root = projectRoot, preferFrontendForecasts = false } = {}) {
  if (!partnerDirectory) throw new Error('Provide the partner project directory or its exports directory');
  const supplied = path.resolve(partnerDirectory);
  const exportsDirectory = path.basename(supplied) === 'exports' ? supplied : path.join(supplied, 'exports');
  const inputs = await Promise.all(filenames.map(async filename => {
    const inputPath = path.join(exportsDirectory, filename);
    const stat = await fs.stat(inputPath);
    if (!stat.isFile() || stat.size > limits.bytes) throw new Error(`${filename}: input must be a CSV file smaller than ${limits.bytes} bytes`);
    const bytes = await fs.readFile(inputPath);
    return { filename, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'web/data/city-catalog.json'), 'utf8'));
  let readmeBytes;
  try{const readmePath=path.join(path.dirname(exportsDirectory),'README.md');const stat=await fs.stat(readmePath);if(!stat.isFile()||stat.size>128_000)throw new Error('README exceeds validation summary size limit');readmeBytes=await fs.readFile(readmePath);}catch(error){if(error.code!=='ENOENT')throw error;}
  let reportedValidation=parseReportedValidation(readmeBytes?.toString('utf8'));
  if(reportedValidation)reportedValidation.sourceSha256=createHash('sha256').update(readmeBytes).digest('hex');
  let trainingBytes;
  try{const summaryPath=path.join(path.dirname(exportsDirectory),'models/training_summary.json');const stat=await fs.stat(summaryPath);if(!stat.isFile()||stat.size>128_000)throw new Error('Training summary exceeds size limit');trainingBytes=await fs.readFile(summaryPath);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(trainingBytes){reportedValidation=parseTrainingSummary(JSON.parse(trainingBytes.toString('utf8')));reportedValidation.sourceSha256=createHash('sha256').update(trainingBytes).digest('hex');}
  const output = buildCrimeData({
    forecastsCsv: inputs[0].bytes.toString('utf8'), nationalCsv: inputs[1].bytes.toString('utf8'), comparisonsCsv: inputs[2].bytes.toString('utf8'), catalog,
    sourceFiles: inputs.map(({ filename, sha256 }) => ({ filename: `exports/${filename}`, sha256 })),
    preferFrontendForecasts,reportedValidation,
  });
  // All inputs must pass validation before any existing site data is replaced.
  const snapshotDirectory = path.join(root, 'data-sources/partner');
  await fs.mkdir(snapshotDirectory, { recursive: true });
  for (const { filename, bytes } of inputs) await fs.writeFile(path.join(snapshotDirectory, filename), bytes);
  if(readmeBytes)await fs.writeFile(path.join(snapshotDirectory,'README.md'),readmeBytes);
  if(trainingBytes)await fs.writeFile(path.join(snapshotDirectory,'training_summary.json'),trainingBytes);
  await fs.writeFile(path.join(root, 'web/data/city-crime.json'), `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),preferFrontendForecasts=args.includes('--prefer-frontend-forecasts'),directories=args.filter(arg=>arg!=='--prefer-frontend-forecasts');
  if (directories.length !== 1 || directories[0].startsWith('--') || args.length>(preferFrontendForecasts?2:1)) {
    console.error('Usage: node scripts/import-partner.mjs /absolute/path/to/HackathonGroup-main [--prefer-frontend-forecasts]');
    process.exitCode = 1;
  } else {
    try {
      const output = await importPartnerDirectory(directories[0],{preferFrontendForecasts});
      const covered = Object.values(output.cities).filter(city => Object.keys(city.metrics).length).length;
      console.log(`Imported ${covered}/${Object.keys(output.cities).length} city forecasts, two crime categories, and ${Object.keys(output.national).length} national benchmark years. Source provenance remains unverified.`);
      if(output.provenance.staleComparisonForecastCount)console.log(`Used revised frontend forecasts for ${output.provenance.staleComparisonForecastCount} values that differ from the older combined comparison export; identity, baseline, horizon, and national checks remain strict.`);
    } catch (error) {
      console.error(`Partner import failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
