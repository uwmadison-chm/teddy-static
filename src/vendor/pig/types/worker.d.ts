import { type Timing } from "./core.ts";
/** What the page tells the worker when it starts it. */
export interface WorkerSetup {
    timeoutMs?: number;
    /** Shorter waits, for tests. */
    timing?: Partial<Timing>;
}
