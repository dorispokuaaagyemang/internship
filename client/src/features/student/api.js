import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// --- Profile and resume (US-02) ---

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: async () => (await api.get('/students/me')).data });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values) => (await api.put('/students/me', values)).data,
    onSuccess: (data) => queryClient.setQueryData(['profile'], data),
  });
}

export function useUploadResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const body = new FormData();
      body.append('resume', file);
      return (await api.post('/students/me/resume', body)).data;
    },
    onSuccess: (data) => queryClient.setQueryData(['profile'], data),
  });
}

export function useDeleteResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/students/me/resume'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}

// The API returns a 5-minute link; open it straight away.
export async function openResume() {
  const { data } = await api.get('/students/me/resume');
  window.open(data.url, '_blank', 'noopener');
}

// --- Postings (US-03) ---

export function useSearchPostings(params) {
  return useQuery({
    queryKey: ['postings', 'search', params],
    queryFn: async () => (await api.get('/postings', { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function usePosting(id) {
  return useQuery({ queryKey: ['postings', id], queryFn: async () => (await api.get(`/postings/${id}`)).data.posting });
}

export function useApply(postingId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values) => (await api.post(`/postings/${postingId}/apply`, values)).data.application,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });
}

// --- Applications (US-07, US-08). Keys start with 'applications', which live notifications refresh. ---

export function useMyApplications(params) {
  return useQuery({
    queryKey: ['applications', 'mine', params],
    queryFn: async () => (await api.get('/applications/me', { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function useApplication(id) {
  return useQuery({
    queryKey: ['applications', id],
    queryFn: async () => (await api.get(`/applications/${id}`)).data.application,
  });
}

export function useWithdraw(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/applications/${id}/withdraw`)).data.application,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });
}
