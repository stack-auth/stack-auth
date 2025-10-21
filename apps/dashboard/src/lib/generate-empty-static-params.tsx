/**
 * So. Next.js has a weird default behavior where it never makes a page static if it has a dynamic param, unless you
 * specify `generateStaticParams` or `force-static`. The former is the preferred way to do this.
 *
 * I don't know why, I complained about it [here](https://github.com/vercel/next.js/issues/84944#issuecomment-3425227196),
 * and my best guess is that it is kinda unintentional (although it is "intended", but it doesn't seem like a good
 * behavior).
 *
 * Anyways, we fix this by just returning an empty array from every page, which will automatically opt-in to the
 * much better default. If a page doesn't have generateStaticParams, it'll just take it from the nearest layout instead,
 * so it's sufficient to do this in the layouts.
 *
 * Ask Konsti if you need more help.
 */
export function generateStaticParams() {
  return [];
}
