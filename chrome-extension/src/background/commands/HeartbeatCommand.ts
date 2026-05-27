import { ICommand, ICommandContext } from './ICommand';

export class HeartbeatCommand implements ICommand {
  async execute(message: any, context: ICommandContext): Promise<void> {
    context.port.postMessage({ type: 'heartbeat_ack' });
  }
}
