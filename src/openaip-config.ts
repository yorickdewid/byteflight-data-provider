export const OPENAIP_API_CONFIG = {
  API_URL: 'https://api.core.openaip.net/api/',
  CACHE_TTL: 3600 * 24 * 7, // 1 week for airport data
  TIMEOUT: 10000, // 10 seconds
  SEARCH_LIMIT: 1,
  RADIUS_LIMIT: 200,
  DEFAULT_RADIUS_KM: 50,
  COORDINATE_PRECISION: 2,
  METERS_TO_FEET: 3.28084,
  KM_TO_METERS: 1_000,
  AIRPORT_TYPES: [0, 1, 2, 3, 9, 5]
} as const;

/** OpenAIP API response item for airports */
export interface OpenAipAirportItem {
  icaoCode?: string;
  iataCode?: string;
  name: string;
  geometry: {
    coordinates: [number, number];
  };
  elevation?: {
    value: number;
    unit: number;
    referenceDatum: number;
  };
  magneticDeclination?: number;
  ppr?: boolean;
  runways?: Array<{
    designator: string;
    trueHeading: number;
    dimension?: {
      length: { value: number; unit: number };
      width: { value: number; unit: number };
    };
    surface: { mainComposite: string };
  }>;
  frequencies?: Array<{
    type: number;
    name?: string;
    value: number;
  }>;
}

/** OpenAIP API response item for navaids */
export interface OpenAipNavaidItem {
  identifier: string;
  name?: string;
  geometry: {
    coordinates: [number, number];
  };
  elevation?: {
    value: number;
  };
  frequency?: {
    value: number;
  };
}

/** OpenAIP API response wrapper */
export interface OpenAipResponse<T> {
  items: T[];
  totalCount?: number;
}
