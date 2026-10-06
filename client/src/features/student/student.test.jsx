import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { makeAuth, renderApp } from '../../test/render';
import { TagInput } from '../../components/TagInput';
import { ProfilePage } from './ProfilePage';
import { SearchPage } from './SearchPage';
import { PostingPage } from './PostingPage';
import { ApplicationPage } from './ApplicationPage';

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const apiFailure = (status, code, message, fields) => Object.assign(new Error(message), { response: { status, data: { error: { code, message, fields } } } });
const DAY = 86_400_000;
const posting = (overrides = {}) => ({
  id: 9,
  title: 'Data Analyst Intern',
  description: 'Work with our data team.',
  location: 'Nairobi',
  domain: 'Data',
  durationWeeks: 12,
  stipend: 15000,
  stipendCurrency: 'KES',
  deadline: new Date(Date.now() + 10 * DAY).toISOString(),
  status: 'active',
  company: { id: 5, name: 'Acme Ltd', website: null },
  skills: ['Excel', 'SQL'],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('TagInput', () => {
  function Harness() {
    const [tags, setTags] = useState(['SQL']);
    return <TagInput aria-label="Skills" value={tags} onChange={setTags} />;
  }

  it('adds on Enter or comma, ignores case duplicates, and removes', async () => {
    renderApp(<Harness />);
    const input = screen.getByLabelText('Skills');

    await userEvent.type(input, 'Excel{Enter}sql,Python,');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent.replace('×', ''))).toEqual(['SQL', 'Excel', 'Python']);

    await userEvent.click(screen.getByRole('button', { name: 'Remove Excel' }));
    expect(screen.queryByText('Excel')).not.toBeInTheDocument();
  });
});

describe('ProfilePage (US-02)', () => {
  it('highlights every missing mandatory field and saves nothing', async () => {
    api.get.mockResolvedValue({ data: { profile: null, completeness: { complete: false, missing: ['fullName', 'university', 'department'] } } });
    renderApp(<ProfilePage />);

    await userEvent.type(await screen.findByLabelText('GPA (optional)'), '3.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Full name is required')).toBeInTheDocument();
    expect(screen.getByText('University is required')).toBeInTheDocument();
    expect(screen.getByText('Department is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('saves the profile with a numeric GPA and shows when it was saved', async () => {
    api.get.mockResolvedValue({ data: { profile: null, completeness: { complete: false, missing: ['fullName'] } } });
    api.put.mockImplementation(async (url, body) => ({
      data: { profile: { ...body, resume: null, updatedAt: '2026-10-06T10:00:00Z' }, completeness: { complete: true, missing: [] } },
    }));
    renderApp(<ProfilePage />);

    await userEvent.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('University'), 'University of Nairobi');
    await userEvent.type(screen.getByLabelText('Department'), 'CS');
    await userEvent.type(screen.getByLabelText('GPA (optional)'), '3.6');
    await userEvent.type(screen.getByLabelText('Skills'), 'SQL{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/students/me', {
        fullName: 'Ada Lovelace',
        university: 'University of Nairobi',
        department: 'CS',
        gpa: 3.6,
        bio: '',
        skills: ['SQL'],
      }),
    );
    expect(await screen.findByText(/Profile saved/)).toBeInTheDocument();
  });

  it('refuses a resume that is not PDF/DOCX or is too big, before uploading', async () => {
    api.get.mockResolvedValue({
      data: { profile: { fullName: 'Ada', university: 'U', department: 'D', gpa: null, bio: null, skills: [], resume: null }, completeness: { complete: true, missing: [] } },
    });
    renderApp(<ProfilePage />);

    const input = await screen.findByLabelText('Resume file');
    await userEvent.upload(input, new File(['x'], 'cv.png', { type: 'image/png' }), { applyAccept: false });
    expect(await screen.findByText('Choose a PDF or Word (.docx) file.')).toBeInTheDocument();

    const big = new File([new Uint8Array(5 * 1024 * 1024)], 'cv.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, big);
    expect(await screen.findByText('The file must be under 5 MB.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('uploads a resume as multipart form data', async () => {
    api.get.mockResolvedValue({
      data: { profile: { fullName: 'Ada', university: 'U', department: 'D', gpa: null, bio: null, skills: [], resume: null }, completeness: { complete: true, missing: [] } },
    });
    api.post.mockResolvedValue({
      data: { profile: { fullName: 'Ada', university: 'U', department: 'D', skills: [], resume: { fileName: 'cv.pdf', size: 2048, uploadedAt: '2026-10-06T10:00:00Z' } }, completeness: { complete: true, missing: [] } },
    });
    renderApp(<ProfilePage />);

    await userEvent.upload(await screen.findByLabelText('Resume file'), new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/students/me/resume', expect.any(FormData)));
    expect(api.post.mock.calls[0][1].get('resume').name).toBe('cv.pdf');
    expect(await screen.findByText('cv.pdf')).toBeInTheDocument();
  });
});

describe('SearchPage (US-03)', () => {
  it('searches from the URL and lists open postings', async () => {
    api.get.mockResolvedValue({ data: { items: [posting()], total: 1, page: 1, limit: 10 } });
    renderApp(<SearchPage />, { route: '/internships?q=data&location=Nairobi', path: '/internships' });

    expect(await screen.findByRole('link', { name: 'Data Analyst Intern' })).toHaveAttribute('href', '/internships/9');
    expect(api.get).toHaveBeenCalledWith('/postings', { params: { q: 'data', location: 'Nairobi', domain: undefined, page: 1, limit: 10 } });
    expect(screen.getByText('1 internship open')).toBeInTheDocument();
    expect(screen.getByText(/Closes in \d+ days/)).toBeInTheDocument();
  });

  it('puts a new search in the URL', async () => {
    api.get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 10 } });
    renderApp(<SearchPage />, { route: '/internships', path: '/internships' });

    await userEvent.type(screen.getByPlaceholderText(/Keywords/), 'marketing');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/postings', expect.objectContaining({ params: expect.objectContaining({ q: 'marketing' }) })));
    expect(await screen.findByText(/No open internships match/)).toBeInTheDocument();
  });
});

