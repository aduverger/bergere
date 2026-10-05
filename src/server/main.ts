import { Effect } from "effect";
import { config } from "./config.js";
import { startGateway } from "./gateway.js";
const program = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.acquireRelease(
      Effect.tryPromise(() => startGateway(config())),
      (close) => Effect.promise(close),
    );
    yield* Effect.callback<void>((resume) => {
      const stop = () => resume(Effect.void);
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return Effect.sync(() => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      });
    });
  }),
);
Effect.runPromise(program).catch(() => {
  console.error(
    "Gateway failed. Check configuration, socket ownership, and whether another gateway is running.",
  );
  process.exitCode = 1;
});
