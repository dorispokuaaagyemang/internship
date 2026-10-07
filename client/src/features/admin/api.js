import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// US-12: admin oversight.

export function useStats() {
  return useQuery({ queryKey: ['admin', 'stats'], queryFn: async () => (await api.get('/admin/stats')).data.stats });
}

// US-04, US-12: the companies an admin reviews.
export function useAdminCompanies(params) {
  return useQuery({
    queryKey: ['admin', 'companies', params],
    queryFn: async () => (await api.get('/admin/companies', { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function useAdminUsers(params) {
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: async () => (await api.get('/admin/users', { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function useAuditLogs(params) {
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: async () => (await api.get('/admin/audit-logs', { params })).data,
    placeholderData: keepPreviousData,
  });
}

// Every admin action refreshes the admin views (lists, counts, audit log).
function useAdminAction(request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export const useApproveCompany = () => useAdminAction(async (id) => (await api.post(`/admin/companies/${id}/approve`)).data.company);
export const useSuspendCompany = () => useAdminAction(async ({ id, reason }) => (await api.post(`/admin/companies/${id}/suspend`, { reason })).data.company);
export const useReinstateCompany = () => useAdminAction(async (id) => (await api.post(`/admin/companies/${id}/reinstate`)).data.company);
export const useSuspendUser = () => useAdminAction(async ({ id, reason }) => (await api.post(`/admin/users/${id}/suspend`, { reason })).data.user);
export const useReinstateUser = () => useAdminAction(async (id) => (await api.post(`/admin/users/${id}/reinstate`)).data.user);
export const useDeleteUser = () => useAdminAction(({ id, reason }) => api.delete(`/admin/users/${id}`, { data: { reason } }));
