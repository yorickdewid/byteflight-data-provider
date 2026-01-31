import { isICAO, normalizeIATA, normalizeICAO, validateFrequencyType, WaypointVariant, type Aerodrome, type Frequency, type ICAO, type Runway } from "flight-planner";
import { fetchApi, type FetchFunction } from "./http.js";
import { capitalizeWords } from "flight-planner/utils";
import { ApiError } from "./error.js";
import { OPENAIP_API_CONFIG, type OpenAipAirportItem, type OpenAipResponse } from "./openaip-config.js";

export interface OpenAipOptions {
  apiKey: string;
  fetcher?: FetchFunction;
}

export interface AerodromeProvider {
  getByIcao(icao: ICAO): Promise<Aerodrome[]>;
  getByIata(iata: string): Promise<Aerodrome[]>;
  getByRadius(location: GeoJSON.Position, distance?: number): Promise<Aerodrome[]>;
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

  const response = await fetchApi(fetcher, `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions);
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError('OpenAIP', `${OPENAIP_API_CONFIG.API_URL}${uri}`, apiOptions, `HTTP ${response.status} - ${response.statusText}`);
  }

  const data = await response.json() as OpenAipResponse<OpenAipAirportItem>;
  if (!data || !data.items || data.items.length === 0) {
    return [];
  }

  // FUTURE: This excludes any aerodromes without an ICAO code
  return data.items.filter((aerodrome) => aerodrome.icaoCode && isICAO(aerodrome.icaoCode)).map((aerodrome) => {
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
      icao: normalizeICAO(aerodrome.icaoCode),
      iata: aerodrome.iataCode ? normalizeIATA(aerodrome.iataCode) : undefined,
      name: capitalizeWords(aerodrome.name),
      coords: aerodrome.geometry.coordinates,
      elevation,
      declination: aerodrome.magneticDeclination,
      runways,
      frequencies,
      ppr: aerodrome.ppr,
      waypointVariant: WaypointVariant.Aerodrome
    };
  });
}

/**
 * Get aerodrome information for a specific ICAO code.
 *
 * @param icao - ICAO airport code.
 * @returns Promise resolving to an array of Aerodrome objects.
 */
export async function getAerodromeByIcao(icao: ICAO, options: OpenAipOptions): Promise<Aerodrome[]> {
  const { fetcher = fetch, apiKey } = options;
  return baseApi(`airports?search=${encodeURIComponent(icao)}&limit=${OPENAIP_API_CONFIG.SEARCH_LIMIT}`, apiKey, {}, fetcher);
}

/**
 * Get aerodrome information for a specific IATA code.
 *
 * @param iata - IATA airport code.
 * @returns Promise resolving to an array of Aerodrome objects.
 */
export async function getAerodromeByIata(iata: string, options: OpenAipOptions): Promise<Aerodrome[]> {
  const { fetcher = fetch, apiKey } = options;
  return baseApi(`airports?search=${encodeURIComponent(iata)}&limit=${OPENAIP_API_CONFIG.SEARCH_LIMIT}`, apiKey, {}, fetcher);
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
  if (distance <= 0) {
    throw new Error("Distance must be a positive number");
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
export default function aerodromeProvider(options: OpenAipOptions): AerodromeProvider {
  return {
    getByIcao: (icao: ICAO) => getAerodromeByIcao(icao, options),
    getByIata: (iata: string) => getAerodromeByIata(iata, options),
    getByRadius: (location: GeoJSON.Position, distance?: number) => getAerodromeByRadius(location, distance, options)
  };
}
