import { isICAO, normalizeIATA, normalizeICAO, validateFrequencyType, WaypointVariant, type Aerodrome, type Frequency, type ICAO, type Runway } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { capitalizeWords } from "flight-planner/utils";
import { ApiError } from "./error.js";
import { point } from "@turf/turf";

const OPENAIP_API_CONFIG = {
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

export interface OpenAipOptions {
  apiKey: string;
  fetcher?: FetchFunction;
}

/**
 * Base API function for fetching OpenAIP data.
 *
 * @param uri - The URI path to append to the base URL.
 * @param apiKey - The OpenAIP API key for authentication.
 * @param options - Additional fetch options.
 * @param fetcher - Custom fetch function (defaults to global fetch).
 * @returns Promise resolving to an array of Aerodrome objects.
 * @throws Will throw an error if the API request fails.
 */
async function baseApi(
  uri: string,
  apiKey: string,
  options: RequestInit = {},
  fetcher: FetchFunction = fetch
): Promise<Aerodrome[]> {
  const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
    ...options,
    headers: {
      "x-openaip-api-key": apiKey
    },
    cf: {
      cacheTtl: OPENAIP_API_CONFIG.CACHE_TTL,
      cacheEverything: true,
    },
    timeout: OPENAIP_API_CONFIG.TIMEOUT
  };

  try {
    const response = await fetchApi(fetcher, `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenAIP API request failed with status: ${response.status}`);
    }

    const data = await response.json() as any;
    if (!data || !data.items || data.items.length === 0) {
      return [];
    }

    // FUTURE: This excludes any aerodromes without an ICAO code
    return data.items.filter((aerodrome: any) => aerodrome.icaoCode && isICAO(aerodrome.icaoCode)).map((aerodrome: any) => {
      const runways = Array.isArray(aerodrome.runways) ? aerodrome.runways.map((runway: any) => {
        return {
          designator: runway.designator, // TODO: Validate using regex
          heading: runway.trueHeading, // TODO: between 0 and 360
          length: runway.dimension?.length.unit === 0 ? runway.dimension?.length.value : undefined,
          width: runway.dimension?.width.unit === 0 ? runway.dimension?.width.value : undefined,
          surface: runway.surface.mainComposite,
        };
      }) as Runway[] : [];

      const frequencies = Array.isArray(aerodrome.frequencies) ? aerodrome.frequencies.map((frequency: any) => {
        return {
          type: validateFrequencyType(frequency.type),
          name: frequency.name || '',
          value: frequency.value,
        };
      }) as Frequency[] : [];

      // TODO: Hand this off the FlightPlanner
      const elevation = (aerodrome.elevation && aerodrome.elevation.unit === 0 && aerodrome.elevation.referenceDatum === 1) ? aerodrome.elevation.value * OPENAIP_API_CONFIG.METERS_TO_FEET : undefined;

      return {
        ICAO: normalizeICAO(aerodrome.icaoCode),
        IATA: aerodrome.iataCode ? normalizeIATA(aerodrome.iataCode) : undefined,
        name: capitalizeWords(aerodrome.name),
        location: point(aerodrome.geometry.coordinates),
        elevation,
        declination: aerodrome.magneticDeclination,
        runways,
        frequencies,
        ppr: aerodrome.ppr,
        waypointVariant: WaypointVariant.Aerodrome
      };
    });
  } catch (error) {
    throw new ApiError('OpenAIP API', `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions, error);
  }
}

/**
 * Get aerodrome information for a specific ICAO code.
 *
 * @param icao - ICAO airport code.
 * @returns Promise resolving to an array of Aerodrome objects.
 */
export async function getAerodromeByIcao(icao: ICAO, options: OpenAipOptions): Promise<Aerodrome[]> {
  const { fetcher = fetch, apiKey } = options;
  return baseApi(`airports?search=${icao}&limit=${OPENAIP_API_CONFIG.SEARCH_LIMIT}`, apiKey, {}, fetcher);
}

/**
 * Get aerodrome information for airports within a radius from a location.
 *
 * @param location - GeoJSON Position [longitude, latitude].
 * @param distance - Distance in kilometers (default: 50).
 * @returns Promise resolving to an array of Aerodrome objects.
 * @throws Will throw an error if distance is negative or location format is invalid.
 */
export async function getAerodromeByRadius(
  location: GeoJSON.Position,
  distance: number = OPENAIP_API_CONFIG.DEFAULT_RADIUS_KM,
  options: OpenAipOptions
): Promise<Aerodrome[]> {
  if (distance < 0) {
    throw new Error("Distance must be greater than 0");
  }
  if (location.length !== 2) {
    throw new Error("Location must be a 2D coordinate");
  }

  const { fetcher = fetch, apiKey } = options;

  // TODO: Move this somewhere else
  const distanceInMeters = distance * OPENAIP_API_CONFIG.KM_TO_METERS;
  const lat = parseFloat(location[1].toFixed(OPENAIP_API_CONFIG.COORDINATE_PRECISION));
  const lon = parseFloat(location[0].toFixed(OPENAIP_API_CONFIG.COORDINATE_PRECISION));

  const typeParams = OPENAIP_API_CONFIG.AIRPORT_TYPES.map(type => `type=${type}`).join('&');
  return baseApi(`airports?pos=${lat},${lon}&dist=${distanceInMeters}&${typeParams}&limit=${OPENAIP_API_CONFIG.RADIUS_LIMIT}`, apiKey, {}, fetcher);
}

/**
 * Aerodrome data provider.
 *
 * @param options - Configuration options including API key and optional custom fetcher.
 * @returns An object with methods to fetch aerodrome data by ICAO code or radius.
 */
export default function aerodromeProvider(options: OpenAipOptions) {
  return {
    getAerodromeByIcao: (icao: ICAO) => getAerodromeByIcao(icao, options),
    getAerodromeByRadius: (location: GeoJSON.Position, distance?: number) => getAerodromeByRadius(location, distance, options)
  };
}
