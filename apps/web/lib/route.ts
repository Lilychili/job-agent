import "server-only";
import { ValidationError } from "@jobagent/core";
import { errorResponse } from "./server";

/** Wraps a route handler: resolves params and turns any thrown error into the right HTTP response. */
export function route<P = object>(handler: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      return await handler(req, await ctx.params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** The request's JSON body as an object, or a 400. */
export async function readBody<T extends object>(req: Request): Promise<Partial<T>> {
  const body: unknown = await req.json().catch(() => null);
  if (typeof body !== "object" || body === null) throw new ValidationError("Invalid request.");
  return body as Partial<T>;
}
