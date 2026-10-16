import { PlaybackResponseSchema } from '@media-library/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';

/** Stream access is per-user and must never be served from another user's cache. */
export function usePlaybackAccess(itemId: string) {
  const client = useApiClient();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['user', user?.id, 'playback', itemId],
    queryFn: ({ signal }) =>
      client.request({
        path: `/v1/items/${encodeURIComponent(itemId)}/playback`,
        schema: PlaybackResponseSchema,
        signal,
      }),
    enabled: !!user,
    staleTime: 0,
    gcTime: 0,
  });
}
