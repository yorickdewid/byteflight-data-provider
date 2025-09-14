import { isICAO, normalizeIATA, normalizeICAO, validateFrequencyType, WaypointVariant, type Aerodrome, type Frequency, type ICAO, type Runway } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { capitalizeWords } from "flight-planner/utils";
import { ApiError } from "./error.js";
import { point } from "@turf/turf";

/**
 * OpenAIP airport data operations
 */
export class OpenAip {
  private static readonly API_URL = 'https://api.core.openaip.net/api/';
  private static readonly CACHE_TTL = 3600 * 24 * 7; // 1 week for airport data
  private static readonly TIMEOUT = 10000; // 10 seconds
  private static readonly SEARCH_LIMIT = 1;
  private static readonly RADIUS_LIMIT = 200;
  private static readonly DEFAULT_RADIUS_KM = 50;
  private static readonly COORDINATE_PRECISION = 2;
  private static readonly METERS_TO_FEET = 3.28084;
  private static readonly KM_TO_METERS = 1_000;

  // OpenAIP airport types for radius search
  private static readonly AIRPORT_TYPES = [0, 1, 2, 3, 9, 5] as const;

  constructor(private fetcher: FetchFunction, private apiKey: string) { }

  /**
   * Base API function for fetching OpenAIP data.
   *
   * @param uri - The URI path to append to the base URL.
   * @returns Promise resolving to an array of Aerodrome objects.
   * @throws Will throw an error if the API request fails.
   */
  private async baseApi(uri: string): Promise<Aerodrome[]> {
    const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
      headers: {
        "x-openaip-api-key": this.apiKey,
      },
      cf: {
        cacheTtl: OpenAip.CACHE_TTL,
        cacheEverything: true,
      },
      timeout: OpenAip.TIMEOUT
    };

    try {
      // TODO: Map the return type
      const response = await fetchApi(this.fetcher, `${OpenAip.API_URL}${uri}`, apiOptions);
      if (!response.ok) {
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
        const elevation = (aerodrome.elevation && aerodrome.elevation.unit === 0 && aerodrome.elevation.referenceDatum === 1) ? aerodrome.elevation.value * OpenAip.METERS_TO_FEET : undefined;

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
      console.error('OpenAIP API error:', error);
      throw new ApiError('OpenAIP API', `${OpenAip.API_URL}${uri}`, apiOptions, error);
    }
  }

  /**
   * Get aerodrome information for a specific ICAO code.
   *
   * @param icao - ICAO airport code.
   * @returns Promise resolving to an array of Aerodrome objects.
   */
  public getIcao(icao: ICAO): Promise<Aerodrome[]> {
    return this.baseApi(`airports?search=${icao}&limit=${OpenAip.SEARCH_LIMIT}`);
  }

  /**
   * Get aerodrome information for airports within a radius from a location.
   *
   * @param location - GeoJSON Position [longitude, latitude].
   * @param distance - Distance in kilometers (default: 50).
   * @returns Promise resolving to an array of Aerodrome objects.
   * @throws Will throw an error if distance is negative or location format is invalid.
   */
  public getRadius(location: GeoJSON.Position, distance: number = OpenAip.DEFAULT_RADIUS_KM): Promise<Aerodrome[]> {
    if (distance < 0) {
      throw new Error("Distance must be greater than 0");
    }
    if (location.length !== 2) {
      throw new Error("Location must be a 2D coordinate");
    }

    const distanceInMeters = distance * OpenAip.KM_TO_METERS;
    const lat = parseFloat(location[1].toFixed(OpenAip.COORDINATE_PRECISION));
    const lon = parseFloat(location[0].toFixed(OpenAip.COORDINATE_PRECISION));

    const typeParams = OpenAip.AIRPORT_TYPES.map(type => `type=${type}`).join('&');
    return this.baseApi(`airports?pos=${lat},${lon}&dist=${distanceInMeters}&${typeParams}&limit=${OpenAip.RADIUS_LIMIT}`);
  }
}
