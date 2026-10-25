import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCityComparison, chartScale, formatRate } from '../web/crime-comparison.js';

const example = overrides => ({geoid:'2507000',unit:'per100000',baselineYear:2024,nationalYear:2024,nationalRate:2000,currentRate:1000,predictedYear:2028,predictedRate:750,...overrides});
const reportedValidation = () => ({
  source:'README.md',sourceSha256:'a'.repeat(64),trainingDate:'2026-10-24',trainingRows:2390,
  trainingFeatureYears:{start:2011,end:2018},holdoutRows:593,
  metrics:{
    violent:{modelRmseLogChange:0.279,noChangeRmseLogChange:0.314,trendRmseLogChange:0.417,medianRateErrorPct:15.8,noChangeMedianRateErrorPct:16.7},
    property:{modelRmseLogChange:0.253,noChangeRmseLogChange:0.272,trendRmseLogChange:0.371,medianRateErrorPct:13.6,noChangeMedianRateErrorPct:15.9},
  },
});

test('national, current, and exactly four-year rates share a zero-based scale',()=>{
  const result=normalizeCityComparison(example(),'2507000');
  assert.equal(result.status,'ready');assert.deepEqual(result.series.map(s=>s.value),[2000,1000,750]);
  assert.deepEqual(result.series.map(s=>s.year),[2024,2024,2028]);assert.ok(chartScale(result.series)>=2000);
});
test('a genuine zero rate is shown, while null and invalid values remain unavailable',()=>{
  const result=normalizeCityComparison(example({nationalRate:null,currentRate:0,predictedRate:-1}),'2507000');
  assert.deepEqual(result.series.map(s=>s.value),[null,0,null]);assert.equal(result.status,'partial');assert.equal(formatRate(0),'0');
  assert.equal(chartScale(result.series),1);assert.equal(chartScale(normalizeCityComparison({unit:'per100000'},'2507000').series),null);
});
test('mismatched national year and forecast horizon do not become comparable bars',()=>{
  const result=normalizeCityComparison(example({nationalYear:2023,predictedYear:2027}),'2507000');
  assert.deepEqual(result.series.map(s=>s.value),[null,1000,null]);assert.equal(result.warnings.length,2);
});
test('four years is anchored to the reporting year, not the current calendar year',()=>{
  const result=normalizeCityComparison(example({baselineYear:2020,nationalYear:2020,predictedYear:2024}),'2507000');
  assert.equal(result.status,'ready');assert.equal(result.predictedYear,2024);
});
test('missing years, nonnumeric rates, wrong units and another city cannot be mistaken for valid data',()=>{
  assert.equal(normalizeCityComparison(example({baselineYear:null}),'2507000').status,'pending');
  assert.equal(normalizeCityComparison(example({currentRate:'1000'}),'2507000').series[1].value,null);
  assert.throws(()=>normalizeCityComparison(example({unit:'count'}),'2507000'),/100,000/);
  assert.throws(()=>normalizeCityComparison(example({geoid:'1714000'}),'2507000'),/different city/);
});
test('retains only the selected category’s team-reported validation without claiming a full report',()=>{
  for(const metric of ['violent','property']){
    const report=reportedValidation();
    const result=normalizeCityComparison(example({metric:{id:metric},provenance:{status:'unverified_export',validationAvailable:false,reportedValidation:report}}),'2507000');
    assert.deepEqual(result.provenance.reportedValidation.metric,report.metrics[metric]);
    assert.equal(result.provenance.reportedValidation.holdoutRows,593);
    assert.deepEqual(result.provenance.reportedValidation.trainingFeatureYears,{start:2011,end:2018});
    assert.equal(result.provenance.reportedValidation.sourceSha256,'a'.repeat(64));
    assert.equal(result.provenance.validationAvailable,false);
  }
});
test('missing, mismatched, and malformed validation summaries never become reported evaluation results',()=>{
  const normalize=report=>normalizeCityComparison(example({metric:{id:'violent'},provenance:{reportedValidation:report}}),'2507000').provenance.reportedValidation;
  assert.equal(normalize(undefined),null);
  assert.equal(normalize({...reportedValidation(),metrics:{property:reportedValidation().metrics.property}}),null);
  for(const invalid of [-1,NaN,Infinity,'15.8',null]){
    const report=reportedValidation();report.metrics.violent.medianRateErrorPct=invalid;
    assert.equal(normalize(report),null);
  }
  assert.equal(normalize({...reportedValidation(),holdoutRows:0}),null);
  assert.equal(normalize({...reportedValidation(),holdoutRows:'593'}),null);
  const zero=reportedValidation();zero.metrics.violent.modelRmseLogChange=0;
  assert.equal(normalize(zero).metric.modelRmseLogChange,0);
});
