import { useState, useCallback, useEffect } from 'react';
import { agentModelStore } from '@extension/storage';

export const useConfig = () => {
    const [hasConfiguredModels, setHasConfiguredModels] = useState<boolean | null>(null);

    const checkModelConfiguration = useCallback(async () => {
        try {
            const configuredAgents = await agentModelStore.getConfiguredAgents();
            setHasConfiguredModels(configuredAgents.length > 0);
        } catch (error) {
            console.error('Error checking model configuration:', error);
            setHasConfiguredModels(false);
        }
    }, []);

    useEffect(() => {
        checkModelConfiguration();
    }, [checkModelConfiguration]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                checkModelConfiguration();
            }
        };

        const handleFocus = () => {
            checkModelConfiguration();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handleFocus);
        };
    }, [checkModelConfiguration]);

    return {
        hasConfiguredModels,
        checkModelConfiguration,
    };
};
