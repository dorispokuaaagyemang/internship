import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { SystemStatus } from './SystemStatus';

function renderWithClient(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('SystemStatus', () => {
  it('shows each dependency when the system is degraded', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        status: 'degraded',
        checks: [
          { name: 'mysql', status: 'up' },
          { name: 'redis', status: 'down' },
        ],
      },
    });

    renderWithClient(<SystemStatus />);

    expect(await screen.findByText('System degraded')).toBeInTheDocument();
    expect(screen.getByText('redis: down')).toBeInTheDocument();
  });

  it('reports an unreachable API', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network Error'));

    renderWithClient(<SystemStatus />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