describe('PostingPage apply (US-03)', () => {
  const open = (auth) => renderApp(<PostingPage />, { route: '/internships/9', path: '/internships/:id', auth });

  beforeEach(() => api.get.mockResolvedValue({ data: { posting: posting() } }));

  it('shows the details and applies with a cover letter', async () => {
    api.post.mockResolvedValue({ data: { application: { id: 30, status: 'applied' } } });
    open();

    expect(await screen.findByRole('heading', { name: 'Data Analyst Intern' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Cover letter (optional)'), 'I love data.');
    await userEvent.click(screen.getByRole('button', { name: 'Submit application' }));

    expect(api.post).toHaveBeenCalledWith('/postings/9/apply', { coverLetter: 'I love data.' });
    expect(await screen.findByText(/Application sent/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow it here' })).toHaveAttribute('href', '/applications/30');
  });

  it('names the missing profile fields and links to the profile', async () => {
    api.post.mockRejectedValue(apiFailure(422, 'PROFILE_INCOMPLETE', 'Complete your profile', { university: 'Required before applying', department: 'Required before applying' }));
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Submit application' }));

    expect(await screen.findByText(/Missing: university, department/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your profile' })).toHaveAttribute('href', '/profile');
  });

  it('explains a duplicate application', async () => {
    api.post.mockRejectedValue(apiFailure(409, 'ALREADY_APPLIED', 'You have already applied to this posting'));
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Submit application' }));
    expect(await screen.findByText(/already applied to this internship/)).toBeInTheDocument();
  });

  it('asks a visitor to sign in, and says when a posting is closed', async () => {
    open(makeAuth({ status: 'signedOut', user: null }));
    expect(await screen.findByRole('link', { name: 'Sign in to apply' })).toHaveAttribute('href', '/login?next=%2Finternships%2F9');
  });

  it('does not offer applying once the deadline has passed', async () => {
    api.get.mockResolvedValue({ data: { posting: posting({ deadline: new Date(Date.now() - DAY).toISOString() }) } });
    open();

    expect(await screen.findByText(/no longer accepts applications/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit application' })).not.toBeInTheDocument();
  });
});

describe('ApplicationPage (US-07, US-08)', () => {
  const application = (overrides) => ({
    id: 30,
    status: 'applied',
    coverLetter: null,
    posting: { id: 9, title: 'Data Analyst Intern', company: { name: 'Acme Ltd' } },
    history: [{ from: null, to: 'applied', at: '2026-10-06T09:00:00Z', note: null }],
    allowedActions: ['withdraw'],
    ...overrides,
  });
  const open = () => renderApp(<ApplicationPage />, { route: '/applications/30', path: '/applications/:id' });

  it('shows the timeline and withdraws after confirmation', async () => {
    api.get.mockResolvedValue({ data: { application: application() } });
    api.post.mockResolvedValue({ data: { application: application({ status: 'withdrawn', allowedActions: [] }) } });
    open();

    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw application' }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/applications/30/withdraw');
  });

  it('does not offer Withdraw once Accepted or Rejected, and says why', async () => {
    api.get.mockResolvedValue({
      data: {
        application: application({
          status: 'accepted',
          allowedActions: [],
          history: [
            { from: null, to: 'applied', at: '2026-10-06T09:00:00Z' },
            { from: 'interviewed', to: 'accepted', at: '2026-10-08T09:00:00Z', note: 'Welcome aboard' },
          ],
        }),
      },
    });
    open();

    expect(await screen.findByText(/can no longer be withdrawn/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw application' })).not.toBeInTheDocument();
    expect(screen.getByText('“Welcome aboard”')).toBeInTheDocument();
  });
});
