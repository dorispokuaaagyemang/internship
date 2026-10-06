import { useState } from 'react';

// A list of short tags (skills). Enter or comma adds what was typed; each tag has a remove
// button; Backspace in the empty box removes the last one. Duplicates differing only in case
// are ignored, as the server does.
export function TagInput({ value, onChange, max = 30, placeholder, ...a11y }) {
  const [draft, setDraft] = useState('');

  function add(raw) {
    const tag = raw.trim().replace(/\s+/g, ' ').slice(0, 50);
    setDraft('');
    if (!tag || value.length >= max || value.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag]);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="tags">
      {value.length > 0 && (
        <ul className="tags__list">
          {value.map((tag) => (
            <li key={tag} className="tag">
              {tag}
              <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        {...a11y}
        value={draft}
        placeholder={value.length >= max ? `Up to ${max}` : placeholder}
        disabled={value.length >= max}
        onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}
