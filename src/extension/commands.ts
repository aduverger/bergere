import type { Ack, Command } from "../shared/protocol.js";
export class CommandLedger {
  private results = new Map<
    string,
    { fingerprint: string; result: Promise<Ack> }
  >();
  execute(
    command: Command,
    generation: string,
    run: () => Promise<void>,
  ): Promise<Ack> {
    const base = {
      type: "ack" as const,
      version: 1 as const,
      id: command.id,
      paneId: command.paneId,
      generation: command.generation,
    };
    if (command.generation !== generation)
      return Promise.resolve({
        ...base,
        ok: false,
        error: "Session changed. Reopen it before sending.",
      });
    const fingerprint = JSON.stringify(command);
    const existing = this.results.get(command.id);
    if (existing)
      return existing.fingerprint === fingerprint
        ? existing.result
        : Promise.resolve({
            ...base,
            ok: false,
            error: "Command ID reused with different content.",
          });
    const result = Promise.resolve()
      .then(run)
      .then(
        () => ({ ...base, ok: true, error: "" }),
        () => ({
          ...base,
          ok: false,
          error:
            "Pi rejected the command. Check the terminal and current session state.",
        }),
      );
    this.results.set(command.id, { fingerprint, result });
    return result;
  }
}
