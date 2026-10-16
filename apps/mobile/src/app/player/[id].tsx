import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlayerScreen } from '../../features/player/PlayerScreen';

export default function PlayerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return <PlayerScreen itemId={id} onSignIn={() => router.push('/login')} />;
}
