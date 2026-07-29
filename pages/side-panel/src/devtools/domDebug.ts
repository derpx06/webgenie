export interface CurrentPageDomDebugResponse {
    success: boolean;
    stateDescription?: string;
    rawState?: {
        tabId?: number | null;
        url?: string;
        title?: string;
        scrollY?: number;
        scrollHeight?: number;
        visualViewportHeight?: number;
        clickableElementsCount?: number;
    };
    error?: string;
}

type ChromeRuntime = typeof chrome.runtime;

function sendRuntimeMessage<TResponse>(runtime: ChromeRuntime, message: unknown): Promise<TResponse> {
    return new Promise((resolve, reject) => {
        runtime.sendMessage(message, (response: TResponse) => {
            const runtimeError = runtime.lastError;
            if (runtimeError) {
                reject(new Error(runtimeError.message));
                return;
            }
            resolve(response);
        });
    });
}

function assertChromeRuntimeAvailable(runtime: ChromeRuntime | undefined): asserts runtime is ChromeRuntime {
    if (!runtime?.sendMessage) {
        throw new Error('Chrome runtime messaging is not available in this context.');
    }
}

export async function extractCurrentPageDomForTesting(): Promise<CurrentPageDomDebugResponse> {
    const runtime = typeof chrome === 'undefined' ? undefined : chrome.runtime;
    assertChromeRuntimeAvailable(runtime);

    const response = await sendRuntimeMessage<CurrentPageDomDebugResponse>(runtime, {
        type: 'TEST_GET_LLM_PAGE_STATE',
    });

    if (!response?.success) {
        const errorMessage = response?.error || 'Unknown current-page DOM extraction error';
        console.error('[WebGenie DOM Debug] Failed to extract current page DOM:', errorMessage, response);
        return response;
    }

    console.group('[WebGenie DOM Debug] Current page DOM extracted for testing');
    console.log('Raw state summary:', response.rawState);
    console.log('Prompt-ready DOM/state description:');
    console.log(response.stateDescription || '(empty)');
    console.groupEnd();

    return response;
}
