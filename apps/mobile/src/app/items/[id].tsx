import { useLocalSearchParams, useRouter } from 'expo-router';
import { ItemDetailScreen } from '../../features/item/ItemDetailScreen';

export default function ItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return (
    <ItemDetailScreen
      itemId={id}
      onPlay={(itemId) => router.push({ pathname: '/player/[id]', params: { id: itemId } })}
      onSignIn={() => router.push('/login')}
    />
  );
}
