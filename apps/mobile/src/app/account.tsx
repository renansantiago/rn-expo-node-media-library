import { useRouter } from 'expo-router';
import { AccountScreen } from '../features/auth/AccountScreen';

export default function AccountRoute() {
  const router = useRouter();
  return <AccountScreen onSignedOut={() => router.back()} />;
}
