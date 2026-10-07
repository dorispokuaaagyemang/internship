import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// US-09..US-11. Keys start with 'internships', which the related live notifications refresh.

export function useInternships(params) {
  return useQuery({
    queryKey: ['internships', 'list', params],
    queryFn: async () => (await api.get('/internships', { params })).data,
    placeholderData: keepPreviousData,
  });
}

// While a completed internship waits for its certificate (made by the worker), check every 5 s.
export function useInternship(id) {
  return useQuery({
    queryKey: ['internships', String(id)],
    queryFn: async () => (await api.get(`/internships/${id}`)).data.internship,
    refetchInterval: (query) => {
      const i = query.state.data;
      return i?.status === 'completed' && !i.certificate ? 5000 : false;
    },
  });
}

export function useEvaluations(id) {
  return useQuery({
    queryKey: ['internships', String(id), 'evaluations'],
    queryFn: async () => (await api.get(`/internships/${id}/evaluations`)).data.items,
  });
}

function useInternshipMutation(id, request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['internships'] }),
  });
}

export const useAddEvaluation = (id) => useInternshipMutation(id, async (values) => (await api.post(`/internships/${id}/evaluations`, values)).data.evaluation);
export const useComplete = (id) => useInternshipMutation(id, async () => (await api.post(`/internships/${id}/complete`)).data.internship);
export const useAssignSupervisor = (id) =>
  useInternshipMutation(id, async (supervisorId) => (await api.post(`/internships/${id}/supervisor`, { supervisorId })).data.internship);
export const useUpdateDates = (id) => useInternshipMutation(id, async (dates) => (await api.patch(`/internships/${id}/dates`, dates)).data.internship);

// Both return a 5-minute link; open it straight away.
export async function openCertificate(id) {
  const { data } = await api.get(`/internships/${id}/certificate`);
  window.open(data.url, '_blank', 'noopener');
}

export async function openInternResume(id) {
  const { data } = await api.get(`/internships/${id}/resume`);
  window.open(data.url, '_blank', 'noopener');
}

// --- Company staff (US-09) ---

export function useStaff(enabled = true) {
  return useQuery({ queryKey: ['staff'], queryFn: async () => (await api.get('/companies/me/staff')).data.items, enabled });
}

export function useAddStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values) => (await api.post('/companies/me/staff', values)).data.member,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}

export function useResendInvite() {
  return useMutation({ mutationFn: (userId) => api.post(`/companies/me/staff/${userId}/invite`) });
}
