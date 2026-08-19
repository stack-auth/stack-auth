const TV_PRESENTATION_PATH = /^\/projects\/[^/]+\/tv-mode\/present\/[^/]+\/?$/;

export function isTvPresentationPath(pathname: string): boolean {
  return TV_PRESENTATION_PATH.test(pathname);
}
