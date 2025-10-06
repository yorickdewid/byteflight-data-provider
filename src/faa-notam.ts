import { ICAO, Notam, NotamType, NotamScope, NotamPriority } from "flight-planner";
import { ApiError } from "./error.js";
import { fetchApi, type FetchFunction } from "./http.js";

const FAA_API_CONFIG = {
  API_URL: 'https://notams.aim.faa.gov/notamSearch/',
  CACHE_TTL: 3600 * 24, // 24 hours
  TIMEOUT: 5000, // 5 seconds
} as const;

export interface FAANotamOptions {
  fetcher?: FetchFunction;
}

export interface NotamProvider {
  getByIcao(icao: ICAO): Promise<Notam[]>;
  getByTransactionId(transactionId: number): Promise<Notam | null>;
}

// TODO: We need to parse timezones properly
/**
 * Parse NOTAM date format (MM/DD/YYYY HHMM) to Date object
 *
 * @param dateString - Date string in format "09/11/2025 1707"
 * @returns Parsed Date object or undefined if invalid
 */
function parseNotamDate(dateString: string): Date | undefined {
  if (!dateString) {
    return undefined;
  }

  // Match format: MM/DD/YYYY HHMM
  const match = dateString.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{4})$/);
  if (!match) {
    return undefined;
  }

  const [, month, day, year, time] = match;
  const hours = parseInt(time.substring(0, 2), 10);
  const minutes = parseInt(time.substring(2, 4), 10);

  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // Month is 0-indexed
    parseInt(day, 10),
    hours,
    minutes
  );
}

/**
 * Parse WKT POINT format or array string to coordinates object
 *
 * @param pointString - WKT point string in format "POINT(longitude latitude)" or array string "[-73.7816305555556,40.6494194444444]"
 * @returns Coordinates object with latitude and longitude or undefined if invalid
 */
