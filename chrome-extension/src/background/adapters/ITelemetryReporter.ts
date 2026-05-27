export interface ITelemetryReporter {
  track(event: string, properties?: Record<string, any>): void;
  trackError(error: Error, properties?: Record<string, any>): void;
}
