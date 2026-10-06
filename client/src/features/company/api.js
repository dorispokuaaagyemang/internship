import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// --- The company (US-04). Key ['company'] is refreshed by the company.approved notification. ---

export function useMyCompany() {
  return useQuery({
    queryKey: ['company'],
    // 404 means "not registered yet", which is an answer, not an error.
    queryFn: async () => {
      const res = await api.get('/companies/me', { validateStatus: (s) => s === 200 || s === 404 });
      return res.status === 404 ? null : res.data.company;
    },
  });
}

export function useRegisterCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values) => (await api.post('/companies', values)).data.company,
    onSuccess: (company) => queryClient.setQueryData(['company'], company),
  });
}

// --- Postings (US-05) ---

export function useMyPostings(params) {
  return useQuery({
    queryKey: ['company-postings', params],
    queryFn: async () => (await api.get('/companies/me/postings', { params })).data,
    placeholderData: keepPreviousData,
  });
}

// The rep's own posting, drafts included (GET /postings/:id shows a draft to its company).
export function useCompanyPosting(id) {
  return useQuery({
    queryKey: ['company-postings', 'one', String(id)],
    queryFn: async () => (await api.get(`/postings/${id}`)).data.posting,
    enabled: Boolean(id),
  });
}

function usePostingMutation(request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args) => (await request(args)).data.posting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-postings'] });
      queryClient.invalidateQueries({ queryKey: ['postings'] });
    },
  });
}

export const useCreatePosting = () => usePostingMutation((values) => api.post('/postings', values));
export const useUpdatePosting = () => usePostingMutation(({ id, values }) => api.put(`/postings/${id}`, values));
export const usePublishPosting = () => usePostingMutation((id) => api.post(`/postings/${id}/publish`));
export const useClosePosting = () => usePostingMutation((id) => api.post(`/postings/${id}/close`));

// --- Applicants (US-06). Keys start with 'applications' so live notifications refresh them. ---

export function useApplicants(postingId, params) {
  return useQuery({
    queryKey: ['applications', 'posting', String(postingId), params],
    queryFn: async () => (await api.get(`/postings/${postingId}/applications`, { params })).data,
    placeholderData: keepPreviousData,
  });
}

export function useChangeStatus(applicationId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ status, note }) => (await api.patch(`/applications/${applicationId}/status`, { status, note })).data.application,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });
}

export async function openApplicantResume(applicationId) {
  const { data } = await api.get(`/applications/${applicationId}/resume`);
  window.open(data.url, '_blank', 'noopener');
}
