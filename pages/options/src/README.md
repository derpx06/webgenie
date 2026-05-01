# Options Page Module

The options page provides centralized configuration and management for the WebSurfer extension, including LLM provider settings, security policies, and application preferences.

## Overview

The options page enables users to:
- **Configure LLM Providers**: OpenAI, Anthropic, Google, Ollama, etc.
- **Set Firewall Rules**: URL allowlisting and blocking
- **General Settings**: App behavior, experimental features
- **Analytics**: Track and manage performance metrics
- **Voice Settings**: Configure voice interaction

## Directory Structure

```
options/src/
├── components/          # React components organized by settings domain
│   ├── ModelSettings.tsx  # LLM provider configuration
│   ├── FirewallSettings.tsx # URL filtering and permissions
│   ├── GeneralSettings.tsx  # App-wide settings
│   ├── AnalyticsSettings.tsx # Performance tracking
│   ├── Layout.tsx         # Page structure
│   └── voiceOrb/         # Voice interaction UI
├── Options.tsx          # Main options container
└── index.tsx           # Entry point
```

## Settings Panels

### Model Settings

Configure language model providers and parameters:

```typescript
// Access provider configuration
interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'ollama';
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}
```

**Supported Providers:**
- OpenAI (GPT-4, GPT-3.5)
- Anthropic (Claude)
- Google (Gemini)
- Ollama (Local models)

### Firewall Settings

Manage URL-based access controls:

```typescript
// URL filtering configuration
interface FirewallConfig {
  mode: 'whitelist' | 'blacklist';
  urls: string[];
  patterns: RegExp[];
  allowedDomains: string[];
}
```

**Features:**
- URL allowlisting/blocklisting
- Domain restrictions
- Pattern matching
- Custom rules

### General Settings

Application-wide preferences:

```typescript
interface GeneralConfig {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  autoSave: boolean;
  enabledFeatures: string[];
  experimental: Record<string, boolean>;
  loggingLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

**Options:**
- Theme selection
- Language preference
- Auto-save behavior
- Feature toggles
- Experimental features
- Logging configuration

### Analytics Settings

Control performance tracking:

```typescript
interface AnalyticsConfig {
  enabled: boolean;
  detailedMetrics: boolean;
  trackingLevel: 'basic' | 'detailed' | 'full';
  retentionDays: number;
  exportMetrics: boolean;
}
```

## Component Structure

```typescript
import { Layout } from '@src/components';
import { ModelSettings, FirewallSettings } from '@src/components';

export function Options() {
  return (
    <Layout>
      <section>
        <ModelSettings />
        <FirewallSettings />
        <GeneralSettings />
        <AnalyticsSettings />
      </section>
    </Layout>
  );
}
```

## Configuration Management

Settings are persisted using Chrome storage:

```typescript
import { configStore } from '@extension/storage';

// Read configuration
const config = await configStore.getConfig();

// Update configuration
await configStore.updateConfig({ provider: 'anthropic' });

// Listen to changes
configStore.on('change', (newConfig) => {
  console.log('Configuration updated:', newConfig);
});
```

## Best Practices

1. **Use barrel exports** - Import from `@src/components`
2. **Centralized storage** - Store settings in `@extension/storage`
3. **Validation** - Validate all user inputs before saving
4. **Feedback** - Show save confirmation/errors to user
5. **Defaults** - Provide sensible defaults for all settings
6. **Backwards compatibility** - Handle config migrations

## Security Considerations

When handling sensitive configuration:

1. **API Keys**: Never log or expose credentials
2. **Validation**: Validate URLs and patterns
3. **Encryption**: Consider encrypting sensitive data
4. **Permissions**: Apply principle of least privilege
5. **Audit**: Log configuration changes for security review

## Usage Examples

### Reading Settings

```typescript
import { useConfig } from '@extension/storage/hooks';

function MyComponent() {
  const { config } = useConfig();
  
  return (
    <div>
      <p>Provider: {config.provider}</p>
      <p>Model: {config.model}</p>
    </div>
  );
}
```

### Updating Settings

```typescript
import { updateConfig } from '@extension/storage';

async function changeProvider(newProvider: string) {
  try {
    await updateConfig({ provider: newProvider });
    showSuccessMessage('Settings updated');
  } catch (error) {
    showErrorMessage('Failed to update settings');
  }
}
```

### Validating Configuration

```typescript
import { validateConfig } from '@extension/storage';

async function saveSettings(newConfig) {
  const validation = await validateConfig(newConfig);
  
  if (!validation.valid) {
    showErrors(validation.errors);
    return;
  }
  
  await updateConfig(newConfig);
}
```

## Extension Points

The options page can be extended with:
- Custom settings panels
- Provider-specific options
- Advanced/power-user settings
- Performance tuning options
- Debug/development tools
