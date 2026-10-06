import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken, refreshSession } from '../../lib/api';
import { queriesToRefresh } from './describe';

// US-07: while signed in, keep a socket to the API. Each `notification` event marks the
// related queries stale, so open pages refetch and update without a reload. Offline, the
// data simply refreshes on the next page load.
export function RealtimeBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      // A function, so every reconnect sends the current token rather than the first one.
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
    });

    socket.on('notification', (notification) => {
      for (const queryKey of queriesToRefresh(notification)) queryClient.invalidateQueries({ queryKey });
    });

    // The access token lasts 15 minutes; if a reconnect is refused, renew it and try again.
    socket.on('connect_error', async (err) => {
      if (err.message !== 'UNAUTHENTICATED') return;
      try {
        await refreshSession();
        socket.connect();
      } catch {
        // Signed out: the AuthProvider unmounts this component.
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  return null;
}
