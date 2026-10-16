import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../components/theme';
import { SESSION_ID } from '../../lib/logger';
import { useIsOnline } from '../../lib/network';
import { requestMetrics as defaultMetrics, type RequestMetrics } from '../../lib/telemetry';
import { progressKeys, useProgressContext } from '../progress/ProgressProvider';

const REFRESH_MS = 2_000;

/**
 * Support-oriented view of the app-side metrics: request count, error rate and slowest route
 * latency (the same signals the API exposes at /metrics), plus connectivity and the sync backlog.
 */
export function DiagnosticsPanel({ metrics = defaultMetrics }: { metrics?: RequestMetrics }) {
  const online = useIsOnline();
  const { store, userId } = useProgressContext();
  const [snapshot, setSnapshot] = useState(() => metrics.snapshot());

  useEffect(() => {
    const timer = setInterval(() => setSnapshot(metrics.snapshot()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [metrics]);

  const pending = useQuery({
    queryKey: [...progressKeys.local(userId), 'pending'],
    queryFn: () => store!.pendingCount(userId!),
    enabled: !!store && !!userId,
    networkMode: 'always',
    refetchInterval: REFRESH_MS,
  });

  const slowest = Object.entries(snapshot.byRoute).sort(([, a], [, b]) => b.p95Ms - a.p95Ms)[0];
  const rows: [string, string][] = [
    ['Network', online ? 'Online' : 'Offline'],
    ['Requests', String(snapshot.total)],
    ['Error rate', `${(snapshot.errorRate * 100).toFixed(1)}%`],
    ['Slowest (p95)', slowest ? `${slowest[1].p95Ms} ms · ${slowest[0]}` : '–'],
    ['Progress waiting to sync', String(pending.data ?? 0)],
    ['Session', SESSION_ID.slice(0, 8)],
  ];

  return (
    <View style={styles.panel} accessibilityLabel="Diagnostics">
      <Text style={styles.heading} accessibilityRole="header">
        Diagnostics
      </Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing.xl,
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  heading: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { fontSize: 13, color: colors.textMuted },
  value: { fontSize: 13, color: colors.text, flexShrink: 1, fontVariant: ['tabular-nums'] },
});
