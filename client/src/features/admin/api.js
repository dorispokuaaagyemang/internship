import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// US-04, US-12: the companies an admin reviews.
export function useAdminCompanies(params) {
  return useQuery({
    queryKey: ['admin', 'companies', params],
    queryFn: async () => (await api.get('/admin/companies', { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function useApproveCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id) => (await api.post(`/admin/companies/${id}/approve`)).data.company,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
  });
}
