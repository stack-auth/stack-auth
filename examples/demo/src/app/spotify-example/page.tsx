'use client';

import { useUser } from "@stackframe/stack";
import { Button } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";

export default function Page() {
  const user = useUser({ or: 'redirect' });
  const connection = user.useConnectedAccount('spotify', { or: 'redirect' });
  const token = connection.useAccessToken();
  const [playList, setPlayList] = useState<any>();

  useEffect(() => {
    async function getPlayList() {
      const response = await fetch('https://api.spotify.com/v1/me/playlists', {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
        },
      });
      const data = await response.json();
      setPlayList(data);
    }

    getPlayList().catch((error) => {
      alert("An error occurred.");
      console.error(error);
    });
  }, [token]);

  return (
    <>
      <Button onClick={async () => console.log(await (await user.getConnectedAccount('spotify', { or: 'redirect', scopes: ['playlist-read-private'] })).getAccessToken())}>
        Get Spotify Playlist
      </Button>
      <div>
        <h1>Spotify Playlist</h1>
        {JSON.stringify(playList)}
      </div>
    </>
  );
}
