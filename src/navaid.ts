import { type Aerodrome } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { ApiError } from "./error.js";
import { OPENAIP_API_CONFIG, type OpenAipNavaidItem, type OpenAipResponse } from "./openaip-config.js";

export interface OpenAipOptions {
  apiKey: string;
  fetcher?: FetchFunction;
}

export interface NavaidProvider {
  getByIcao(identifier: string): Promise<Aerodrome[]>;
}

/**
 * Base API function for fetching OpenAIP navaid data.
 *
 * @param uri - The URI path to append to the base URL.
 * @param apiKey - The OpenAIP API key for authentication.
 * @param options - Additional fetch options.
 * @param fetcher - Custom fetch function (defaults to global fetch).
 * @returns Promise resolving to an array of navaid objects (mapped to Aerodrome structure until Navaid type is available).
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

  const data = await response.json() as OpenAipResponse<OpenAipNavaidItem>;
  if (!data || !data.items || data.items.length === 0) {
    return [];
  }

  // Map OpenAIP navaid to Aerodrome structure (best effort)
  return data.items
    .filter((navaid) => navaid.identifier)
    .map((navaid) => ({
      icao: navaid.identifier,
      name: navaid.name || navaid.identifier,
      coords: navaid.geometry.coordinates, // [lon, lat]
      elevation: navaid.elevation?.value || 0,
      runways: [], // Navaids don't have runways
      frequencies: navaid.frequency ? [{
        type: 'NAV', // Generic NAV type
        frequency: navaid.frequency.value,
        name: navaid.name
      }] : [],
    } as unknown as Aerodrome));
}

/**
 * Get navaid information for a specific identifier.
 *
 * @param identifier - The identifier of the navaid to fetch.
 * @returns Promise resolving to an array of navaid objects.
 */
export async function getNavaidByIcao(identifier: string, options: OpenAipOptions): Promise<Aerodrome[]> {
  const { fetcher = fetch, apiKey } = options;
  return baseApi(`navaids?search=${encodeURIComponent(identifier)}&limit=${OPENAIP_API_CONFIG.SEARCH_LIMIT}`, apiKey, {}, fetcher);
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
