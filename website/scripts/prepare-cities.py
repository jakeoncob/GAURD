"""Usage: python3 scripts/prepare-cities.py cities.csv gazetteer.zip"""
import csv, io, json, re, sys, zipfile
from pathlib import Path
STATES = dict(item.split(':', 1) for item in ('AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming').split('|'))
ALIASES = {'0665042':'Ventura','1304204':'Augusta-Richmond County','1303440':'Athens-Clarke County','1571550':'Honolulu','1836003':'Indianapolis','2148006':'Louisville/Jefferson County','2146027':'Lexington-Fayette','4752006':'Nashville-Davidson'}
with open(sys.argv[1], encoding='utf-8-sig', newline='') as f: supplied = list(csv.DictReader(f))
with zipfile.ZipFile(sys.argv[2]) as archive:
    stream = io.TextIOWrapper(archive.open(archive.namelist()[0]), encoding='utf-8-sig')
    gazetteer = {r['GEOID'].strip():r for r in csv.DictReader(stream, delimiter='|')}
assert len({r['geoid'] for r in supplied}) == len(supplied), 'Duplicate GEOIDs'
cities = []
for row in supplied:
    geoid = row['geoid']; assert re.fullmatch(r'\d{7}', geoid), 'Keep leading zeros'
    point = gazetteer[geoid]; assert point['USPS'] == row['state_abbr']
    name = ALIASES.get(geoid, re.sub(r' (?:city|town)(?: \(balance\))?$', '', row['name']))
    cities.append({'id':f'city:{geoid}','geoid':geoid,'kind':'city','name':name,'sourceName':row['name'],'stateAbbr':row['state_abbr'],'stateName':STATES[row['state_abbr']],'country':'United States','countryCode':'US','type':'City','basePopulation':int(row['base_population']),'populationYear':None,'landAreaSqMi':float(row['aland_sqmi']),'latitude':float(point['INTPTLAT']),'longitude':float(point['INTPTLONG'])})
cities.sort(key=lambda c:(c['name'],c['stateAbbr']))
result = {'schemaVersion':1,'count':len(cities),'sources':{'catalog':'User-supplied cities.csv','populationYear':None,'coordinates':'U.S. Census Bureau 2025 Gazetteer Places','coordinateUrl':'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html','coordinateFile':'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_place_national.zip','coordinateMeaning':'Representative place point; not a city boundary or model jurisdiction'},'cities':cities}
Path('web/data/city-catalog.json').write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
print(f'Prepared {len(cities)} cities; all GEOIDs matched Census coordinates.')
