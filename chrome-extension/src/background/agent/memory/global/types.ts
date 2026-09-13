/** One step of a route that worked: the page and the kind of element, never text the user wrote or the page showed. */
export interface RouteStep {
  host: string;
  /** Path template: segments with ids or the user's words are `:n`. */
  path: string;
  action: string;
  /** Element role or tag, and input type. */
  target?: string;
}

export interface SavedRoute {
  /** Origin and path template of the page the task started on. */
  key: string;
  steps: RouteStep[];
  savedAt: number;
}
