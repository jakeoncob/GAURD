# Data sources, feature by feature

All sources were checked on 2026-10-24. "Auto" means `Main.py build-data` downloads it; "Manual"
means a one-time browser download into `data/manual/`. Geography is the finest level available;
when it is coarser than the city, the value of the county that contains the city centre is used.

## Access keys

| Key | Where | Notes |
|---|---|---|
| `CENSUS_API_KEY` | https://api.census.gov/data/key_signup.html | Free, instant. Since 2026 the Census Data API redirects keyless data requests to a "Missing Key" page, so this is mandatory. Metadata endpoints work without it. |
| `FBI_API_KEY` | https://api.data.gov/signup/ | Free api.data.gov key used by the FBI Crime Data Explorer API. `DEMO_KEY` is limited to 10 requests/hour (confirmed from the `X-Ratelimit-Limit` header); a real key allows ~1,000/hour. |

## Outcome: crime rates

| Item | Source | Detail |
|---|---|---|
| Violent & property crime counts, by agency and month | FBI Crime Data Explorer API, `GET https://api.usa.gov/crime/fbi/cde/summarized/agency/{ORI}/{offense}?from=MM-YYYY&to=MM-YYYY&API_KEY=` | Auto. Response holds `offenses.actuals["<Agency> Offenses"]` (monthly counts) and `populations.population["<Agency>"]` (FBI's own jurisdiction population, used as the rate denominator). Offense slugs: `violent-crime`, `property-crime`, `homicide`, `rape`, `robbery`, `aggravated-assault`, `burglary`, `larceny`, `motor-vehicle-theft`, `arson`. Years with fewer than 12 reported months are dropped (`MIN_MONTHS_FOR_ANNUAL`). NIBRS-era data (2021+) flows through the same endpoint. |
| Agency directory | `GET .../agency/byStateAbbr/{ST}` | Auto. Gives ORI, name, type (`City`, `County`, ...), county and coordinates. Cities are matched to a `City`-type agency by normalised name, ties broken by distance to the city centre; consolidated governments are pinned in `config/ori_overrides.csv`. For an authoritative crosswalk use the Law Enforcement Agency Identifiers Crosswalk (ICPSR 35158). |
| Bulk alternative | Jacob Kaplan, *UCR Offenses Known and Clearances by Arrest 1960-2023*, openICPSR 100707 | Manual (free login). One file with every agency-year; includes place FIPS codes. Use if the API is too slow for a 50k+ city universe. |

## Requested inputs

| Requested input | Feature(s) | Source | Geography / years | Notes |
|---|---|---|---|---|
| Young male population 18-26 (+ derivative) | `young_male_18_26_share/_count`, `d1_`, `d5_` | ACS 5-year table **B01001** (sex by age) via `https://api.census.gov/data/{year}/acs/acs5` | Place, vintages 2011-2023 | ACS buckets are 18-19, 20, 21, 22-24, 25-29; ages 25-26 are approximated as 2/5 of the 25-29 bucket. |
| Race statistics (+ derivative) | `share_white_nh`, `share_black_nh`, `share_hispanic`, `share_asian_nh`, `share_other_nh` | ACS **B03002** (Hispanic origin by race) | Place, 2011-2023 | Non-Hispanic single-race shares plus Hispanic of any race. |
| Current dominant political parties | `pres_dem_share`, `pres_dem_margin`, `pres_dem_margin_change`, `pres_years_since_election` | Preferred: MIT Election Data + Science Lab, *County Presidential Election Returns 2000-2024*, Harvard Dataverse doi:10.7910/DVN/VOQCHQ (file `countypres_2000-2024.csv`). Fallback (auto): https://github.com/tonmcg/US_County_Level_Election_Results_08-24 | County, elections 2008-2024 (2000+ with MEDSL) | The Dataverse file sits behind a guestbook form, so download it once into `data/manual/countypres_2000-2024.csv`; the loader prefers it automatically. Value at year t = most recent election on or before t. |
| ... mayoral party | `mayor_dem`, `mayor_prob_dem` | *American Local Government Elections Database* (de Benedictis-Kessner, Lee, Velez & Warshaw, Scientific Data 2023), OSF https://osf.io/mv5e6 (`ledb_candidatelevel.csv`, auto) | 578 cities, mayoral winners 1989-2021 | Party is the authors' estimate (`pid_est`, D/R). Sitting mayor = latest win within 8 years. Missing for cities not in the database. |
| Religion statistics | `rel_adherence_rate`, `rel_congregations_per_100k` | U.S. Religion Census 2020, county summaries: https://www.usreligioncensus.org/sites/default/files/2023-06/2020_USRC_Summaries.xlsx (page: https://usreligioncensus.org/node/1639) | County, 2020 (applied to all years) | The site blocks some scripted downloads; if the automatic download fails save the file to `data/manual/`. Denominational detail (evangelical, Catholic, ...) is in `2020_USRC_Group_Detail.xlsx` on the same page. 2010 and 2000 county files: ARDA (https://www.thearda.com/us-religion/census/congregational-membership), study RCMSCY10; drop a CSV with `FIPS,TOTRATE` into `data/manual/2010_USRC_County.csv` to get a 10-year change feature. Terms: analysis allowed, no redistribution. |
| Government investment in social programs (+ derivative) | `gov_social_spend_pc`, `gov_police_spend_pc`, `gov_education_spend_pc`, `d1_`, `d5_` | Census *Annual Survey of State & Local Government Finances*, Individual Unit Files: `https://www2.census.gov/programs-surveys/gov-finances/tables/{year}/{year}_Individual_Unit_File.zip` | Municipal governments, FY2017-2022 (auto) | Fixed-width files documented inside each ZIP. Item codes summed: E79/F79 public welfare, E77/F77 welfare institutions, E32/F32 health, E36/F36 hospitals, E50/F50 housing & community development, E61/F61 parks & recreation, E52/F52 libraries (edit `SOCIAL_ITEM_CODES`); police = E62/F62. Divided by the unit's population. Years between surveys are interpolated; before 2017 the feature is missing. Caveat: in many places welfare/health is a *county* or special-district function, so city totals understate it. Alternative that corrects for this: Lincoln Institute *Fiscally Standardized Cities* (212 cities, 1977-2023, web query tool https://apps.lincolninst.edu/data/fiscally-standardized-cities/access-fisc-database). Federal grants to a city: USAspending.gov. |
| Political parties by age group ("old people die") | age structure only: `share_65plus`, `median_age`, `share_under18` (+ derivatives) | **No public city-level source.** Options: (a) Cooperative Election Study cumulative file (Harvard Dataverse doi:10.7910/DVN/II2DB6), party ID by age, reliable to the state level; (b) commercial voter files (L2, Catalist, TargetSmart) with age and party for every registrant; (c) state voter-registration extracts in party-registration states. | n/a | Including age shares next to the county partisan margin lets the tree model approximate the cohort-replacement effect without a direct measure. |
| EBT statistics | `snap_share` | ACS **B22010** (B22001 for 2011) households receiving Food Stamps/SNAP | Place, 2011-2023 | Administrative county SNAP caseloads: USDA FNS SNAP data tables / state agencies. |
| Poverty | `poverty_rate` | ACS **B17001** | Place, 2011-2023 | Share of persons below the poverty line. |
| Unemployment | `unemployment_rate` | ACS **B23025** | Place, 2011-2023 | Civilian labour force basis. Monthly city series exist from BLS LAUS for larger cities if a timelier signal is wanted. |
| % single-parent households | `single_parent_share` | ACS **B11003** | Place, 2011-2023 | Families with own children under 18 headed by one parent / all families with own children. |
| % renters | `renter_share` | ACS **B25003** | Place | Renter-occupied / occupied units. |
| % moved in the last year | `moved_last_year_share` | ACS **B07003** | Place | 1 - (same house 1 year ago / population 1+). |
| Vacant / abandoned buildings | `vacancy_rate`, `other_vacant_share` | ACS **B25002**, **B25004** | Place | "Other vacant" excludes for-rent/for-sale/seasonal and is the usual abandonment proxy. Quarterly USPS vacancy counts (HUD Aggregated USPS Administrative Data) are tract-level but restricted to government/non-profit users. |
| Commercial density | `cbp_estab_per_1000`, `cbp_retail_food_estab_per_1000`, `cbp_estab_per_sqmi` | Census *County Business Patterns* API `https://api.census.gov/data/{year}/cbp` (NAICS 00, 44-45, 72) + county population estimates + Gazetteer land area | County, 2012-2023 | Place-level alternatives: LEHD LODES workplace-area jobs aggregated with the block->place crosswalk, or the Economic Census (every 5 years). |
| % youth 16-24 not in school or working | `disconnected_youth_16_19_share` | ACS **B14005** | Place, 2011-2023 | The published place table covers 16-19 only. 16-24 requires ACS PUMS microdata (PUMA geography, https://www.census.gov/programs-surveys/acs/microdata.html) or Measure of America's county estimates. |
| Police officers per capita | `officers_per_1000` (+ derivatives) | FBI CDE police-employment endpoint `GET .../pe/agency/{ORI}?from=YYYY&to=YYYY` (`Male Officers` + `Female Officers`) | Agency, annual | Denominator: FBI jurisdiction population. Source of the FBI's own data: UCR Police Employee (LEOKA) collection. |
| % housing built before 1950 / 1978 | `housing_pre1950_share`, `housing_pre1980_share` | ACS **B25034** (year structure built) | Place | ACS buckets are decades; 1980 is the nearest cut to the 1978 lead-paint rule. Variable codes shift between vintages, so the loader resolves them by label. |
| Population density | `pop_density`, `log_population` | Census Population Estimates (`sub-est2019_all.csv`, `sub-est2024.csv`) + Gazetteer `2024_Gaz_place_national.zip` land area | Place, annual 2010-2024 | Also defines the city universe (places >= 100k in 2020). |

## Supporting geography

| Item | Source |
|---|---|
| Place -> county | Census Geocoder, `https://geocoding.geo.census.gov/geocoder/geographies/coordinates` with the place's Gazetteer internal point. Alternative: LEHD LODES `xwalk` files (block -> place, county). |
| County land area | Gazetteer `2024_Gaz_counties_national.zip`. |

## What is cached where

* `data/raw/` bulk downloads (population estimates, Gazetteer, finance ZIPs, mayoral CSV, religion XLSX)
* `data/cache/` every API response, keyed by URL without the API key
* `data/processed/panel.parquet` the assembled panel; `agency_matches.csv` the city -> ORI decisions to audit
