import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useWebSocket } from "./hooks/use-websocket";
import { createPtyRouter, type PtyRouter } from "./pty-router";
import type { ClientMessage } from "../lib/xtmux/types";

export type { PtySink, SocketSubscriber } from "./pty-router";

/**
 * The socket multiplexer (§7.4).
 *
 * This owns the one connection; `pty-router.ts` owns the routing rules. Which
 * task is on screen, which PTY a tab is attached to and when to attach are all
 * policy that lives above here — the router only knows ptyIds.
 */
export interface PtyContextValue
  // The socket's own callbacks are not part of the API a component gets: a
  // consumer that could call `handleConnect` could fake a reconnect and clear
  // every attachment out from under the terminals.
  extends Omit<PtyRouter, "route" | "handleConnect" | "handleDisconnect"> {
  isConnected: boolean;
  /** Client messages that are not PTY traffic: list, kill, acknowledge,
   * project CRUD. */
  send: (message: ClientMessage) => void;
}

const PtyContext = createContext<PtyContextValue | null>(null);

export function PtyProvider({ children }: { children: ReactNode }) {
  // The router is built once and outlives every reconnect, because the queues
  // and the attached set are this client's state, not the socket's.
  const sendRef = useRef<(message: ClientMessage) => void>(() => {});
  const router = useRef<PtyRouter | null>(null);
  if (router.current === null) {
    router.current = createPtyRouter((message) => sendRef.current(message));
  }
  const routerValue = router.current;

  const { send, isConnected } = useWebSocket({
    onMessage: useCallback((message) => routerValue.route(message), [routerValue]),
    onConnect: useCallback(() => routerValue.handleConnect(), [routerValue]),
    onDisconnect: useCallback(() => routerValue.handleDisconnect(), [routerValue]),
  });
  sendRef.current = send;

  // Stable across reconnects, deliberately. `isConnected` re-memoizes the
  // context value, and a `send` that changed identity with it would ripple out
  // through every callback built on it — including the terminal's `onReady`,
  // whose identity is in the init effect's dependencies. That effect disposes
  // the xterm instance and builds a new one, so an unstable `send` tears the
  // user's grid down and rebuilds it on every connect and every drop.
  const stableSend = useCallback((message: ClientMessage) => sendRef.current(message), []);

  const value = useMemo<PtyContextValue>(
    () => ({ ...routerValue, isConnected, send: stableSend }),
    [routerValue, isConnected, stableSend],
  );

  return <PtyContext.Provider value={value}>{children}</PtyContext.Provider>;
}

export function usePty(): PtyContextValue {
  const value = useContext(PtyContext);
  if (!value) throw new Error("usePty must be used within a PtyProvider");
  return value;
}

/** For components that render outside a provider — a design-system preview of
 * the terminal, say — where routing is simply not available and that is fine. */
export function usePtyOptional(): PtyContextValue | null {
  return useContext(PtyContext);
}
