import { createFileRoute } from '@tanstack/react-router'
import { getPunkSongs } from '@/data/demo.punk-songs'

export const Route = createFileRoute('/demo/start/ssr/full-ssr')({
  component: RouteComponent,
  loader: async () => await getPunkSongs(),
})

function RouteComponent() {
  const punkSongs = Route.useLoaderData()

  return (
    <div>
      <h1>Full SSR - Punk Songs</h1>
      <ul>
        {punkSongs.map((song) => (
          <li key={song.id}>
            {song.name} - {song.artist}
          </li>
        ))}
      </ul>
    </div>
  )
}
