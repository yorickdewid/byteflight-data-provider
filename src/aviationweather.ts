import { createMetarFromString, normalizeICAO, type ICAO, type MetarStation } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { ApiError } from "./error.js";

const AVIATIONWEATHER_API_CONFIG = {
  API_URL: 'https://aviationweather.gov/api/data/',
  CACHE_TTL: 60, // 1 minute for weather data
  TIMEOUT: 5000, // 5 seconds
} as const;

export interface MetarOptions {
  fetcher?: FetchFunction;
}

/**
 * Base API function for fetching METAR data.
 *
 * @param uri - The URI path to append to the base URL.
 * @returns Promise resolving to an array of MetarStation objects.
 * @throws Will throw an error if the API request fails.
 */
async function baseApi(
  uri: string,
  options: RequestInit = {},
  fetcher: FetchFunction = fetch
): Promise<MetarStation[]> {
  const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
    ...options,
    cf: {
      cacheTtl: AVIATIONWEATHER_API_CONFIG.CACHE_TTL,
      cacheEverything: true,
    },
    timeout: AVIATIONWEATHER_API_CONFIG.TIMEOUT
  };

  try {
    const response = await fetchApi(fetcher, `${AVIATIONWEATHER_API_CONFIG.API_URL}${uri}`, apiOptions);
    if (!response.ok) {
      throw new Error(`METAR API request failed with status: ${response.status}`);
    }

    const data = await response.json() as any[];
    if (!data || data.length === 0) {
      return [];
    }

    return data.map((metar: any) => ({
      station: normalizeICAO(metar.icaoId),
      metar: createMetarFromString(metar.rawOb),
      tafRaw: metar.rawTaf,
      coords: [metar.lon, metar.lat]
    }));
  } catch (error) {
    throw new ApiError('METAR API', `${AVIATIONWEATHER_API_CONFIG.API_URL}${uri}`, apiOptions, error);
  }
}

/**
 * Get METAR information for specific ICAO codes.
 *
 * @param icao - Array of ICAO airport codes.
 * @returns Promise resolving to an array of MetarStation objects.
 */
export async function getMetarStationsByIcao(icao: ICAO[], options: MetarOptions = {}): Promise<MetarStation[]> {
  const { fetcher = fetch } = options;
  if (!icao.length) {
    return Promise.resolve([]);
  }
  return baseApi(`metar?ids=${icao.map(normalizeICAO).join(',')}&format=json&taf=true`, {}, fetcher);
}

/**
 * Get METAR information for airports within a bounding box.
 *
 * @param bbox - GeoJSON bounding box [west, south, east, north].
 * @returns Promise resolving to an array of MetarStation objects.
 */
export async function getMetarStationsByBbox(bbox: GeoJSON.BBox, options: MetarOptions = {}): Promise<MetarStation[]> {
  const { fetcher = fetch } = options;
  const bboxReversed = [
    parseFloat(bbox[1].toFixed(2)), // south
    parseFloat(bbox[0].toFixed(2)), // west
    parseFloat(bbox[3].toFixed(2)), // north
    parseFloat(bbox[2].toFixed(2))  // east
  ];
  return baseApi(`metar?bbox=${bboxReversed.join(',')}&format=json&taf=true`, {}, fetcher);
}

/** Factory function to create a METAR station provider.
 *
 * @param options - Optional configuration options including a custom fetcher.
 * @returns An object with methods to get METAR data by ICAO codes or bounding box.
 */
export default function metarStationProvider(options: MetarOptions = {}) {
  return {
    getByIcao: (icao: ICAO[]) => getMetarStationsByIcao(icao, options),
    getByBbox: (bbox: GeoJSON.BBox) => getMetarStationsByBbox(bbox, options)
  };
}
