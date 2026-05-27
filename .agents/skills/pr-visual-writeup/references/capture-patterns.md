# Capture Patterns

Recipes for `agent-browser` capture work. Read this when you're about to spawn Phase 2 subagents or run scroll animations yourself.

## Prerequisite: load the agent-browser skill

Before any browser command, the subagent must run:

```bash
agent-browser skills get agent-browser
```

This gives it the CLI's current syntax. Don't guess at flags — they change between versions.

## The capture-subagent prompt pattern

When you spawn a subagent to capture a (theme, viewport) slice, give it a self-contained prompt. It has no memory of the Phase 1 scope; everything must be spelled out.

Template:

```
You are capturing screenshots for PR #<N> of <repo>. Context:

- Dashboard dev URL: http://localhost:<port>     # head port for "after", base-worktree port for "before"
- Branch slice: <before|after>
- Login: click the "<provider>" OAuth button, fill the mock OAuth form with "<email>", submit. The local dashboard creates a session automatically.
- Project to navigate into: <project-name> (click it on /projects after login)
- Routes to capture (relative to the project URL):
    /users          highlight selectors: ["[data-testid=users-table-toolbar]", "section:has(> h2:text('Bulk actions'))"]
    /teams          highlight selectors: []
    ...
- Theme: <light|dark>
- Viewport: <W>x<H>
- Output directory: /tmp/pr-<N>-visuals/shots/
- Highlight new UI: <true|false>     # true ONLY for "after" subagents

For each route:
1. Navigate
2. **Wait for the page to be ready** — run the `wait-for-ready` recipe (below). Networkidle alone is not enough in Next dev mode: the on-demand compiler and skeleton placeholders both finish *after* networkidle.
3. If Highlight new UI is true AND this route has highlight selectors:
     run the pr-visual-highlight injector with this route's selector list
4. Screenshot → /tmp/pr-<N>-visuals/shots/<route-slug>-<before|after>-<theme>.png
    (widescreen variant: ...-<before|after>-<theme>-wide.png)
5. If you injected highlights, remove them before navigating to the next route (so they don't bleed via cached styles): `agent-browser eval "document.getElementById('pr-visual-highlight')?.remove()"`

Before the per-route loop, **warm the routes**: navigate to each one in sequence with a generous `wait-for-ready` budget, then start the real capture loop. The first hit pays the compile cost; the second hit is fast and produces the clean screenshot.

Steps to run first in your session:
- `agent-browser skills get agent-browser`
- `agent-browser --session-name <unique-name> open http://localhost:<port>/`
- Log in (instructions above)
- `agent-browser set viewport <W> <H>`
- Set theme via the "Toggle theme" button (check the root element's class to confirm)

Use a unique --session-name per agent so browser sessions don't collide.
Return the list of screenshots you saved.
```

The `--session-name` must be unique per agent — otherwise multiple agents fight over the same browser profile and cookies.

## Waiting for the page to be ready (`wait-for-ready`)

Screenshots taken too early capture skeletons, the Next.js dev "Compiling..." HUD, or a half-hydrated tree. Don't rely on `networkidle` alone. Run this gate after every navigation:

```bash
agent-browser eval "
  (async () => {
    const deadline = Date.now() + 30000;     // hard ceiling: 30s
    const stable = { count: 0, lastHTML: '' };

    while (Date.now() < deadline) {
      const ready = (() => {
        if (document.readyState !== 'complete') return false;

        // Next.js dev compile indicator — id varies by version; cover both
        if (document.querySelector('#__next-build-watcher, [data-nextjs-dialog]')) return false;
        if (document.body.innerText.match(/^Compiling\b|building\.\.\./i)) return false;

        // Common skeleton / loading affordances
        if (document.querySelector('[data-loading=\"true\"], [aria-busy=\"true\"], .skeleton, [data-state=\"loading\"]')) return false;

        // Tailwind animate-pulse is the de-facto skeleton signal in this codebase
        if (document.querySelector('.animate-pulse')) return false;

        // Pending fetches the app exposes (optional — harmless if undefined)
        if (window.__pendingFetches > 0) return false;

        return true;
      })();

      // Two consecutive stable reads of the rendered HTML body = settled
      const html = document.body.innerHTML.length;
      if (ready && html === stable.lastHTML) stable.count++;
      else { stable.count = 0; stable.lastHTML = html; }
      if (stable.count >= 2) return { ok: true, elapsed: Date.now() - (deadline - 30000) };

      await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, reason: 'timeout', html: document.body.innerHTML.slice(0, 200) };
  })()
"
```

Return contract:

- `{ ok: true, elapsed }` — proceed to screenshot.
- `{ ok: false, reason: 'timeout', html }` — log it, then *still screenshot* (a 30s-stuck page is worth capturing as-is rather than failing the whole pass), but mark the route in the agent's return value so the main agent can decide whether to retry.

Why the two-consecutive-stable-reads check: a single `ready` flicker can land between a skeleton disappearing and the real content swapping in. Two consecutive 250ms ticks with identical body HTML length means the DOM has actually settled.

Tune the skeleton selector list for your codebase. The Hexclave dashboard uses Tailwind `.animate-pulse` extensively for loading rows — that's the highest-signal one. Inspect the diff or the running app once and add any project-specific loading markers (`Spinner` component class, etc.) to the selector list in the subagent prompt rather than guessing.

After `wait-for-ready` returns `ok`, still sleep ~300ms before screenshotting so any final animations (slide-in, fade, etc.) land on their resting frame.

## Red-border highlight injector (`pr-visual-highlight`)

Use this on "after" captures to outline the new UI introduced by the PR. The Phase 1 scope file should list selectors per route — pass them as a JS array.

```bash
agent-browser eval "(() => {
  const selectors = $SELECTORS_JSON;   // e.g. ['[data-testid=foo]', 'section:has(> h2)']
  document.getElementById('pr-visual-highlight')?.remove();
  const style = document.createElement('style');
  style.id = 'pr-visual-highlight';
  style.textContent = selectors.map(s => \`\${s} { outline: 3px solid #ef4444 !important; outline-offset: 2px !important; border-radius: 6px; box-shadow: 0 0 0 1px rgba(239,68,68,0.25) !important; }\`).join('\n');
  document.head.appendChild(style);
  return Array.from(document.querySelectorAll(selectors.join(','))).length;
})()"
```

Notes:

- Use `outline`, not `border`. `border` shifts layout and breaks visual parity with the "before" shot. `outline` paints outside the box and changes nothing else.
- Bright red `#ef4444` (Tailwind `red-500`) reads on both light and dark themes. Don't theme-switch the color — consistency matters more than contrast finesse.
- `!important` on the outline overrides any element-level outline that the app sets on focus/hover.
- The injector returns a count of matched elements. If it returns `0`, your selectors are stale — log a warning and skip highlight for that route rather than ship an "after" shot that looks identical to "before".
- Always remove the `<style id="pr-visual-highlight">` between routes (the injector self-removes on next invocation, but if the next route has `highlight=false` you need to clear it manually).

## Toggling theme reliably

Two approaches, in order of preference:

1. **Click the app's theme button.** Most apps have a visible theme toggle; find its ref via `agent-browser snapshot -i | grep -i 'theme'`. Click it, then verify via `agent-browser eval "document.documentElement.className"` that the expected class is applied.

2. **Set the class directly** (only if no button exists):

   ```bash
   agent-browser eval "(() => { document.documentElement.classList.remove('dark'); document.documentElement.classList.add('light'); localStorage.setItem('theme', 'light'); })()"
   ```

   Direct class manipulation may not trigger app-level theme rehydration and can cause flicker on next navigation. Prefer the button.

## Setting viewport

```bash
agent-browser set viewport 1920 1200   # standard
agent-browser set viewport 2560 1440   # widescreen
```

Set viewport **after** login. Some login flows are responsive and might render differently at large viewports.

## Scroll animations — frame-by-frame recipe

Do NOT use `agent-browser record start/stop` for dev-mode apps — it creates a fresh browser context which typically loses your dev-server session. Use screenshot-per-frame + ffmpeg stitch instead.

### Finding the scroll container

Most dashboard layouts have an internal scroll container (sidebar + fixed header + scrollable main). Don't scroll `window` — find the largest scrollable div:

```bash
agent-browser eval "(() => {
  const el = Array.from(document.querySelectorAll('*')).find(x => {
    const s = getComputedStyle(x);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll')
      && x.scrollHeight > x.clientHeight + 100
      && x.clientHeight > 400;
  });
  window.__SCROLL_EL__ = el;
  if (el) el.scrollTop = 0;
  return !!el;
})()"
```

`window.__SCROLL_EL__` is stashed so subsequent scroll calls are one-liners.

### Capturing frames

```bash
mkdir -p /tmp/frames
i=0
for step in 0 100 200 300 400 500 600 700 800 900; do
  agent-browser eval "(() => { if (window.__SCROLL_EL__) window.__SCROLL_EL__.scrollTop = $step; })()" >/dev/null 2>&1
  sleep 0.15
  fn=$(printf "%03d" $i)
  agent-browser screenshot "/tmp/frames/frame-$fn.png" >/dev/null 2>&1
  i=$((i+1))
done
# Scroll back up
for step in 800 700 600 500 400 300 200 100 0; do
  agent-browser eval "(() => { if (window.__SCROLL_EL__) window.__SCROLL_EL__.scrollTop = $step; })()" >/dev/null 2>&1
  sleep 0.15
  fn=$(printf "%03d" $i)
  agent-browser screenshot "/tmp/frames/frame-$fn.png" >/dev/null 2>&1
  i=$((i+1))
done
```

### Stitch with ffmpeg

```bash
ffmpeg -y -framerate 8 -i /tmp/frames/frame-%03d.png \
  -c:v libvpx-vp9 -crf 32 -b:v 0 /tmp/pr-<N>-visuals/clips/<name>-scroll-<theme>.webm
```

Then in Phase 3, convert `.webm` → `.gif` for gist inline playback.

## Handling dev-server session loss

Browser contexts can lose login state after long idle, certain agent-browser commands, or a restart. When this happens, you'll hit the sign-in page again. Build in a small "if I'm on /sign-in, re-login" check per route, or just re-login once at the start of each subagent and trust the session to last the ~30s of captures.

## Don't try to parallelize within a single subagent

One `agent-browser` session = one navigational context. You can't `open URL-A` and `open URL-B` concurrently in the same session. The parallelism lives between subagents (different `--session-name`), not within.
