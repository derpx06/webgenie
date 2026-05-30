export interface ITelemetryReporter {
  track(event: string, properties?: Record<string, unknown>): void;
  trackError(error: Error, properties?: Record<string, unknown>): void;
}
