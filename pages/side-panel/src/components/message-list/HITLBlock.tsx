import React, { useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { BsStars } from 'react-icons/bs';
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
  isDarkMode: boolean;
  onOptionSelect?: (text: string) => void;
}

const formatTimeOnly = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const HITLBlock: React.FC<HITLBlockProps> = ({ messages, isDarkMode, onOptionSelect }) => {
  const lastMsg = messages[messages.length - 1];
  let question = lastMsg.content;
  let options: string[] = [];
  let fields: FormField[] = [];
  let type = 'question';
  let actionType = '';

  try {
    const data = JSON.parse(lastMsg.content);
    if (data.question) {
      question = data.question;
      options = data.options || [];
      fields = data.fields || [];
      type = data.type || 'question';
      actionType = data.actionType || '';
    }
  } catch (e) {
    // Not valid JSON
  }

  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const isConfirmation = type === 'confirmation';

  const handleSelect = (opt: string) => {
    if (dontAskAgain && actionType) {
      const key = `auto_confirm_${actionType}`;
      chrome.storage.local.set({ [key]: true });
    }
    onOptionSelect?.(opt);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const responseArr = Object.entries(formData).map(([id, val]) => {
      const field = fields.find(f => f.id === id);
      return `${field?.label || id}: ${val}`;
    });
    onOptionSelect?.(responseArr.join('\n'));
  };

  return (
    <div
      className={`my-4 overflow-hidden rounded-2xl border shadow-xl duration-500 ${isDarkMode
      ? 'border-indigo-500/30 bg-indigo-500/10 backdrop-blur-md'
      : 'border-indigo-200 bg-indigo-50/80 backdrop-blur-sm'
      }`}>
      <div className="flex flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-2xl shadow-lg ring-1 transition-transform group-hover:scale-110 ${isDarkMode
              ? 'bg-indigo-600 text-white ring-indigo-400'
              : 'bg-indigo-500 text-white ring-indigo-300'
              }`}>
              {isConfirmation ? <FaCheckCircle size={20} /> : <BsStars size={20} className="animate-pulse" />}
            </div>
            <div className="flex flex-col">
              <span className={`text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? 'text-indigo-300' : 'text-indigo-600'}`}>
                {isConfirmation ? 'Action Confirmation' : 'Human Intervention Needed'}
              </span>
              <span className={`text-[10px] font-medium opacity-50 ${isDarkMode ? 'text-white' : 'text-gray-600'}`}>
                {isConfirmation ? 'Please approve this sensitive action' : 'The agent is waiting for your decision'}
              </span>
            </div>
          </div>
        </div>

        <div className={`font-sans text-[15px] font-semibold leading-relaxed ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          {question}
        </div>

        {fields.length > 0 && (
          <form onSubmit={handleFormSubmit} className="mt-5 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map(field => (
                <div key={field.id} className="flex flex-col gap-1.5">
                  <label className={`text-[11px] font-bold uppercase tracking-wide opacity-70 ${isDarkMode ? 'text-white' : 'text-gray-700'}`}>
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      required={field.required}
                      value={formData[field.id] || ''}
                      onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                      className={`w-full rounded-xl border px-3 py-2 text-[13px] font-medium outline-none transition-all focus:ring-2 focus:ring-indigo-500 ${isDarkMode
                        ? 'border-white/10 bg-black/20 text-white'
                        : 'border-indigo-100 bg-white text-gray-900 shadow-sm'
                        }`}
                    >
                      <option value="">Select option...</option>
                      {field.options?.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      required={field.required}
                      placeholder={field.placeholder}
                      value={formData[field.id] || ''}
                      onChange={(e) => setFormData({ ...formData, [field.id]: e.target.value })}
                      className={`w-full rounded-xl border px-3 py-2 text-[13px] font-medium outline-none transition-all focus:ring-2 focus:ring-indigo-500 ${isDarkMode
                        ? 'border-white/10 bg-black/20 text-white placeholder:text-gray-500'
                        : 'border-indigo-100 bg-white text-gray-900 shadow-sm placeholder:text-gray-400'
                        }`}
                    />
                  )}
                </div>
              ))}
            </div>
            <button
              type="submit"
              className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold transition-all hover:scale-[1.01] active:scale-[0.99] ${isDarkMode
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-500'
                : 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-600'
                }`}
            >
              Submit Information
            </button>
          </form>
        )}

        {options.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {options.map((opt, i) => (
              <button
                key={i}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(opt);
                }}
                className={`group relative flex items-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] ${isDarkMode
                  ? 'border border-white/5 bg-white/10 text-white hover:bg-white/20'
                  : 'border border-indigo-100 bg-white text-indigo-700 shadow-sm hover:bg-indigo-50'
                  }`}
              >
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                {opt}
              </button>
            ))}
          </div>
        )}

        {isConfirmation && actionType && (
          <div className="mt-4 flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium opacity-70 hover:opacity-100">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(e) => setDontAskAgain(e.target.checked)}
                className="size-3.5 rounded border-indigo-300 bg-white/10 text-indigo-600 focus:ring-indigo-500"
              />
              <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>Don&apos;t ask for confirmation for this again</span>
            </label>
          </div>
        )}
      </div>

      <div className={`flex items-center justify-between border-t px-4 py-2 text-[10px] font-bold uppercase tracking-tight ${isDarkMode ? 'border-white/5 bg-white/5 text-indigo-400' : 'border-indigo-100 bg-indigo-50/30 text-indigo-500'
        }`}>
        <div className="flex items-center gap-2">
          <div className="size-1.5 animate-pulse rounded-full bg-indigo-500" />
          <span>Action Required</span>
        </div>
        <span className="opacity-40">{formatTimeOnly(lastMsg.timestamp)}</span>
      </div>
    </div>
  );
};