function parsePoint(pointString: string): { latitude: number; longitude: number } | undefined {
  if (!pointString) {
    return undefined;
  }

  // Try to parse as array string format: "[-73.7816305555556,40.6494194444444]"
  const arrayMatch = pointString.match(/^\[([+-]?\d*\.?\d+),([+-]?\d*\.?\d+)\]$/);
  if (arrayMatch) {
    const [, longitude, latitude] = arrayMatch;
    const lon = parseFloat(longitude);
    const lat = parseFloat(latitude);

    // Validate coordinate ranges
    if (isNaN(lon) || isNaN(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return undefined;
    }

    return {
      latitude: lat,
      longitude: lon
    };
  }

  // Try to parse as WKT POINT format: POINT(longitude latitude)
  const wktMatch = pointString.match(/^POINT\(([+-]?\d*\.?\d+)\s+([+-]?\d*\.?\d+)\)$/);
  if (wktMatch) {
    const [, longitude, latitude] = wktMatch;
    const lon = parseFloat(longitude);
    const lat = parseFloat(latitude);

    // Validate coordinate ranges
    if (isNaN(lon) || isNaN(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return undefined;
    }

    return {
      latitude: lat,
      longitude: lon
    };
  }

  return undefined;
}

/**
 * Replace newlines with spaces, trim whitespace, and expand common NOTAM abbreviations
 *
 * @param text - Input text
 * @returns Processed text with expanded abbreviations
 */
function parseText(text: string): string {
  if (!text) {
    return '';
  }

  let processedText = text.replace(/\n/g, ' ').trim();

  const abbreviations: Record<string, string> = {
    // Airport/Airfield
    'AD': 'aerodrome',
    'AFTN': 'aeronautical fixed telecommunication network',
    'AGL': 'above ground level',
    'AMSL': 'above mean sea level',
    'APCH': 'approach',
    'APT': 'airport',
    'ARPT': 'airport',

    // Air Traffic Control
    'TWR': 'tower',
    'GND': 'ground',
    'APP': 'approach',
    'DEP': 'departure',

    // Runway/Taxiway
    'RWY': 'runway',
    'TWY': 'taxiway',
    'TKOF': 'takeoff',
    'LDG': 'landing',
    'CLSD': 'closed',
    'AVBL': 'available',
    'REQ': 'request',
    'BTN': 'between',

    // Time/Duration
    'LCL': 'local',
    'FM': 'from',
    'TIL': 'until',
    'PERM': 'permanent',
    'TEMP': 'temporary',
    'DLY': 'daily',
    'WEF': 'with effect from',
    'APPX': 'approximately',

    // Weather/Conditions
    'WX': 'weather',
    'VIS': 'visibility',
    'OBSCN': 'obscuration',
    'FG': 'fog',
    'BR': 'mist',
    'RA': 'rain',
    'SN': 'snow',
    'TS': 'thunderstorm',

    // Operations
    'OPR': 'operate/operating',
    'OPNL': 'operational',
    'INOP': 'inoperative',
    'U/S': 'unserviceable',
    'MAINT': 'maintenance',
    'CONST': 'construction',
    'WIP': 'work in progress',
    'OBST': 'obstacle',

    // Equipment/Systems
    'EQPT': 'equipment',
    'SYS': 'system',
    'PWR': 'power',
    'ELEC': 'electrical',
    'LGTG': 'lighting',
    'REIL': 'runway end identifier lights',
    'LGTD': 'lighted',

    // Military/Restricted
    'MIL': 'military',

    // Common operational terms
    'ACFT': 'aircraft',
    'ALT': 'altitude',
    'FL': 'flight level',
    'FT': 'feet',
    'NM': 'nautical miles',
    'KT': 'knots',
    'DEG': 'degrees',
    'MAG': 'magnetic',
    'TRUE': 'true',
    'VAR': 'variation',

    // Communications
    'FREQ': 'frequency',
    'MHZ': 'megahertz',
    'KHZ': 'kilohertz',
    'COM': 'communication',
    'RAD': 'radio',
    'TEL': 'telephone'
  };

  for (const [abbrev, expansion] of Object.entries(abbreviations)) {
    const regex = new RegExp(`\\b${abbrev}\\b`, 'gi');
    processedText = processedText.replace(regex, expansion);
  }

  return processedText.replace(/\s+/g, ' ').trim().toLocaleUpperCase();
}

/**
 * Transform FAA NOTAM data to standard Notam format
 *
 * @param notam - Raw FAA NOTAM data object
 * @returns Transformed Notam object
 */
function transformNotamData(notam: any): Notam {
  return {
    id: notam.notamNumber || '',
    icao: notam.icaoId || undefined,
    type: NotamType.A, // FAA NOTAMs are typically all "A" type
    scope: NotamScope.A, // Assume all are "A" scope for simplicity
    priority: NotamPriority.NORMAL, // Default to normal priority
    subject: '', // FAA NOTAMs do not have a distinct subject field
    text: parseText(notam.traditionalMessageFrom4thWord || notam.traditionalMessage || ''),
    coordinates: notam.notamGeometry ? parsePoint(notam.notamGeometry) : notam.mapPointer ? parsePoint(notam.mapPointer) : undefined,
    schedule: {
      effectiveFrom: parseNotamDate(notam.startDate) || new Date(),
      effectiveUntil: parseNotamDate(notam.endDate),
    },
    source: notam.source || undefined,
    raw: notam.icaoMessage,
    issued: parseNotamDate(notam.issueDate) || new Date(),
  };
}

/**
 * Core API request function
 *
 * @param uri - API endpoint URI
 * @param options - Fetch options
 * @param fetcher - Custom fetch function
 * @returns Promise resolving to an array of NOTAM objects
 */
async function baseApi(
  uri: string,
  options: RequestInit = {},
  fetcher: FetchFunction = fetch
): Promise<Notam[]> {
  const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
    ...options,
    cf: {
      cacheTtl: FAA_API_CONFIG.CACHE_TTL,
      cacheEverything: true,
    },
    timeout: FAA_API_CONFIG.TIMEOUT
  };

  try {
    const response = await fetchApi(fetcher, `${FAA_API_CONFIG.API_URL}${uri}`, apiOptions);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Request failed with status: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      await response.body?.cancel();
      throw new Error(`Returned non-JSON response: ${contentType}`);
    }

    const data = await response.json() as any;
    if (data && data.notamList && Array.isArray(data.notamList)) {
      if (data.notamList.length === 0) {
        return [];
      }
      return data.notamList.map(transformNotamData);
    }

    if (data && (data.icaoMessage || data.traditionalMessageFrom4thWord || data.traditionalMessage)) {
      return [transformNotamData(data)];
    }

    return [];
  } catch (error) {
    throw new ApiError('FAA NOTAM', `${FAA_API_CONFIG.API_URL}${uri}`, apiOptions, error);
  }
}

/**
 * Get NOTAMs for a specific ICAO code.
 *
 * @param icao - ICAO airport code.
 * @param options - Optional configuration including custom fetcher
 * @returns Promise resolving to an array of NOTAM objects.
 */
export async function getNotamsByIcao(icao: ICAO, options: FAANotamOptions = {}): Promise<Notam[]> {
  const { fetcher = fetch } = options;
  const formData = `searchType=0&designatorsForLocation=${icao}&radius=10&sortColumns=5+false&sortDirection=true&offset=0`;

  return baseApi('search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  }, fetcher);
}

/**
 * Get NOTAM for a specific transaction ID.
 *
 * @param transactionId - NOTAM transaction ID.
 * @param options - Optional configuration including custom fetcher
 * @returns Promise resolving to a single NOTAM object or null if not found.
 */
export async function getNotamsByTransactionId(transactionId: number, options: FAANotamOptions = {}): Promise<Notam | null> {
  const { fetcher = fetch } = options;
  const notams = await baseApi(`details?transactionid=${transactionId}`, {}, fetcher);
  return notams.length > 0 ? notams[0] : null;
}

/**
 * FAA NOTAM Provider
 *
 * @param options - Optional configuration including custom fetcher
 * @returns Object with methods to get NOTAMs by ICAO or transaction ID
 */
export default function notamProvider(options: FAANotamOptions = {}): NotamProvider {
  return {
    getByIcao: (icao: ICAO) => getNotamsByIcao(icao, options),
    getByTransactionId: (transactionId: number) => getNotamsByTransactionId(transactionId, options),
  };
}
