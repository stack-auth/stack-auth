import { Link } from '@tanstack/react-router'

import './Header.css'

export default function Header() {
  return (
    <header className="header">
      <nav className="nav">
        <div className="nav-item">
          <Link to="/">Home</Link>
        </div>

        <div className="px-2 font-bold">
          <Link to="/demo/start/server-funcs">Start - Server Functions</Link>
        </div>

        <div className="px-2 font-bold">
          <Link to="/demo/start/api-request">Start - API Request</Link>
        </div>

        <div className="px-2 font-bold">
          <Link to="/demo/start/ssr">Start - SSR Demos</Link>
        </div>
      </nav>
    </header>
  )
}
