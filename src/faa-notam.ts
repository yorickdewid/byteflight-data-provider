import { ICAO, Notam, NotamType, NotamScope, NotamPriority, normalizeICAO, isICAO } from "flight-planner";
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
  getRawByIcao(icao: ICAO): Promise<any[]>;
  getRawByTransactionId(transactionId: number): Promise<any>;
}

/**
 * Parse NOTAM date format (MM/DD/YYYY HHMM) to Date object in UTC
 *
 * @param dateString - Date string in format "09/11/2025 1707" (assumed UTC)
 * @returns Parsed Date object in UTC or undefined if invalid
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

  return new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // Month is 0-indexed
    parseInt(day, 10),
    hours,
    minutes
  ));
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
    'AD': 'AERODROME',
    'AFTN': 'AERONAUTICAL FIXED TELECOMMUNICATION NETWORK',
    'AGL': 'ABOVE GROUND LEVEL',
    'AMSL': 'ABOVE MEAN SEA LEVEL',
    'APCH': 'APPROACH',
    'APT': 'AIRPORT',
    'ARPT': 'AIRPORT',

    // Air Traffic Control
    'TWR': 'TOWER',
    'GND': 'GROUND',
    'APP': 'APPROACH',
    'DEP': 'DEPARTURE',

    // Runway/Taxiway
    'RWY': 'RUNWAY',
    'TWY': 'TAXIWAY',
    'TKOF': 'TAKEOFF',
    'LDG': 'LANDING',
    'CLSD': 'CLOSED',
    'AVBL': 'AVAILABLE',
    'REQ': 'REQUEST',
    'BTN': 'BETWEEN',

    // Time/Duration
    'LCL': 'LOCAL',
    'FM': 'FROM',
    'TIL': 'UNTIL',
    'PERM': 'PERMANENT',
    'TEMP': 'TEMPORARY',
    'DLY': 'DAILY',
    'WEF': 'WITH EFFECT FROM',
    'APPX': 'APPROXIMATELY',

    // Weather/Conditions
    'WX': 'WEATHER',
    'VIS': 'VISIBILITY',
    'OBSCN': 'OBSCURATION',
    'FG': 'FOG',
    'BR': 'MIST',
    'RA': 'RAIN',
    'SN': 'SNOW',
    'TS': 'THUNDERSTORM',

    // Operations
    'OPR': 'OPERATE/OPERATING',
    'OPNL': 'OPERATIONAL',
    'INOP': 'INOPERATIVE',
    'U/S': 'UNSERVICEABLE',
    'MAINT': 'MAINTENANCE',
    'CONST': 'CONSTRUCTION',
    'WIP': 'WORK IN PROGRESS',
    'OBST': 'OBSTACLE',

    // Equipment/Systems
    'EQPT': 'EQUIPMENT',
    'SYS': 'SYSTEM',
    'PWR': 'POWER',
    'ELEC': 'ELECTRICAL',
    'LGTG': 'LIGHTING',
    'REIL': 'RUNWAY END IDENTIFIER LIGHTS',
    'LGTD': 'LIGHTED',

    // Military/Restricted
    'MIL': 'MILITARY',

    // Common operational terms
    'ACFT': 'AIRCRAFT',
    'ALT': 'ALTITUDE',
    'FL': 'FLIGHT LEVEL',
    'FT': 'FEET',
    'NM': 'NAUTICAL MILES',
    'KT': 'KNOTS',
    'DEG': 'DEGREES',
    'MAG': 'MAGNETIC',
    'TRUE': 'TRUE',
    'VAR': 'VARIATION',

    // Communications
    'FREQ': 'FREQUENCY',
    'MHZ': 'MEGAHERTZ',
    'KHZ': 'KILOHERTZ',
    'COM': 'COMMUNICATION',
    'RAD': 'RADIO',
    'TEL': 'TELEPHONE'
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
    icao: isICAO(notam.icaoId) ? normalizeICAO(notam.icaoId) : undefined,
    type: NotamType.A, // FAA NOTAMs are typically all "A" type
    scope: NotamScope.A, // Assume all are "A" scope for simplicity
    priority: NotamPriority.NORMAL, // Default to normal priority
    subject: '', // FAA NOTAMs do not have a distinct subject field
    text: parseText(notam.traditionalMessageFrom4thWord || notam.traditionalMessage || notam.icaoMessage), // TODO: Rename to message. Make optional in interface
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
 * Core API request function for raw data
 *
 * @param uri - API endpoint URI
 * @param options - Fetch options
 * @param fetcher - Custom fetch function
 * @returns Promise resolving to raw API response data
 */
async function baseApiRaw(
  uri: string,
  options: RequestInit = {},
  fetcher: FetchFunction = fetch
): Promise<any> {
  const apiOptions: RequestInit & { timeout?: number; cf?: object } = {
    ...options,
    cf: {
      cacheTtl: FAA_API_CONFIG.CACHE_TTL,
      cacheEverything: true,
    },
    timeout: FAA_API_CONFIG.TIMEOUT
  };

  const response = await fetchApi(fetcher, `${FAA_API_CONFIG.API_URL}${uri}`, apiOptions);
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError('FAA NOTAM', `${FAA_API_CONFIG.API_URL}${uri}`, apiOptions, `HTTP ${response.status} - ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const body = await response.text();
    throw new ApiError('FAA NOTAM', `${FAA_API_CONFIG.API_URL}${uri}`, apiOptions, `Returned non-JSON response: ${contentType}, body: ${body}`);
  }

  return await response.json();
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
  const data = await baseApiRaw(uri, options, fetcher);

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
 * Get raw NOTAMs for a specific ICAO code without transformation.
 *
 * @param icao - ICAO airport code.
 * @param options - Optional configuration including custom fetcher
 * @returns Promise resolving to an array of raw NOTAM objects.
 */
export async function getRawNotamsByIcao(icao: ICAO, options: FAANotamOptions = {}): Promise<any[]> {
  const { fetcher = fetch } = options;
  const formData = `searchType=0&designatorsForLocation=${icao}&radius=10&sortColumns=5+false&sortDirection=true&offset=0`;

  const data = await baseApiRaw('search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  }, fetcher);

  if (data && data.notamList && Array.isArray(data.notamList)) {
    return data.notamList;
  }

  if (data && (data.icaoMessage || data.traditionalMessageFrom4thWord || data.traditionalMessage)) {
    return [data];
  }

  return [];
}

/**
 * Get raw NOTAM for a specific transaction ID without transformation.
 *
 * @param transactionId - NOTAM transaction ID.
 * @param options - Optional configuration including custom fetcher
 * @returns Promise resolving to raw NOTAM data or null if not found.
 */
export async function getRawNotamsByTransactionId(transactionId: number, options: FAANotamOptions = {}): Promise<any> {
  const { fetcher = fetch } = options;
  const data = await baseApiRaw(`details?transactionid=${transactionId}`, {}, fetcher);

  if (data && data.notamList && Array.isArray(data.notamList)) {
    return data.notamList.length > 0 ? data.notamList[0] : null;
  }

  if (data && (data.icaoMessage || data.traditionalMessageFrom4thWord || data.traditionalMessage)) {
    return data;
  }

  return null;
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
    getRawByIcao: (icao: ICAO) => getRawNotamsByIcao(icao, options),
    getRawByTransactionId: (transactionId: number) => getRawNotamsByTransactionId(transactionId, options),
  };
}
