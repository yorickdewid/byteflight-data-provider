// NOTAM Provider (FAA)
export {
  default as notamProvider,
  getNotamsByIcao,
  getNotamsByTransactionId,
  type FAANotamOptions
} from "./faa-notam.js";

// METAR Provider (Aviation Weather)
export {
  default as metarProvider,
  getMetarStationsByIcao,
  getMetarStationsByBbox,
  type MetarOptions
} from "./aviationweather.js";

// Aerodrome Provider (OpenAIP)
export {
  default as aerodromeProvider,
  getAerodromeByIcao,
  getAerodromeByRadius,
  type OpenAipOptions
} from "./openaip.js";

// Common utilities and types
export {
  ApiError
} from "./error.js";

export {
  fetchApi,
  type FetchFunction
} from "./http.js";
