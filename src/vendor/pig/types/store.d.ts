import type { FailedOp, NewOp, Op, RunRecord, TaskSettings } from "./types.ts";
export declare class Store {
    #private;
    db: IDBDatabase;
    constructor(db: IDBDatabase);
    /** Open the database, creating it the first time. */
    static open(factory?: IDBFactory): Promise<Store>;
    close(): void;
    settings(server: string, task: string): Promise<TaskSettings | undefined>;
    saveSettings(server: string, task: string, settings: TaskSettings): Promise<void>;
    run(id: string): Promise<RunRecord | undefined>;
    allRuns(): Promise<RunRecord[]>;
    saveRun(run: RunRecord): Promise<void>;
    /**
     * Change a run record in place. `change` gets the current record and returns nothing;
     * the read and the write happen in one transaction, so two changes can't interleave.
     * Resolves with the changed record, or undefined if there's none.
     */
    updateRun(id: string, change: (run: RunRecord) => void): Promise<RunRecord | undefined>;
    /**
     * Remove a run and everything still queued for it. Failed ops are kept: they're
     * only ever removed by `discardFailed()`.
     */
    deleteRun(id: string): Promise<void>;
    /**
     * Queue ops for a run. `build` gets the run's record and returns the ops to store,
     * and may change the record while it does: take the next event ID, or note a media
     * item's next part number. The changed record and the ops are written in one
     * transaction, so a number is never handed out twice, and never handed out for
     * something that wasn't stored.
     *
     * Resolves with the stored ops, each with its `seq`.
     */
    queue(runId: string, build: (run: RunRecord) => NewOp[]): Promise<Op[]>;
    /** A run's ops in the order they were queued. */
    ops(runId: string, limit?: number): Promise<Op[]>;
    /** Every op for every run. */
    allOps(): Promise<Op[]>;
    /** Delete ops by `seq`, in one transaction. */
    deleteOps(seqs: number[]): Promise<void>;
    /**
     * Move ops the server refused for good out of the queue and into `failed`, with the
     * server's reason. They stay there until someone calls `discardFailed()`.
     */
    failOps(failures: {
        seq: number;
        reason: string;
    }[]): Promise<void>;
    /** Every op the server refused for good. */
    allFailed(): Promise<FailedOp[]>;
    /** Throw away every failed op. The only way anything in `failed` goes away. */
    discardFailed(): Promise<void>;
    /**
     * Put ops in front of everything else queued for a run. Used when a run's server run
     * has expired: the new server run has to be started before anything else is sent.
     * IndexedDB keys only ever grow, so "in front" means re-adding everything after them.
     */
    prepend(runId: string, newOps: NewOp[]): Promise<void>;
}
