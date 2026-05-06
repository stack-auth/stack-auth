# Capture patterns

Reconstructed from SKILL.md hints — edit freely to match your own `agent-browser` or Playwright setup.

## Subagent prompt pattern (per theme/viewport)

Each subagent owns a named browser session and handles the full capture pass for one `(theme, viewport)` combination. Name the session so it's distinct from the main conversation's session and from sibling subagents — e.g. `pr<N>-light-standard`.

Template:

```
You are capturing screenshots for PR #<N> in the <theme> theme at <WxH> viewport.

Scope (from /tmp/pr-<N>-visuals/scope.md):
- Dev server: http://localhost:<port>
- Login: <email> via mock-OAuth at <sign-in path>
- Pages (relative URLs):
  - /projects/<projectId>/<route-1>
  - /projects/<projectId>/<route-2>
  - ...

Do this:
1. Start (or reuse) an agent-browser session named "pr<N>-<theme>-<viewport>".
2. Set viewport to <WxH>.
3. Navigate to the sign-in page and complete the mock-OAuth flow once.
4. Switch the app theme to "<theme>" (usually a dropdown in user settings, or
   the `prefers-color-scheme` override in devtools — inspect the app first).
5. For each page in the list: navigate, wait for network-idle + any late-mount
   skeletons to settle (~1s extra), then take a full-page screenshot.
   Save as /tmp/pr-<N>-visuals/shots/<route-slug>__<theme>__<viewport>.png
   where route-slug replaces slashes with dashes.
6. Return the list of PNG paths you produced.

Do NOT:
- Close the browser session at the end (other subagents may be using it, and
  re-login is wasteful).
- Use agent-browser's `record` action — it spins up a fresh context that
  drops dev-mode auth state. For scroll clips see the frame-stitch recipe.
```

Spawn all subagents (one per theme/viewport combination) in a **single assistant message** with multiple `Agent` tool calls. If you send them across turns, you serialize the work and lose the parallelism that justifies the skill.

## Scroll animation recipe (frame-stitch)

`agent-browser record` opens a new browser context, which doesn't inherit your dev-session cookies — the recording lands on the login page. Work around this by taking a burst of screenshots at the current session instead:

```
In session pr<N>-<theme>-<viewport>:
1. Navigate to the target page, wait for settle.
2. window.scrollTo(0, 0).
3. Loop: take screenshot -> scroll by (viewport_height * 0.8) -> sleep 120ms.
   Stop when document.scrollingElement.scrollTop stops increasing.
4. Loop back up symmetrically (optional, nicer).
5. Save frames as /tmp/pr-<N>-visuals/clips/<slug>__<theme>/frame-####.png
```

Stitch with ffmpeg:

```bash
ffmpeg -y -framerate 8 -i /tmp/.../clips/<slug>__<theme>/frame-%04d.png \
  -c:v libvpx-vp9 -b:v 0 -crf 40 \
  /tmp/.../clips/<slug>__<theme>.webm
```

Then `scripts/convert_clips.sh` turns the webm into a gist-friendly GIF.

## Picking the page matrix

- **Full matrix** (every page × every theme × standard viewport): always — this is the bread-and-butter comparison reviewers actually read.
- **Wide viewport** (2560×1440): only the 3–5 flagship pages. The point of wide is to show layout behavior under extra horizontal space, which most pages handle trivially.
- **Scroll animations**: only pages with meaningful vertical content — tables with many rows, sticky headers, settings with lots of sections. A static screenshot of a 3-field form is fine.

If the PR touches 15+ pages, pick ~5 flagships for the hero section and put the rest in a compact "other migrated surfaces" table.
