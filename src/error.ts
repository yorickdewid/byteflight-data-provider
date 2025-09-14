export class ApiError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly endpoint: string,
    public readonly requestOptions?: RequestInit & { timeout?: number; cf?: object },
    public readonly cause?: unknown
  ) {
    const message = `${serviceName} API request failed for endpoint: ${endpoint}`;
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Get a formatted error message including all context
   */
  getDetailedMessage(): string {
    let details = `${this.message}`;

    if (this.requestOptions?.method) {
      details += `\nMethod: ${this.requestOptions.method}`;
    }

    if (this.requestOptions?.timeout) {
      details += `\nTimeout: ${this.requestOptions.timeout}ms`;
    }

    if (this.cause) {
      details += `\nCause: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
    }

    return details;
  }
}
