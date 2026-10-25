// Connect the model without changing map or chart code.
export const dataConfig = {
  mode: 'static', // 'static' for a JSON export; 'api' for an HTTP backend.
  crimeDataUrl: './data/city-crime.json',
  apiBaseUrl: '', // Route: /cities/{7-digit-geoid}/crime-comparison?horizonYears=4&metric=violent
};
