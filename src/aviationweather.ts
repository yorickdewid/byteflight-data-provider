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

export interface MetarStationProvider {
  getByIcao(icao: ICAO[], date?: Date): Promise<MetarStation[]>;
  getByBbox(bbox: GeoJSON.BBox, date?: Date): Promise<MetarStation[]>;
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
    if (response.status === 204) {
      throw new ApiError('METAR', `${AVIATIONWEATHER_API_CONFIG.API_URL}${uri}`, apiOptions, 'No Content');
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError('METAR', `${AVIATIONWEATHER_API_CONFIG.API_URL}${uri}`, apiOptions, `HTTP ${response.status} - ${response.statusText}`);
    }

    const data = await response.json() as unknown[];
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
    throw new ApiError('METAR', `${AVIATIONWEATHER_API_CONFIG.API_URL}${uri}`, apiOptions, error);
  }
}

/**
 * Get date parameter for recent dates within a specified range.
 *
 * @param date - The date to validate and format.
 * @param days - The number of days in the recent range (default is 30).
 * @returns Formatted date parameter string or empty string if no date provided.
 * @throws Will throw an error if the date is outside the recent range.
 */
const getRecentDateParam = (date?: Date, days: number = 30): string => {
  if (!date) { return '' };

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - days);

  if (date < thirtyDaysAgo || date > now) {
    throw new Error(`Date must be within the last ${days} days`);
  }

  return `&date=${date.toISOString()}`;
};

/**
 * Get METAR information for specific ICAO codes.
 *
 * @param icao - Array of ICAO airport codes.
 * @param date - Optional date to fetch METARs for a specific time.
 * @returns Promise resolving to an array of MetarStation objects.
 */
export async function getMetarStationsByIcao(icao: ICAO[], date?: Date, options: MetarOptions = {}): Promise<MetarStation[]> {
  const { fetcher = fetch } = options;
  if (!icao.length) { return Promise.resolve([]); }

  const dateParam = getRecentDateParam(date);
  return baseApi(`metar?ids=${icao.map(normalizeICAO).join(',')}&format=json&taf=true${dateParam}`, {}, fetcher);
}

/**
 * Get METAR information for airports within a bounding box.
 *
 * @param bbox - GeoJSON bounding box [west, south, east, north].
 * @param date - Optional date to fetch METARs for a specific time.
 * @returns Promise resolving to an array of MetarStation objects.
 */
export async function getMetarStationsByBbox(bbox: GeoJSON.BBox, date?: Date, options: MetarOptions = {}): Promise<MetarStation[]> {
  const { fetcher = fetch } = options;
  const bboxReversed = [
    parseFloat(bbox[1].toFixed(2)), // south
    parseFloat(bbox[0].toFixed(2)), // west
    parseFloat(bbox[3].toFixed(2)), // north
    parseFloat(bbox[2].toFixed(2))  // east
  ];

  const dateParam = getRecentDateParam(date);
  return baseApi(`metar?bbox=${bboxReversed.join(',')}&format=json&taf=true${dateParam}`, {}, fetcher);
}

/** Factory function to create a METAR station provider.
 *
 * @param options - Optional configuration options including a custom fetcher.
 * @returns An object with methods to get METAR data by ICAO codes or bounding box.
 */
export default function metarStationProvider(options: MetarOptions = {}): MetarStationProvider {
  return {
    getByIcao: (icao: ICAO[], date?: Date) => getMetarStationsByIcao(icao, date, options),
    getByBbox: (bbox: GeoJSON.BBox, date?: Date) => getMetarStationsByBbox(bbox, date, options)
  };
}
