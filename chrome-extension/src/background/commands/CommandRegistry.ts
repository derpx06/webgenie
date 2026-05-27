import type { ICommand } from './ICommand';

export class CommandRegistry {
  private commands = new Map<string, ICommand>();

  register(type: string, command: ICommand): void {
    this.commands.set(type, command);
  }

  get(type: string): ICommand | undefined {
    return this.commands.get(type);
  }
}
