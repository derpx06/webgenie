import React, { useEffect, useRef, useState } from 'react';
import { t } from '@extension/i18n';
import type { Message } from '@extension/storage';

interface FormField {
  id: string;
  label?: string;
  required?: boolean;
  type?: string;
  options?: string[];
  placeholder?: string;
}

interface HITLBlockProps {
  messages: Message[];
  onOptionSelect?: (text: string, displayText?: string, secrets?: string[]) => void;
  /** The user has already replied (or a newer question replaced this one): shown read-only. */
  answered?: boolean;
}

const formatTimeOnly = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const QuestionIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
    <path d="M8 2.5A5.5 5.5 0 1 1 3.4 11L2 14l3-1.4A5.5 5.5 0 0 1 8 2.5Z" />
  </svg>
);

const ConfirmIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
    <path d="M8 1.8 13.5 4v4c0 3.2-2.2 5.6-5.5 6.4C4.7 13.6 2.5 11.2 2.5 8V4L8 1.8Z" />
    <path d="M5.8 8.2 7.3 9.7l3-3.2" />
  </svg>
);

const AnsweredIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

/**
 * A question or a confirmation the agent cannot answer for itself. It is drawn in the
 * "waiting" tone — the only place in the panel that colour appears — so it cannot be
 * read as ordinary progress, and the controls that answer it are the first thing in it.
 */
export const HITLBlock: React.FC<HITLBlockProps> = ({ messages, onOptionSelect, answered = false }) => {
  const lastMsg = messages[messages.length - 1];
  let question = lastMsg.content;
  let options: string[] = [];
  let fields: FormField[] = [];
  let type = 'question';
  // Set by the background only for low-risk confirmations, per site: never for orders, payments or accounts.
  let rememberKey = '';

  try {
    const data = JSON.parse(lastMsg.content);
    if (data.question) {
      question = data.question;
      options = data.options || [];
      fields = data.fields || [];
      type = data.type || 'question';
      rememberKey = data.rememberKey || '';
    }
  } catch {
    // Not valid JSON: the whole content is the question.
  }

  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const isConfirmation = type === 'confirmation';

  // A newly active question takes focus (first field, else first option) so it can be answered from the keyboard.
  useEffect(() => {
    if (answered) return;
    containerRef.current
      ?.querySelector<HTMLElement>('input:not([type="checkbox"]), select, button')
      ?.focus({ preventScroll: true });
  }, [answered, lastMsg.timestamp]);

  const handleSelect = (opt: string) => {
    if (dontAskAgain && rememberKey && !/^\s*no\b/i.test(opt)) {
      chrome.storage.local.set({ [rememberKey]: true });
    }
    onOptionSelect?.(opt);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const entries = Object.entries(formData).map(([id, val]) => ({ field: fields.find(f => f.id === id), id, val }));
    const line = (label: string, value: string) => `${label}: ${value}`;
    const response = entries.map(({ field, id, val }) => line(field?.label || id, val)).join('\n');
    // Password answers go to the agent but are shown as dots and kept out of traces.
    const shown = entries
      .map(({ field, id, val }) => line(field?.label || id, field?.type === 'password' ? '•'.repeat(val.length) : val))
      .join('\n');
    const secrets = entries.filter(({ field, val }) => field?.type === 'password' && val).map(({ val }) => val);
    onOptionSelect?.(response, shown, secrets);
  };

  return (
    <div
      ref={containerRef}
      className={`wg-callout wg-tone-wait ${answered ? 'wg-answered' : ''}`}
      role={answered ? undefined : 'group'}
      aria-label={isConfirmation ? t('chat_hitl_confirmation_title') : t('chat_hitl_question_title')}>
      <div className="wg-callout-head">
        {isConfirmation ? <ConfirmIcon /> : <QuestionIcon />}
        <span>{isConfirmation ? t('chat_hitl_confirmation_title') : t('chat_hitl_question_title')}</span>
        {answered && (
          <span className="ml-auto flex items-center gap-1">
            <AnsweredIcon />
            {t('chat_hitl_answered')}
          </span>
        )}
      </div>

      <p aria-live="polite" className="wg-callout-body">
        {question}
      </p>

      {/* A disabled fieldset turns every field, option and checkbox inside it read-only. */}
      <fieldset disabled={answered} className="min-w-0 border-0 p-0">
        {fields.length > 0 && (
          <form onSubmit={handleFormSubmit} className="mt-3 flex flex-col gap-3">
            {fields.map(field => (
              <div key={field.id} className="wg-field">
                <label className="wg-field-label" htmlFor={`hitl-${field.id}`}>
                  {field.label || field.id}
                  {field.required && <span aria-hidden="true"> *</span>}
                </label>
                {field.type === 'select' ? (
                  <select
                    id={`hitl-${field.id}`}
                    className="wg-input"
                    required={field.required}
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}>
                    <option value="">{t('chat_hitl_selectOption')}</option>
                    {field.options?.map(opt => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`hitl-${field.id}`}
                    className="wg-input"
                    type={field.type}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <button type="submit" className="wg-btn wg-btn-primary w-full">
              {t('chat_hitl_submit')}
            </button>
          </form>
        )}

        {options.length > 0 && (
          <div className="wg-callout-actions">
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                // The first option is the agent's suggested answer, so it carries the primary weight.
                className={`wg-btn ${i === 0 ? 'wg-btn-primary' : 'wg-btn-quiet'}`}
                onClick={() => handleSelect(opt)}>
                {opt}
              </button>
            ))}
          </div>
        )}

        {isConfirmation && rememberKey && (
          <label className="mt-3 flex cursor-pointer items-center gap-2" style={{ fontSize: 'var(--wg-fs-base)', color: 'var(--wg-text-2)' }}>
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={e => setDontAskAgain(e.target.checked)}
              className="size-3.5 cursor-pointer"
            />
            <span>{t('chat_hitl_dontAskAgain')}</span>
          </label>
        )}
      </fieldset>

      <p className="wg-meta wg-num mt-3">{formatTimeOnly(lastMsg.timestamp)}</p>
    </div>
  );
};
