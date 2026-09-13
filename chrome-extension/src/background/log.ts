/// <reference types="vite/client" />
import { record } from './trace';

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

const createLogger = (namespace: string): Logger => {
  const prefix = `[${namespace}]`;

  const boundDebug = console.debug.bind(console, prefix);
  const boundInfo = console.info.bind(console, prefix);
  const boundWarn = console.warn.bind(console, prefix);
  const boundError = console.error.bind(console, prefix);
  const boundGroup = console.group.bind(console);
  const boundGroupEnd = console.groupEnd.bind(console);

  // Every log line is also persisted to the trace sink (a no-op unless trace capture is enabled).
  const traced =
    (level: LogLevel, write: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      write(...args);
      const [first, ...rest] = args;
      const hasMessage = typeof first === 'string';
      record({
        level,
        kind: 'log',
        component: namespace,
        msg: hasMessage ? first : '',
        data: hasMessage ? (rest.length ? rest : undefined) : args,
      });
    };

  return {
    debug: import.meta.env.DEV ? traced('debug', boundDebug) : () => {},
    info: traced('info', boundInfo),
    warning: traced('warning', boundWarn),
    error: traced('error', boundError),
    group: (label: string) => boundGroup(`${prefix} ${label}`),
    groupEnd: boundGroupEnd,
  };
};

export { createLogger };
