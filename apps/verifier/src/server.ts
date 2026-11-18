import { createServer, type Server } from "node:http";
import { createVerifierHandler, type VerifierOptions } from "./app.js";

export interface RunningVerifier {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export type StartVerifierOptions = Omit<VerifierOptions, "publicUrl"> & {
  /** Defaults to the loopback address the server listens on. */
  publicUrl?: string;
  /** 0 picks a free port. Default 0. */
  port?: number;
  /** Interface to bind. Default loopback only. */
  host?: string;
};

export async function startVerifier(options: StartVerifierOptions): Promise<RunningVerifier> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("verifier did not start");
  const url = options.publicUrl ?? `http://${host}:${address.port}`;
  server.on("request", createVerifierHandler({ ...options, publicUrl: url }));
  return {
    url,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
