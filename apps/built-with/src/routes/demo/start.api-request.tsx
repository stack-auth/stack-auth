import { useEffect, useState } from 'react'

import { createFileRoute } from '@tanstack/react-router'
import './start.css'

function getNames() {
  return fetch('/demo/api/names').then((res) => res.json() as Promise<string[]>)
}

export const Route = createFileRoute('/demo/start/api-request')({
  component: Home,
})

function Home() {
  const [names, setNames] = useState<Array<string>>([])

  useEffect(() => {
    getNames().then(setNames)
  }, [])

  return (
    <div className="api-page">
      <div className="content">
        <h1>Start API Request Demo - Names List</h1>
        <ul>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
