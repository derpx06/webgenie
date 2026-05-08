import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Tab } from './TabMentionsDropdown';

interface Mention {
  id: number;
  title: string;
  url: string;
}

interface AttachedFile {
  name: string;
  content: string;
  type: string;
}

export const useChatInput = (
  onSendMessage: (text: string, displayText?: string) => void,
  setContent?: (setter: (text: string) => void) => void,
  disabled?: boolean
) => {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  const isSendButtonDisabled = useMemo(
    () => disabled || (text.trim() === '' && attachedFiles.length === 0),
    [disabled, text, attachedFiles],
  );

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const maxHeight = 120;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const position = e.target.selectionStart;
    setText(value);
    setCursorPos(position);

    // Detect @ mention trigger
    const lastAtPos = value.lastIndexOf('@', position - 1);
    if (lastAtPos !== -1 && (lastAtPos === 0 || /\s/.test(value[lastAtPos - 1]))) {
      const query = value.slice(lastAtPos + 1, position);
      if (!/\s/.test(query)) {
        setMentionQuery(query);
        setShowMentions(true);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }

    requestAnimationFrame(adjustTextareaHeight);
  };

  const handleMentionSelect = useCallback((tab: Tab) => {
    if (tab.id === undefined || !tab.title || !tab.url) {
      setShowMentions(false);
      return;
    }
    const tabId = tab.id;
    const tabTitle = tab.title;
    const tabUrl = tab.url;
    const lastAtPos = text.lastIndexOf('@', cursorPos - 1);
    const before = text.slice(0, lastAtPos);
    const after = text.slice(cursorPos);
    const mentionText = `@${tabTitle}`;

    setText(`${before}${mentionText} ${after}`);
    setMentions(prev => {
      if (prev.some(m => m.id === tabId)) return prev;
      return [...prev, { id: tabId, title: tabTitle, url: tabUrl }];
    });

    setShowMentions(false);

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = lastAtPos + mentionText.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  }, [text, cursorPos]);

  useEffect(() => {
    if (setContent) setContent(setText);
  }, [setContent]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [adjustTextareaHeight]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const trimmedText = text.trim();

      if (trimmedText || attachedFiles.length > 0) {
        let messageContent = trimmedText;
        let displayContent = trimmedText;

        if (mentions.length > 0) {
          const activeMentions = mentions.filter(m => text.includes(`@${m.title}`));

          if (activeMentions.length > 0) {
            const enrichedMentions = await Promise.all(activeMentions.map(async (m) => {
              try {
                return new Promise((resolve) => {
                  chrome.runtime.sendMessage({ type: 'get_tab_content', tabId: m.id }, (response) => {
                    if (response && response.content) {
                      resolve({ ...m, content: response.content });
                    } else {
                      resolve({ ...m, content: '[Could not retrieve tab content]' });
                    }
                  });
                });
              } catch (err) {
                return { ...m, content: '[Error retrieving tab content]' };
              }
            })) as (Mention & { content: string })[];

            const mentionedTabsContext = enrichedMentions
              .map(m => `\n\n<nano_tab_reference type="tab" id="${m.id}" title="${m.title}" url="${m.url}">\n${m.content}\n</nano_tab_reference>`)
              .join('\n');

            messageContent = `${messageContent}\n\n<nano_mentions>${mentionedTabsContext}</nano_mentions>`;
          }
        }

        if (attachedFiles.length > 0) {
          const fileContents = attachedFiles
            .map(file => `\n\n<nano_file_content type="file" name="${file.name}">\n${file.content}\n</nano_file_content>`)
            .join('\n');

          messageContent = trimmedText
            ? `${trimmedText}\n\n<nano_attached_files>${fileContents}</nano_attached_files>`
            : `<nano_attached_files>${fileContents}</nano_attached_files>`;

          const fileList = attachedFiles.map(file => `📎 ${file.name}`).join('\n');
          displayContent = trimmedText ? `${trimmedText}\n\n${fileList}` : fileList;
        }

        onSendMessage(messageContent, displayContent);
        setText('');
        setAttachedFiles([]);
        setMentions([]);
        setShowMentions(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
    },
    [text, attachedFiles, mentions, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 1024 * 1024) continue;
      try {
        const content = await file.text();
        newFiles.push({ name: file.name, content, type: file.type || 'text/plain' });
      } catch (err) { console.error(err); }
    }
    setAttachedFiles(prev => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleRemoveFile = (index: number) => setAttachedFiles(prev => prev.filter((_, i) => i !== index));

  const handleRemoveMention = (index: number) => {
    const mention = mentions[index];
    setMentions(prev => prev.filter((_, i) => i !== index));
    // Also remove the @Title from the text if it exists
    setText(prev => prev.replace(`@${mention.title}`, ''));
  };

  const handleSwitchTab = (tabId: number) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      if (tab?.windowId) {
        chrome.windows.update(tab.windowId, { focused: true });
      }
    });
  };

  return {
    text,
    setText,
    attachedFiles,
    showMentions,
    setShowMentions,
    mentionQuery,
    textareaRef,
    fileInputRef,
    isSendButtonDisabled,
    handleTextChange,
    handleMentionSelect,
    handleSubmit,
    handleKeyDown,
    handleFileChange,
    handleRemoveFile,
    mentions,
    handleRemoveMention,
    handleSwitchTab,
  };
};
