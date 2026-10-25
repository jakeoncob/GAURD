# Supplied city catalog

`cities.csv` is an unchanged copy of the user's supplied catalog. It contains 323 unique seven-digit Census place GEOIDs, official place names, state abbreviations, reference populations, and land area in square miles.

The file does not include a population reporting year, city coordinates, crime rates, or predictions. Preserve GEOIDs as strings so leading zeros remain intact.

`scripts/prepare-cities.py` joins these IDs to the U.S. Census Bureau 2025 Gazetteer Places representative coordinates. All 323 IDs match. Marker coordinates do not define city boundaries or police-department coverage.

The national crime average must come from a separately sourced, compatible national rate. It is not the average of these 323 cities.
