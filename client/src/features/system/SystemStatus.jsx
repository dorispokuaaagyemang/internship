import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

async function fetchHealth() {
  // 503 still carries the per-dependency report, so treat it as data.
  const { data } = await api.get('/health', { validateStatus: (s) => s === 200 || s === 503 });
  return data;
}

export function SystemStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  if (isPending) return <p className="status">Checking system status…</p>;
  if (isError) return <p className="status status--down">API unreachable</p>;

  return (
    <div className={`status status--${data.status === 'ok' ? 'up' : 'down'}`}>
      <p>System {data.status === 'ok' ? 'operational' : 'degraded'}</p>
      <ul>
        {data.checks.map((check) => (
          <li key={check.name}>
            {check.name}: {check.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
