import { useState, useCallback, useRef, useEffect } from 'react';
import { type Message, Actors } from '@extension/storage';
import { t } from '@extension/i18n';

interface UseSpeechRecognitionProps {
    appendMessage: (message: Message) => void;
    setIsProcessingSpeech: (processing: boolean) => void;
    setInputTextRef: React.MutableRefObject<((text: string) => void) | null>;
}

// Type definitions for the Web Speech API since they aren't in default TS types
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
    isFinal: boolean;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
}

interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (event: Event) => void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: SpeechRecognitionErrorEvent) => void;
    onend: (event: Event) => void;
    start(): void;
    stop(): void;
    abort(): void;
}

declare global {
    interface Window {
        webkitSpeechRecognition: {
            new(): SpeechRecognition;
        };
    }
}

export const useSpeechRecognition = ({
    appendMessage,
    setIsProcessingSpeech,
    setInputTextRef,
}: UseSpeechRecognitionProps) => {
    const [isRecording, setIsRecording] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    const handleMicClick = useCallback(async () => {
        if (isRecording) {
            recognitionRef.current?.stop();
            setIsRecording(false);
            return;
        }

        if (!('webkitSpeechRecognition' in window)) {
            appendMessage({
                actor: Actors.SYSTEM,
                content: t('chat_stt_notSupported', 'Speech recognition is not supported in this browser.'),
                timestamp: Date.now(),
            });
            return;
        }

        try {
            // Check permission status first
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

            if (permissionStatus.state === 'denied') {
                appendMessage({
                    actor: Actors.SYSTEM,
                    content: t('chat_stt_microphone_permissionDenied'),
                    timestamp: Date.now(),
                });
                return;
            }

            // Logic to open permission page is omitted for brevity as it's already in the UI Flow
            // if needed, the SidePanel/useAudioRecorder logic for permission popup could be ported here.

            const recognition = new window.webkitSpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = document.documentElement.lang || 'en-US';

            recognition.onstart = () => {
                setIsRecording(true);
                setIsProcessingSpeech(false);
                console.log('Speech recognition started');
            };

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                const fullResult = finalTranscript || interimTranscript;
                if (fullResult && setInputTextRef.current) {
                    setInputTextRef.current(fullResult);
                }
            };

            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
                console.error('Speech recognition error:', event.error);
                if (event.error === 'not-allowed') {
                    appendMessage({
                        actor: Actors.SYSTEM,
                        content: t('chat_stt_microphone_permissionDenied'),
                        timestamp: Date.now(),
                    });
                } else if (event.error !== 'no-speech') {
                    appendMessage({
                        actor: Actors.SYSTEM,
                        content: t('chat_stt_processingFailed', `Speech recognition error: ${event.error}`),
                        timestamp: Date.now(),
                    });
                }
                setIsRecording(false);
                setIsProcessingSpeech(false);
            };

            recognition.onend = () => {
                setIsRecording(false);
                setIsProcessingSpeech(false);
                console.log('Speech recognition ended');
            };

            recognitionRef.current = recognition;
            recognition.start();
        } catch (error) {
            console.error('Error starting speech recognition:', error);
            setIsRecording(false);
            setIsProcessingSpeech(false);
        }
    }, [isRecording, appendMessage, setIsProcessingSpeech, setInputTextRef]);

    useEffect(() => {
        return () => {
            recognitionRef.current?.stop();
        };
    }, []);

    return { isRecording, handleMicClick };
};
