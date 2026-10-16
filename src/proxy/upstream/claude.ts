/**
 * The Claude upstream backend.
 *
 * A thin adapter over the handlers that already live in server.ts rather than
 * a reimplementation of them. Introducing the seam must not change observable
 * Claude behavior, so the Agent SDK path, its retry wrapper and the session
 * machinery are reached exactly as before - one call deeper.
 */
import type { UpstreamBackend, UpstreamRequest } from "./backend"

export interface ClaudeUpstreamHandlers<Ctx> {
  /** Serves the Anthropic Messages surface (`/v1/messages`, `/messages`). */
  messages(request: UpstreamRequest<Ctx>): Promise<Response>
  /** Serves the OpenAI Responses surface (`/v1/responses`) by translation. */
  responses(request: UpstreamRequest<Ctx>): Promise<Response>
}

export function createClaudeBackend<Ctx>(handlers: ClaudeUpstreamHandlers<Ctx>): UpstreamBackend<Ctx> {
  return {
    provider: "claude",
    handle(request) {
      return request.endpoint === "responses" ? handlers.responses(request) : handlers.messages(request)
    },
  }
}
