import { createMetarFromString, normalizeICAO, type ICAO, type MetarStation } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { ApiError } from "./error.js";

/**
 * Aviation weather METAR data operations
 */
export class Metar {
  private static readonly API_URL = 'https://aviationweather.gov/api/data/';
  private static readonly CACHE_TTL = 60; // 1 minute for weather data
  private static readonly TIMEOUT = 5000; // 5 seconds
  private static readonly COORDINATE_PRECISION = 2;

  constructor(private fetcher: FetchFunction) { }

  /**
   * Base API function for fetching METAR data.
   *
   * @param uri - The URI path to append to the base URL.
   * @returns Promise resolving to an array of MetarStation objects.
   * @throws Will throw an error if the API request fails.
   */
  private async baseApi(uri: string): Promise<MetarStation[]> {
    const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
      cf: {
        cacheTtl: Metar.CACHE_TTL,
        cacheEverything: true,
      },
      timeout: Metar.TIMEOUT
    };

    try {
      // TODO: Map the return type
      const response = await fetchApi(this.fetcher, `${Metar.API_URL}${uri}`, apiOptions);
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
      console.error('METAR API error:', error);
      throw new ApiError('METAR API', `${Metar.API_URL}${uri}`, apiOptions, error);
    }
  }

  /**
   * Get METAR information for specific ICAO codes.
   *
   * @param icao - Array of ICAO airport codes.
   * @returns Promise resolving to an array of MetarStation objects.
   */
  public getIcao(icao: ICAO[]): Promise<MetarStation[]> {
    if (!icao.length) {
      return Promise.resolve([]);
    }
    return this.baseApi(`metar?ids=${icao.join(',')}&format=json&taf=true`);
  }

  /**
   * Get METAR information for airports within a bounding box.
   *
   * @param bbox - GeoJSON bounding box [west, south, east, north].
   * @returns Promise resolving to an array of MetarStation objects.
   */
  public getBbox(bbox: GeoJSON.BBox): Promise<MetarStation[]> {
    const bboxReversed = [
      parseFloat(bbox[1].toFixed(Metar.COORDINATE_PRECISION)), // south
      parseFloat(bbox[0].toFixed(Metar.COORDINATE_PRECISION)), // west
      parseFloat(bbox[3].toFixed(Metar.COORDINATE_PRECISION)), // north
      parseFloat(bbox[2].toFixed(Metar.COORDINATE_PRECISION))  // east
    ];
    return this.baseApi(`metar?bbox=${bboxReversed.join(',')}&format=json&taf=true`);
  }
}
