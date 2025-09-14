export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_USER_AGENT = 'ByteFlight/1.0';

/**
 * Performs a fetch operation using a provided fetcher function.
 *
 * @param fetcher The fetch-compatible function to use for the request.
 * @param baseUrl The URL to fetch.
 * @param options Standard RequestInit options, potentially including a custom 'timeout'.
 *                If the fetcher is Cloudflare's, 'cf' can be included in options.
 * @returns A Promise resolving to the fetch Response.
 * @throws Will throw an error if the request times out or fails.
 */
export const fetchApi = async (
  fetcher: FetchFunction,
  baseUrl: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> => {
  const { timeout, ...standardFetcherOptions } = options;

  // Set defaults if not provided
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    ...standardFetcherOptions.headers
  };

  const optionsWithHeaders = { ...standardFetcherOptions, headers };

  if (timeout) {
    const controller = new AbortController();
    const signal = controller.signal;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const optionsWithSignal: RequestInit = { ...optionsWithHeaders, signal };

    try {
      return await fetcher(baseUrl, optionsWithSignal);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return fetcher(baseUrl, optionsWithHeaders);
};
