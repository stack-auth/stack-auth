import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/demo/start/ssr/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div>
      <h1>SSR Demos</h1>
      <ul>
        <li>
          <Link to="/demo/start/ssr/spa-mode">SPA Mode</Link>
        </li>
        <li>
          <Link to="/demo/start/ssr/full-ssr">Full SSR</Link>
        </li>
        <li>
          <Link to="/demo/start/ssr/data-only">Data Only</Link>
        </li>
      </ul>
    </div>
  )
}
