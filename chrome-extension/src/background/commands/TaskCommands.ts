import { t } from "@extension/i18n";
import type { ICommand, ICommandContext } from "./ICommand";

export class CancelTaskCommand implements ICommand {
  async execute(message: unknown, context: ICommandContext): Promise<void> {
    if (!context.currentExecutor) return context.port.postMessage({ type: "error", error: t("bg_errors_noRunningTask") });
    await context.currentExecutor.cancel();
  }
}

export class ResumeTaskCommand implements ICommand {
  async execute(message: unknown, context: ICommandContext): Promise<void> {
    if (!context.currentExecutor) return context.port.postMessage({ type: "error", error: t("bg_cmd_resumeTask_noTask") });
    await context.currentExecutor.resume();
    return context.port.postMessage({ type: "success" });
  }
}

export class PauseTaskCommand implements ICommand {
  async execute(message: unknown, context: ICommandContext): Promise<void> {
    if (!context.currentExecutor) return context.port.postMessage({ type: "error", error: t("bg_errors_noRunningTask") });
    await context.currentExecutor.pause();
    return context.port.postMessage({ type: "success" });
  }
}

export class HumanResponseCommand implements ICommand {
  async execute(message: unknown, context: ICommandContext): Promise<void> {
    if (!context.currentExecutor) return context.port.postMessage({ type: "error", error: t("bg_errors_noRunningTask") });
    const msg = message as { response?: string };
    await context.currentExecutor.submitHumanResponse(msg.response || "");
    return context.port.postMessage({ type: "success" });
  }
}
