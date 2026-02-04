import { createFileRoute } from '@tanstack/react-router'
import { getPunkSongs } from '@/data/demo.punk-songs'

export const Route = createFileRoute('/demo/start/ssr/data-only')({
  ssr: 'data-only',
  component: RouteComponent,
  loader: async () => await getPunkSongs(),
})

function RouteComponent() {
  const punkSongs = Route.useLoaderData()

  return (
    <div>
      <h1>Data Only SSR - Punk Songs</h1>
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
