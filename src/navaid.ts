import { validateFrequencyType, WaypointVariant, type Aerodrome, type Frequency } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { capitalizeWords } from "flight-planner/utils";
import { ApiError } from "./error.js";

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

export interface NavaidProvider {
  getByIcao(identifier: string): Promise<Aerodrome[]>;
}

/**
 * Base API function for fetching OpenAIP data.
 *
 * @param uri - The URI path to append to the base URL.
 * @param apiKey - The OpenAIP API key for authentication.
 * @param options - Additional fetch options.
 * @param fetcher - Custom fetch function (defaults to global fetch).
 * @returns Promise resolving to an array of navaid objects.
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

  const response = await fetchApi(fetcher, `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions);
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError('OpenAIP', `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions, `HTTP ${response.status} - ${response.statusText}`);
  }

  const data = await response.json() as any;
  if (!data || !data.items || data.items.length === 0) {
    return [];
  }

  return data.items.filter((navaid: any) => navaid.identifier).map((navaid: any) => {
    console.log(navaid);
  });
}

/**
 * Get navaid information for a specific identifier.
 *
 * @param identifier - The identifier of the navaid to fetch.
 * @returns Promise resolving to an array of navaid objects.
 */
export async function getNavaidByIcao(identifier: string, options: OpenAipOptions): Promise<Aerodrome[]> {
  const { fetcher = fetch, apiKey } = options;
  return baseApi(`navaids?search=${identifier}&limit=${OPENAIP_API_CONFIG.SEARCH_LIMIT}`, apiKey, {}, fetcher);
}

/**
 * Navaid data provider.
 *
 * @param options - Configuration options including API key and optional custom fetcher.
 * @returns An object with methods to fetch navaid data by ICAO code.
 */
export default function navaidProvider(options: OpenAipOptions): NavaidProvider {
  return {
    getByIcao: (identifier: string) => getNavaidByIcao(identifier, options),
  };
}
