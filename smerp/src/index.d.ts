/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ContentType, PrivateIdentity } from "../../smep/src/index.js";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Runs `fn` after `ms`. Returns a function that cancels it. */
  timer(ms: number, fn: () => void): () => void;
}

// Logging

export type LogFields = Record<string, unknown>;

/** What an injected logger must provide. Never log secrets or content. */
export interface LoggerContract {
  enabled: boolean;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): LoggerContract;
}

export class Logger implements LoggerContract {
  constructor(options?: {
    enabled?: boolean;
    sink?: Pick<Console, "debug" | "info" | "warn" | "error">;
    clock?: Clock;
    prefix?: string;
    fields?: LogFields;
  });
  enabled: boolean;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

// Stored records

export interface StoredEnvelope {
  hash: string;
  contentType: ContentType;
  plaintext: string | Uint8Array;
  senderPublicKeyHex: string;
  recipientPublicKeyHex: string;
  /** The peer. */
  publicKeyHex: string;
  direction: "inbound" | "outbound";
  /** Milliseconds, as the sender stated it. */
  sentAt: number;
  /** Milliseconds. Strictly increasing, so it orders same-second envelopes. */
  receivedAt: number;
}

export interface StoredConversation {
  publicKeyHex: string;
  unreadCount: number;
  lastMessageAt: number;
  hasInbound?: boolean;
  name?: string;
}

/** The state `RelaySession` keeps across reloads. */
export interface RelayState {
  cursor: number;
  epoch: string | null;
  relayPkh: string | null;
  failureCount: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  throttledUntil: number;
  throttledSince: number | null;
}

export interface RelayInput extends Partial<RelayState> {
  relayUrl: string;
  /** What the relay's operator states it is: `"archive"` keeps envelopes indefinitely, `"relay"` makes no retention promise. */
  relayType: string;
  disabled?: boolean;
}

export type StoredRelay = RelayInput;

// Storage

export interface EnvelopesQuery {
  hash?: string;
  publicKeyHex?: string;
  beforeSentAt?: number;
  beforeReceivedAt?: number;
  limit?: number;
}

export interface Storage {
  init(): Promise<void>;
  close(): Promise<void>;
  envelopesGet(options?: EnvelopesQuery): Promise<StoredEnvelope[]>;
  envelopesPut(record: StoredEnvelope): Promise<string>;
  conversationsGet(options?: { publicKeyHex?: string }): Promise<StoredConversation[]>;
  conversationsPut(record: StoredConversation): Promise<string>;
  relaysGet(options?: { relayUrl?: string }): Promise<StoredRelay[]>;
  relaysPut(record: StoredRelay): Promise<string>;
  relaysDelete(options: { relayUrl: string }): Promise<number>;
}

/** Base class for a storage backend: every method throws until overridden. */
export class StorageInterface implements Storage {
  init(): Promise<void>;
  close(): Promise<void>;
  envelopesGet(options?: EnvelopesQuery): Promise<StoredEnvelope[]>;
  envelopesPut(record: StoredEnvelope): Promise<string>;
  conversationsGet(options?: { publicKeyHex?: string }): Promise<StoredConversation[]>;
  conversationsPut(record: StoredConversation): Promise<string>;
  relaysGet(options?: { relayUrl?: string }): Promise<StoredRelay[]>;
  relaysPut(record: StoredRelay): Promise<string>;
  relaysDelete(options: { relayUrl: string }): Promise<number>;
}

export class StorageMemory extends StorageInterface {
  constructor();
}

export class IndexedDbStorage extends StorageInterface {
  /** `key` names the database; the web UI uses the public key. */
  constructor(key: string);
}

// Transport

export interface TransportRequest {
  url: string;
  options?: RequestInit;
  timeout?: number;
  maxBytes?: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface Transporter {
  transport(request: TransportRequest): Promise<TransportResponse>;
}

/** Base class for a transport: `transport` throws until overridden. */
export class TransportInterface implements Transporter {
  transport(request: TransportRequest): Promise<TransportResponse>;
}

/** `fetch`, without following redirects and with a limit on the response size. Pass the class itself. */
export class TransportDefault extends TransportInterface {
  static transport(request: TransportRequest): Promise<TransportResponse>;
}

// Errors

export class SmerpError extends Error {
  constructor(message?: string);
}

export class NotStartedError extends SmerpError {
  constructor();
}

export interface FailedRelay {
  relayUrl: string;
  error: Error;
}

export class DispatchError extends SmerpError {
  constructor(failed: FailedRelay[]);
  failed: FailedRelay[];
}

export class RelayThrottledError extends SmerpError {
  constructor(relayUrl: string, throttledUntil: number);
  relayUrl: string;
  throttledUntil: number;
}

// Client

export const ClientStatus: Readonly<{
  STOPPED: "stopped";
  STARTING: "starting";
  RUNNING: "running";
  STOPPING: "stopping";
}>;

export type ClientStatusValue = (typeof ClientStatus)[keyof typeof ClientStatus];

export const EventTypes: Readonly<{
  ENVELOPE: "envelope";
  CONVERSATION: "conversation";
  RELAY: "relay";
  SYNC: "sync";
  STATUS: "status";
  ERROR: "error";
  REJECTED: "rejected";
}>;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/** Milliseconds since the epoch, added to every event when it is published. */
interface EventBase {
  timestamp: number;
}

export type ClientEvent =
  | (EventBase & { type: "envelope"; envelope: StoredEnvelope })
  | (EventBase & { type: "conversation"; conversation: StoredConversation; created: boolean })
  | (EventBase & { type: "relay"; relay: StoredRelay; deleted: boolean })
  | (EventBase & { type: "sync"; phase: "start" | "end" })
  | (EventBase & { type: "status"; status: ClientStatusValue })
  | (EventBase & { type: "error"; error: Error; relayUrl?: string })
  | (EventBase & { type: "rejected"; hash: string; reason: string; relayUrl: string | null });

export type ClientEventOf<T extends EventType> = Extract<ClientEvent, { type: T }>;

export interface ClientOptions {
  identity: PrivateIdentity;
  transporter?: Transporter;
  storage?: Storage;
  clock?: Clock;
  /** Turns the default logger on. A given `logger` wins over it. */
  debug?: boolean;
  logger?: LoggerContract | null;
  syncIntervalMs?: number;
  /** How many relays sync at once. */
  concurrency?: number;
  /** Makes `send()` push ntfy notifications. */
  notify?: boolean;
  ntfyUrl?: string;
}

export interface SendResult {
  hash: string;
  delivered: string[];
  failed: FailedRelay[];
}

export class SmerpClient {
  constructor(options: ClientOptions);
  readonly status: ClientStatusValue;
  /** Null until `start()` has run. */
  readonly publicKeyHex: string | null;
  readonly ntfyUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Returns a function that unsubscribes. */
  on<T extends EventType>(eventType: T, callback: (event: ClientEventOf<T>) => unknown): () => void;
  /** Throws `NotStartedError` synchronously unless running. Resolves when the round ends. */
  sync(): Promise<void>;
  /** Rejects with `DispatchError` if no relay accepted the envelope. */
  send(
    recipientPublicKeyHex: string,
    plaintext: string | Uint8Array,
    options?: { contentType?: ContentType },
  ): Promise<SendResult>;
  envelopesGet(options?: EnvelopesQuery): Promise<StoredEnvelope[]>;
  conversationsGet(options?: { publicKeyHex?: string }): Promise<StoredConversation[]>;
  /** Null if there is no such conversation or nothing was unread. */
  markRead(publicKeyHex: string): Promise<StoredConversation | null>;
  /** An empty name removes it. Null if there is no such conversation. */
  renameConversation(publicKeyHex: string, name: string): Promise<StoredConversation | null>;
  relaysGet(options?: { relayUrl?: string }): Promise<StoredRelay[]>;
  /** Resolves to the relay's URL. */
  relaysPut(relay: RelayInput): Promise<string>;
  /** Resolves to the number of relays deleted. */
  relaysDelete(options: { relayUrl: string }): Promise<number>;
  /** The topic this peer pushes to us on, for a phone to subscribe to. */
  notifyTopic(publicKeyHex: string): Promise<string>;
}

// Wire format

export const SmerpHeaders: Readonly<{
  cursor: "x-smerp-cursor";
  epoch: "x-smerp-epoch";
  relayPkh: "x-smerp-relay-pkh";
  unauthorized: "x-smerp-unauthorized";
  retryAfter: "retry-after";
}>;

export const Status: Readonly<{
  OK: 200;
  NO_CONTENT: 204;
  BAD_REQUEST: 400;
  UNAUTHORIZED: 401;
  TOO_MANY_REQUESTS: 429;
}>;

export const MAX_ENVELOPE_BYTES: number;
export const MAX_BATCH_BYTES: number;
export const MAX_RESPONSE_BYTES: number;
/** The longest conversation name, in code points. */
export const MAX_CONVERSATION_NAME: number;

export function encodeBatch(envelopes: Array<ArrayBuffer | Uint8Array>): Uint8Array;

/** `error` is set when the framing breaks; `frames` then holds those before the break. */
export function decodeBatch(body: ArrayBuffer | Uint8Array): { frames: ArrayBuffer[]; error?: string };

/** Throws unless `value` is a valid cursor greater than `requested`. */
export function parseCursor(value: string | undefined, requested: number): number;

/** Whole seconds, capped at 24 h. Null for anything else. */
export function parseRetryAfter(value: unknown): number | null;

// Building blocks

/** The session contract `Scheduler` relies on. */
export interface SchedulerSession {
  /** Resolves to whether the session has more to do. */
  step(): Promise<boolean>;
  /** The time before which a step would be pointless. */
  notBefore(): number;
}

export class Scheduler<S extends SchedulerSession = SchedulerSession> {
  static readonly DEFAULTS: Readonly<{ concurrency: number; maxStepsPerRound: number }>;
  constructor(options?: {
    concurrency?: number;
    maxStepsPerRound?: number;
    clock?: Clock;
    onError?: (error: unknown, session: S) => void;
    onCapped?: (session: S) => void;
  });
  add(session: S): void;
  /** Resolves when nothing is pending or running. */
  wake(): Promise<void>;
  /** Not restartable: build a new one. */
  stop(): Promise<void>;
}

export class RelaySession implements SchedulerSession {
  static readonly DEFAULTS: Readonly<{
    ratePerSecond: number;
    burst: number;
    backoffBaseMs: number;
    backoffMaxMs: number;
    defaultThrottleMs: number;
    shortThrottleMs: number;
    throttleChainGapMs: number;
  }>;
  static backoffMs(failureCount: number): number;
  constructor(options: {
    relay: RelayInput;
    identity: PrivateIdentity;
    transporter: Transporter;
    consume: (frames: ArrayBuffer[]) => Promise<unknown>;
    save: (state: RelayState) => Promise<unknown>;
    logger: LoggerContract;
    clock?: Clock;
    ratePerSecond?: number;
    burst?: number;
  });
  readonly relayUrl: string;
  state(): RelayState;
  step(): Promise<boolean>;
  notBefore(): number;
  /** Throws `RelayThrottledError` while throttled, and an error on anything but a 200. */
  post(envelopeBytes: ArrayBuffer | Uint8Array): Promise<unknown>;
}

export class RequestBuilder {
  static readonly DEFAULTS: Readonly<{ timeoutMs: number }>;
  constructor(options: { relayUrl: string; identity: PrivateIdentity; clock?: Clock });
  /** Unsigned when `relayPkh` is null (first contact). */
  buildGet(cursor: number, relayPkh: string | null): Promise<TransportRequest>;
  buildPost(envelopeBytes: ArrayBuffer | Uint8Array, relayPkh: string | null): Promise<TransportRequest>;
}

/** Checks a signed request's auth, for writing a relay. */
export class RequestVerifier {
  constructor(options: { identity: PrivateIdentity; clock?: Clock; maxSkewSeconds?: number });
  verify(request: {
    method: string;
    /** The path and query as received, including the auth parameters. */
    target: string;
    body?: ArrayBuffer | Uint8Array | null;
    /** When the request arrived, for a relay that reads the body first. */
    arrivedAt?: number;
  }): Promise<{ ok: true; pkh: string } | { ok: false; reason: string }>;
}

export class Ingestor {
  constructor(options: {
    identity: PrivateIdentity;
    storage: Storage;
    logger: LoggerContract;
    clock?: Clock;
    onEnvelope?: (envelope: StoredEnvelope) => void;
    onConversation?: (conversation: StoredConversation, created: boolean) => void;
    onRejected?: (rejection: { hash: string; reason: string; relayUrl: string | null }) => void;
  });
  /** Tasks run one at a time, so sessions can ingest in parallel. */
  ingest(frames: ArrayBuffer[], relayUrl?: string | null): Promise<void>;
  markRead(publicKeyHex: string): Promise<StoredConversation | null>;
  rename(publicKeyHex: string, name: string): Promise<StoredConversation | null>;
}

export class NtfyNotifier {
  static readonly DEFAULTS: Readonly<{ windowMs: number }>;
  constructor(options: {
    identity: PrivateIdentity;
    transporter: Transporter;
    ntfyUrl?: string;
    clock?: Clock;
    logger?: LoggerContract;
    windowMs?: number;
  });
  messageSent(peerPublicKeyHex: string): void;
  /** Not restartable. Cancels the windows and flushes what they counted. */
  stop(): void;
}
