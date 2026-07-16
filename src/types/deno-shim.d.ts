// Ambient shims so vitest (node) TypeScript compilation tolerates edge-function
// source files that transitively import Deno globals and `npm:` specifiers.
// Runtime behavior in Deno is unchanged.
declare const Deno: {
  env: { get(name: string): string | undefined; set(name: string, value: string): void; delete(name: string): void };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};
declare module "npm:*";
