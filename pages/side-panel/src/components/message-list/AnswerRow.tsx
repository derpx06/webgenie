import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FaCheckCircle } from 'react-icons/fa';
import { BsStars } from 'react-icons/bs';
import type { Message } from '@extension/storage';

interface AnswerRowProps {
  messages: Message[];
  isDarkMode: boolean;
}

const formatTimeOnly = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const AnswerRow: React.FC<AnswerRowProps> = ({ messages, isDarkMode }) => {
  const lastMsg = messages[messages.length - 1];
  return (
    <div className="group mb-4 flex gap-3">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-full shadow-lg transition-transform group-hover:scale-110 ${isDarkMode ? 'border border-white/5 bg-[#1a1c23] text-indigo-400' : 'border border-gray-100 bg-white text-indigo-600'}`}>
        <BsStars size={16} />
      </div>
      <div className="flex min-w-0 grow flex-col items-start">
        <div className="flex w-full flex-col gap-2">
          {messages.map((m, i) => (
            <div key={i} className={`font-regular animate-in fade-in text-[14px] leading-relaxed duration-300 ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                ul: ({ ...props }) => <ul className="mb-2 ml-4 list-disc" {...props} />,
                ol: ({ ...props }) => <ol className="mb-2 ml-4 list-decimal" {...props} />,
                code: ({ ...props }) => <code className={`rounded px-1 ${isDarkMode ? 'bg-white/5 text-amber-300' : 'bg-gray-100 text-amber-600'}`} {...props} />
              }}>
                {m.content}
              </ReactMarkdown>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          {messages.some(m => m.isFailed || (m.isFailed === undefined && (m.content.includes('❌') || m.content.toLowerCase().includes('failed') || m.content.includes('⚠️')))) ? (
            <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight ${isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
              <FaCheckCircle size={10} className="rotate-45" />
              <span>Failed</span>
            </div>
          ) : (
            <div className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
              <FaCheckCircle size={10} />
              <span>Completed</span>
            </div>
          )}
          <span className={`text-[10px] font-bold opacity-30 ${isDarkMode ? 'text-white' : 'text-gray-600'}`}>
            {formatTimeOnly(lastMsg.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
};
