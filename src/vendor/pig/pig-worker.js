(function() {
  "use strict";
  class PigError extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "PigError";
      this.code = code;
    }
  }
  function wallTime(date = /* @__PURE__ */ new Date()) {
    const pad = (n, width = 2) => String(Math.abs(n)).padStart(width, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }
  const CLIENT_VERSION = "0.2.0";
  const SAFE_VALUE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
  const DEFAULTS = {
    // Waiting between tries after a failure: doubling from the first, up to the cap, with
    // up to half of each wait taken off at random so a lab's worth of devices coming back
    // online don't all retry in step.
    firstRetryMs: 1e3,
    maxRetryMs: 6e4,
    // How much goes in one request. The server limits each event; the web server in front
    // of it limits whole requests, so batches stay modest.
    maxBatchEvents: 100,
    maxBatchBytes: 256 * 1024,
    // A run whose page has gone, and that hasn't been touched for this long, counts as
    // abandoned. Long enough that a task moving from one page to the next has resumed it
    // well before then.
    abandonedAfterMs: 3e4,
    // How often the page holding a run says it's still there, and how often a page looks
    // for orphaned runs.
    heartbeatMs: 1e4,
    sweepMs: 3e4,
    // How long resume() waits for another page to let go of a run.
    resumeWaitMs: 5e3,
    // How long start() waits for the server before carrying on as if offline. Someone is
    // looking at the screen while it waits.
    startWaitMs: 5e3
  };
  class Core {
    store;
    http;
    locks;
    /** Tells the page about progress and errors. */
    notify;
    log;
    options;
    /** Runs this page holds the lock for: run ID → function that lets go of it. */
    held = /* @__PURE__ */ new Map();
    /** Runs with a sender working on them. */
    senders = /* @__PURE__ */ new Map();
    /** Runs this page is sending for only because their own page is gone. */
    orphans = /* @__PURE__ */ new Set();
    /** Each run's calls, so they're handled one at a time: run ID → the latest one. */
    chains = /* @__PURE__ */ new Map();
    /** Callers waiting for a run's queue to empty: run ID → [resolve] */
    sentWaiters = /* @__PURE__ */ new Map();
    timers = [];
    closed = false;
    constructor({
      store,
      http,
      locks,
      notify = () => {
      },
      log = () => {
      },
      options = {}
    }) {
      this.store = store;
      this.http = http;
      this.locks = locks;
      this.notify = notify;
      this.log = log;
      this.options = { ...DEFAULTS, ...options };
    }
    /** Start the background work: looking for orphaned runs, now and every so often. */
    begin() {
      this.#every(this.options.sweepMs, () => this.sweep());
      this.#every(this.options.heartbeatMs, () => this.#heartbeat());
      return this.sweep();
    }
    /** Stop everything and let go of every run. Used by the tests. */
    async close() {
      this.closed = true;
      for (const timer of this.timers) clearInterval(timer);
      for (const sender of this.senders.values()) sender.wake();
      for (const release of this.held.values()) release();
      this.held.clear();
    }
    // ------------------------------------------------------------ starting a run
    /**
     * Start a run. When the server can be reached, the server run is started before this
     * returns, so a closed task or a bad link fails here, where the task can tell the
     * participant. Offline, the run starts locally and the server run starts later.
     *
     * `clientInfo` is what the page knows about itself, for the first event; `stamp` is
     * when start() was called.
     */
    async start({
      server,
      task,
      parameters,
      finalizeWhenAbandoned = false,
      clientInfo,
      stamp
    }) {
      const settings = await this.#settings(server, task);
      if (!settings.open) {
        throw new PigError("task-closed", `The task ${JSON.stringify(task)} isn't accepting new data right now.`);
      }
      checkParameters(settings, parameters);
      const id = randomId();
      const now = Date.now();
      await this.store.saveRun({
        id,
        server,
        task,
        parameters,
        settings,
        client_info: clientInfo,
        server_run_id: null,
        run_number: null,
        server_started_at: null,
        // Event 0 is the client's own first event; the task's events count from 1.
        next_event_id: 1,
        finalize_when_abandoned: finalizeWhenAbandoned,
        finalize_queued: false,
        closed: false,
        failed: null,
        created_at: now,
        last_active: now,
        media: {}
      });
      await this.#hold(id);
      await this.store.queue(id, () => [{ kind: "start" }, firstEvent(clientInfo, stamp, null)]);
      this.log("info", `Started collecting data for task ${task}, run ${id}.`);
      const run = await this.#stored(id);
      const [startOp] = await this.store.ops(id, 1);
      const outcome2 = await this.#sendStart(run, startOp, this.options.startWaitMs);
      if (outcome2 === "refused") {
        const failed = (await this.#stored(id)).failed ?? { code: "refused", message: "The server refused the run." };
        await this.store.deleteRun(id);
        this.#letGo(id);
        throw new PigError(failed.code, failed.message);
      }
      if (outcome2 === "later") this.log("info", `Couldn't reach ${server}; run ${id} will start on the server once it can.`);
      this.#ensureSender(id);
      return this.summary(await this.#stored(id));
    }
    /**
     * Pick up a run this page or an earlier one started. Waits a few seconds for another
     * page to let go of it, which is what happens while a task moves between pages.
     */
    async resume(id) {
      if (this.held.has(id)) return this.summary(await this.#stored(id));
      const run = await this.store.run(id);
      if (run === void 0) {
        throw new PigError("not-found", `There's no run ${id} on this device. It may have finished already.`);
      }
      if (run.finalize_queued || run.closed) {
        throw new PigError("finished", `Run ${id} has been finalized, so it can't be resumed. Start a new run.`);
      }
      const got = await this.#hold(id, { waitMs: this.options.resumeWaitMs });
      if (!got) {
        throw new PigError("busy", `This task is already open in another tab or window.`);
      }
      const current = await this.store.run(id);
      if (current === void 0 || current.finalize_queued || current.closed) {
        this.#letGo(id);
        throw new PigError("finished", `Run ${id} has been finalized, so it can't be resumed. Start a new run.`);
      }
      await this.store.updateRun(id, (r) => {
        r.last_active = Date.now();
      });
      this.log("info", `Resumed run ${id}.`);
      this.#ensureSender(id);
      return this.summary(current);
    }
    // ------------------------------------------------------------------ events
    /**
     * Queue an event. Resolves with its event ID once it's stored in IndexedDB. `stamp` is
     * taken on the page when add() was called.
     */
    add(id, data, stamp) {
      return this.#inOrder(id, async () => {
        const run = await this.#openRun(id);
        const json = this.#eventJson(run, data, stamp);
        const [op] = await this.store.queue(id, (r) => [
          { kind: "event", event_id: takeEventId(r), json, bytes: byteLength(json) }
        ]);
        const eventId = op.event_id;
        this.log("debug", `Queued event ${eventId} for run ${id}.`);
        this.#wake(id);
        return eventId;
      });
    }
    /** Queue the finalize. It's sent after everything queued before it. */
    finalize(id) {
      return this.#inOrder(id, async () => {
        const run = await this.#heldRun(id);
        if (run.finalize_queued) return;
        await this.store.queue(id, (r) => {
          r.finalize_queued = true;
          return [{ kind: "finalize" }];
        });
        this.log("info", `Queued finalize for run ${id}.`);
        this.#wake(id);
      });
    }
    /**
     * Resolves once nothing is queued for this run, including anything added before this
     * was called. Never rejects; it just waits.
     */
    async sent(id) {
      const done = new Promise((resolve) => {
        const waiting = this.sentWaiters.get(id) ?? [];
        waiting.push(resolve);
        this.sentWaiters.set(id, waiting);
      });
      await this.#inOrder(id, async () => {
        if ((await this.store.ops(id, 1)).length === 0) this.#settleSent(id);
      });
      await done;
    }
    // ------------------------------------------------------------------ media
    /**
     * Start a media item: an event with bytes attached. Queues the event, and resolves
     * with its event ID, which names the item from then on.
     */
    startMedia(id, data, stamp) {
      return this.#inOrder(id, async () => {
        const run = await this.#openRun(id);
        if (!run.settings.media) {
          throw new PigError(
            "media-off",
            `The task ${JSON.stringify(run.task)} isn't set up to take recordings or other files.`
          );
        }
        const eventId = String(run.next_event_id);
        const json = JSON.stringify({ event_id: eventId, data: { ...this.#checkedData(data), _client: stamp } });
        const size = byteLength(json);
        const limit = run.settings.max_event_size_bytes;
        if (limit && size > limit) {
          throw new PigError("too-big", `This event is ${size} bytes, and this task allows ${limit}.`);
        }
        await this.store.queue(id, (r) => {
          if (takeEventId(r) !== eventId) throw new Error(`Run ${id}'s next event ID changed underneath startMedia().`);
          r.media[eventId] = {
            event_id: eventId,
            server_media_id: null,
            next_part: 1,
            finish_queued: false,
            failed: false,
            start_json: json,
            split: false
          };
          return [{ kind: "media-start", event_id: eventId, json, bytes: size }];
        });
        this.log("debug", `Queued the start of media item ${eventId} for run ${id}.`);
        this.#wake(id);
        return eventId;
      });
    }
    /**
     * Queue a media item's bytes. A blob bigger than the task's largest part is cut into
     * several parts. Resolves with the part numbers it was given, once they're stored.
     */
    addMedia(id, eventId, blob) {
      return this.#inOrder(id, async () => {
        const run = await this.#openRun(id);
        this.#openMedia(run, eventId);
        if (!(blob instanceof Blob)) {
          throw new PigError("bad-media", "Media has to be added as a Blob, like the ones MediaRecorder hands you.");
        }
        if (blob.size === 0) return [];
        const partSize = run.settings.media.max_part_size_bytes;
        const ops = await this.store.queue(id, (r) => {
          const item = r.media[eventId];
          const parts = [];
          for (let offset = 0; offset < blob.size; offset += partSize) {
            const slice = blob.slice(offset, offset + partSize, blob.type);
            parts.push({ kind: "media-part", event_id: eventId, part: item.next_part, blob: slice, bytes: slice.size });
            item.next_part += 1;
          }
          return parts;
        });
        const numbers = ops.map((op) => op.part);
        this.log("debug", `Queued part(s) ${numbers.join(", ")} of media item ${eventId} for run ${id}.`);
        this.#wake(id);
        return numbers;
      });
    }
    /** Queue a media item's finish, with the number of parts it was given. */
    finishMedia(id, eventId) {
      return this.#inOrder(id, async () => {
        const run = await this.#heldRun(id);
        const item = run.media?.[eventId];
        if (item === void 0) throw new PigError("not-found", `Run ${id} has no media item ${eventId}.`);
        if (item.finish_queued) return;
        if (run.finalize_queued) {
          throw new PigError("finished", `Run ${id} has been finalized, so its media can't be finished now.`);
        }
        await this.store.queue(id, (r) => {
          r.media[eventId].finish_queued = true;
          return [{ kind: "media-finish", event_id: eventId, parts: r.media[eventId].next_part - 1 }];
        });
        this.log("info", `Queued the finish of media item ${eventId} for run ${id}.`);
        this.#wake(id);
      });
    }
    // --------------------------------------------------------- what's queued
    /**
     * How much is waiting to be sent: for one run, for one task, or for everything on
     * this device. `bytes` includes media. `failed` counts events and media parts the
     * server refused for good; they're kept, but never sent. `runs` counts runs with anything left to send.
     */
    async pending({ run, task } = {}) {
      const runs = await this.store.allRuns();
      const runTask = new Map(runs.map((r) => [r.id, r.task]));
      const matches = (op) => (run === void 0 || op.run === run) && (task === void 0 || runTask.get(op.run) === task);
      const counts = { events: 0, bytes: 0, failed: 0, runs: 0 };
      const withWork = /* @__PURE__ */ new Set();
      for (const op of await this.store.allOps()) {
        if (!matches(op)) continue;
        withWork.add(op.run);
        if (op.kind === "event" || op.kind === "media-start") counts.events += 1;
        if ("bytes" in op) counts.bytes += op.bytes;
      }
      for (const op of await this.store.allFailed()) {
        if (matches(op)) counts.failed += 1;
      }
      counts.runs = withWork.size;
      return counts;
    }
    /** Throw away every event and media part the server refused for good. */
    async discardFailed() {
      await this.store.discardFailed();
      this.log("info", "Discarded failed events.");
    }
    /** Something changed that might let a waiting sender succeed: try again now. */
    nudge() {
      for (const sender of this.senders.values()) sender.wake();
    }
    // ---------------------------------------------------------------- orphans
    /**
     * Look for runs no page is holding, and finish what they left behind: send anything
     * still queued, and finalize the ones that asked for it once they're abandoned.
     * Also forgets runs with nothing left to send whose server run has certainly expired.
     */
    async sweep() {
      if (this.closed) return;
      const runs = await this.store.allRuns();
      const allOps = await this.store.allOps();
      const queued = new Set(allOps.map((op) => op.run));
      for (const run of runs) {
        if (this.held.has(run.id) || this.senders.has(run.id)) continue;
        const wantsFinalize = run.finalize_when_abandoned && !run.finalize_queued && !run.closed;
        const expired = run.server_started_at !== null && Date.now() - run.server_started_at > run.settings.expires_after_sec * 1e3;
        if (!queued.has(run.id) && !wantsFinalize && !expired) continue;
        if (!queued.has(run.id) && wantsFinalize && Date.now() - run.last_active < this.options.abandonedAfterMs) {
          continue;
        }
        if (!await this.#hold(run.id)) continue;
        const current = await this.store.run(run.id);
        if (current === void 0) {
          this.#letGo(run.id);
          continue;
        }
        const hasOps = (await this.store.ops(run.id, 1)).length > 0;
        if (!hasOps && expired && !(current.finalize_when_abandoned && !current.finalize_queued)) {
          this.log("info", `Forgetting run ${run.id}: nothing left to send, and its server run has expired.`);
          await this.store.deleteRun(run.id);
          this.#letGo(run.id);
          continue;
        }
        if (current.finalize_when_abandoned && !current.finalize_queued && !current.closed && Date.now() - current.last_active >= this.options.abandonedAfterMs) {
          this.log("info", `Run ${run.id} was abandoned; it will be finalized once its queue is sent.`);
          await this.store.updateRun(run.id, (r) => {
            r.finalize_queued = true;
          });
          await this.store.queue(run.id, () => [{ kind: "finalize" }]);
        }
        this.log("info", `Sending what run ${run.id} left behind.`);
        this.#ensureSender(run.id, { orphan: true });
      }
    }
    // ---------------------------------------------------------------- sending
    #ensureSender(id, { orphan = false } = {}) {
      if (this.senders.has(id) || this.closed) return;
      const sender = new Sender();
      this.senders.set(id, sender);
      if (orphan) this.orphans.add(id);
      this.#sendLoop(id, sender, orphan).catch((error) => {
        this.log("error", `The sender for run ${id} stopped:`, error);
        this.notify({ type: "error", run: id, code: "internal", message: String(error?.message ?? error) });
      }).finally(() => {
        this.senders.delete(id);
        if (orphan) {
          this.orphans.delete(id);
          this.#letGo(id);
        }
      });
    }
    /** There's new work for this run's sender. Doesn't cut short a wait after a failure. */
    #wake(id) {
      this.senders.get(id)?.newWork();
    }
    /**
     * Work through one run's queue, front to back, for as long as there's anything in it.
     * An orphaned run's sender stops when the queue is empty; the page's own runs' senders
     * wait for more.
     */
    async #sendLoop(id, sender, orphan) {
      let failures = 0;
      let oneAtATime = false;
      while (!this.closed) {
        const run = await this.store.run(id);
        if (run === void 0) return;
        const ops = await this.store.ops(id, this.options.maxBatchEvents);
        if (ops.length === 0) {
          this.#settleSent(id);
          if (run.closed) {
            this.log("info", `Run ${id} is finished and fully sent.`);
            await this.store.deleteRun(id);
            this.#letGo(id);
            this.notify({ type: "run", run: { ...this.summary(run), state: "done" } });
            return;
          }
          if (orphan) return;
          await sender.idle();
          continue;
        }
        if (run.failed) {
          return;
        }
        const head = ops[0];
        let outcome2;
        if (head.kind === "start") {
          outcome2 = await this.#sendStart(run, head);
        } else if (head.kind === "finalize") {
          outcome2 = await this.#sendFinalize(run, head);
        } else if (head.kind === "media-start") {
          outcome2 = await this.#sendMediaStart(run, head);
        } else if (head.kind === "media-part") {
          outcome2 = await this.#sendPart(run, head);
        } else if (head.kind === "media-finish") {
          outcome2 = await this.#sendMediaFinish(run, head);
        } else {
          const batch = takeBatch(ops, oneAtATime ? 1 : this.options.maxBatchEvents, this.options.maxBatchBytes);
          outcome2 = await this.#sendEvents(run, batch);
          if (outcome2 === "too-big" && batch.length > 1) {
            oneAtATime = true;
            continue;
          }
          if (outcome2 === "too-big") {
            await this.store.failOps([{ seq: batch[0].seq, reason: "The server said this event is too big." }]);
            this.#reportFailed(run, [batch[0].event_id], "The server said this event is too big.");
            outcome2 = "done";
          }
          if (outcome2 === "done") oneAtATime = false;
        }
        if (outcome2 === "later") {
          failures += 1;
          const wait = retryWait(failures, this.options);
          this.log("debug", `Run ${id}: trying again in ${Math.round(wait)} ms.`);
          await sender.wait(wait);
        } else if (outcome2 === "refused") {
          return;
        } else {
          failures = 0;
          await this.#progress(run);
        }
      }
    }
    async #sendStart(run, op, waitMs) {
      const reply = await this.http.startRun(run.server, run.task, run.parameters, waitMs);
      if (reply.ok) {
        await this.store.updateRun(run.id, (r) => {
          r.server_run_id = reply.body.run_id;
          r.run_number = reply.body.run_number;
          r.server_started_at = Date.now();
        });
        await this.store.deleteOps([op.seq]);
        this.log("info", `Run ${run.id} is server run ${reply.body.run_id} (run number ${reply.body.run_number}).`);
        this.notify({ type: "run", run: this.summary(await this.#stored(run.id)) });
        return "done";
      }
      if (reply.retry) {
        this.log("debug", `Couldn't start run ${run.id} on the server yet: ${reply.message}`);
        return "later";
      }
      const code = reply.status === 404 ? "task-unknown" : reply.status === 409 ? "task-closed" : "refused";
      await this.store.updateRun(run.id, (r) => {
        r.failed = { code, message: reply.message };
      });
      this.log("error", `The server refused to start run ${run.id}: ${reply.message}`);
      this.notify({ type: "error", run: run.id, code, message: reply.message });
      return "refused";
    }
    async #sendFinalize(run, op) {
      const reply = await this.http.finalize(run.server, run.task, run.server_run_id);
      if (!reply.ok && reply.retry) return "later";
      if (reply.ok || reply.status === 409) {
        if (!reply.ok) this.log("info", `Run ${run.id} had already closed on the server (${reply.body?.status}).`);
        await this.store.deleteOps([op.seq]);
        await this.store.updateRun(run.id, (r) => {
          r.closed = true;
        });
        return "done";
      }
      return this.#runRefused(run, reply);
    }
    async #sendEvents(run, batch) {
      const body = `{${batch.map((op) => `${JSON.stringify(op.event_id)}:${op.json}`).join(",")}}`;
      const reply = await this.http.sendEvents(run.server, run.task, run.server_run_id, body);
      if (!reply.ok && reply.retry) return "later";
      if (reply.status === 413) return "too-big";
      if (!reply.ok && reply.status !== 422 && reply.status !== 409) return this.#runRefused(run, reply);
      const stored = new Set(reply.body?.stored ?? []);
      const errors = reply.body?.errors ?? {};
      const sentNow = batch.filter((op) => stored.has(op.event_id) && !errors[op.event_id]);
      await this.store.deleteOps(sentNow.map((op) => op.seq));
      this.log("debug", `Run ${run.id}: the server has ${sentNow.length} of ${batch.length} events just sent.`);
      if (reply.status === 409) return this.#serverRunClosed(run, reply);
      const refused = batch.filter((op) => errors[op.event_id]?.can_retry === false);
      if (refused.length > 0) {
        await this.store.failOps(refused.map((op) => ({ seq: op.seq, reason: errors[op.event_id].message })));
        this.#reportFailed(run, refused.map((op) => op.event_id), errors[refused[0].event_id].message);
      }
      const retryable = batch.some((op) => errors[op.event_id]?.can_retry === true);
      return retryable ? "later" : "done";
    }
    async #sendMediaStart(run, op) {
      const reply = await this.http.startMedia(run.server, run.task, run.server_run_id, op.json);
      if (!reply.ok && reply.retry) return "later";
      if (reply.status === 409) return this.#serverRunClosed(run, reply);
      if (!reply.ok) return this.#mediaRefused(run, op.event_id, reply.message);
      await this.store.updateRun(run.id, (r) => {
        r.media[op.event_id].server_media_id = reply.body.media_id;
      });
      await this.store.deleteOps([op.seq]);
      this.log("debug", `Run ${run.id}: media item ${op.event_id} is server media ${reply.body.media_id}.`);
      return "done";
    }
    async #sendPart(run, op) {
      const item = run.media[op.event_id];
      if (item.failed) return this.#keepAside(op, "Part of this media item was refused, so the rest of it is kept here too.");
      const before = await this.pending({ run: run.id });
      const reply = await this.http.sendPart(
        run.server,
        run.task,
        run.server_run_id,
        item.server_media_id,
        op.part,
        op.blob,
        (sentBytes) => {
          this.notify({ type: "progress", run: run.id, pending: { ...before, bytes: before.bytes - sentBytes } });
        }
      );
      if (!reply.ok && reply.retry) return "later";
      if (reply.status === 409 && reply.body?.status !== "in_progress") return this.#serverRunClosed(run, reply);
      if (reply.status === 413) {
        return this.#mediaRefused(
          run,
          op.event_id,
          `The server said part ${op.part} (${op.bytes} bytes) is too big. The web server in front of Pig may allow less than Pig does; see docs/deployment.md.`
        );
      }
      if (!reply.ok) return this.#mediaRefused(run, op.event_id, reply.message);
      await this.store.deleteOps([op.seq]);
      return "done";
    }
    async #sendMediaFinish(run, op) {
      const item = run.media[op.event_id];
      if (item.failed) return this.#keepAside(op, "Part of this media item was refused, so the rest of it is kept here too.");
      if (item.split) {
        this.log("info", `Not finishing media item ${op.event_id} of run ${run.id}: it's split between two server runs.`);
        await this.store.deleteOps([op.seq]);
        return "done";
      }
      const reply = await this.http.finishMedia(run.server, run.task, run.server_run_id, item.server_media_id, op.parts);
      if (!reply.ok && reply.retry) return "later";
      if (reply.status === 409 && reply.body?.status !== "in_progress") return this.#serverRunClosed(run, reply);
      if (!reply.ok) return this.#mediaRefused(run, op.event_id, reply.message);
      await this.store.deleteOps([op.seq]);
      this.log("info", `Media item ${op.event_id} of run ${run.id} is finished, with ${op.parts} parts.`);
      return "done";
    }
    /** Move an op to `failed` without sending it, when its media item has already failed. */
    async #keepAside(op, reason) {
      await this.store.failOps([{ seq: op.seq, reason }]);
      return "done";
    }
    /**
     * The server refused part of a media item for good. Everything still queued for the
     * item goes to `failed`: later parts can't make it whole, and a finish would be
     * refused. The rest of the run carries on.
     */
    async #mediaRefused(run, eventId, message) {
      const ops = await this.store.ops(run.id);
      const own = ops.filter((op) => op.kind.startsWith("media-") && "event_id" in op && op.event_id === eventId);
      await this.store.failOps(own.map((op) => ({ seq: op.seq, reason: message })));
      await this.store.updateRun(run.id, (r) => {
        r.media[eventId].failed = true;
      });
      this.log("error", `The server refused media item ${eventId} of run ${run.id} for good: ${message}`);
      this.notify({ type: "error", run: run.id, code: "media-refused", events: [eventId], message });
      return "done";
    }
    /**
     * The server run closed under us. If it expired, start a new server run and send the
     * rest there, with a first event naming the run it continues. If it was finalized,
     * nothing more belongs in it: throw away what's left.
     *
     * A media item caught partway is started again in the new server run, and its
     * remaining parts go there with the numbers they already had. If some of its parts
     * reached the old server run, the item is split between the two: it can't be
     * finished in either, and joining it means taking the parts from both.
     */
    async #serverRunClosed(run, reply) {
      const status = reply.body?.status;
      if (status === "expired") {
        this.log("info", `Server run ${run.server_run_id} expired; starting a new one for run ${run.id}.`);
        const leftover = await this.store.ops(run.id);
        const oldFirst = leftover.filter((op) => op.kind === "event" && op.event_id === "0");
        await this.store.deleteOps(oldFirst.map((op) => op.seq));
        const current = await this.#stored(run.id);
        const restarts = [];
        const split = [];
        for (const item of Object.values(current.media ?? {})) {
          if (item.server_media_id === null || item.failed) continue;
          const ownOps = leftover.filter((op) => op.kind.startsWith("media-") && "event_id" in op && op.event_id === item.event_id);
          const queuedParts = ownOps.filter((op) => op.kind === "media-part").length;
          const moreToCome = ownOps.length > 0 || !item.finish_queued;
          if (!moreToCome) continue;
          restarts.push({ kind: "media-start", event_id: item.event_id, json: item.start_json, bytes: byteLength(item.start_json) });
          if (queuedParts < item.next_part - 1) split.push(item.event_id);
        }
        const stamp = { wall_time: wallTime(), performance_now: null };
        await this.store.prepend(run.id, [
          { kind: "start" },
          firstEvent(run.client_info, stamp, run.server_run_id),
          ...restarts
        ]);
        await this.store.updateRun(run.id, (r) => {
          r.server_run_id = null;
          r.run_number = null;
          r.server_started_at = null;
          for (const item of Object.values(r.media ?? {})) item.server_media_id = null;
          for (const eventId of split) r.media[eventId].split = true;
        });
        for (const eventId of split) {
          this.log("warn", `Media item ${eventId} of run ${run.id} is split: its first parts are in expired server run ${run.server_run_id}.`);
        }
        this.notify({ type: "run", run: this.summary(await this.#stored(run.id)) });
        return "done";
      }
      const rest = (await this.store.ops(run.id)).filter((op) => op.kind !== "start");
      const events = rest.filter((op) => op.kind === "event" || op.kind === "media-start").length;
      const parts = rest.filter((op) => op.kind === "media-part").length;
      const what = parts > 0 ? `${events} events and ${parts} media parts` : `${events} events`;
      this.log("warn", `Server run ${run.server_run_id} was already finalized; discarding ${what}.`);
      await this.store.deleteOps(rest.map((op) => op.seq));
      await this.store.updateRun(run.id, (r) => {
        r.closed = true;
        r.finalize_queued = true;
      });
      if (events + parts > 0) {
        this.notify({
          type: "error",
          run: run.id,
          code: "discarded",
          message: `The server had already finalized this run, so ${what} were thrown away.`
        });
      }
      return "done";
    }
    /** The server doesn't know this run, or refused a request about it outright. */
    async #runRefused(run, reply) {
      const code = reply.status === 404 ? "run-unknown" : "refused";
      await this.store.updateRun(run.id, (r) => {
        r.failed = { code, message: reply.message };
      });
      this.log("error", `The server refused a request for run ${run.id}: ${reply.message}`);
      this.notify({ type: "error", run: run.id, code, message: reply.message });
      return "refused";
    }
    #reportFailed(run, eventIds, message) {
      this.log("error", `The server refused events ${eventIds.join(", ")} of run ${run.id} for good: ${message}`);
      this.notify({ type: "error", run: run.id, code: "event-refused", events: eventIds, message });
    }
    async #progress(run) {
      this.notify({ type: "progress", run: run.id, pending: await this.pending({ run: run.id }) });
    }
    #settleSent(id) {
      const waiting = this.sentWaiters.get(id);
      if (!waiting) return;
      this.sentWaiters.delete(id);
      for (const resolve of waiting) resolve();
    }
    // -------------------------------------------------------------- settings
    /**
     * The task's settings: fresh from the server when it can be reached, otherwise the
     * copy saved the last time it could. A task's first run on a device has to be online.
     */
    async #settings(server, task) {
      const reply = await this.http.taskSettings(server, task, this.options.startWaitMs);
      if (reply.ok) {
        await this.store.saveSettings(server, task, reply.body);
        return reply.body;
      }
      if (reply.status === 404) {
        throw new PigError("task-unknown", `The server at ${server} has no task called ${JSON.stringify(task)}.`);
      }
      if (!reply.retry) throw new PigError("refused", reply.message);
      const saved = await this.store.settings(server, task);
      if (saved === void 0) {
        throw new PigError(
          "offline",
          `Couldn't reach ${server}, and this device has never done task ${JSON.stringify(task)} before, so it doesn't know the task's settings. The first time a device does a task, it has to be online.`
        );
      }
      this.log("info", `Couldn't reach ${server}; using the saved settings for ${task}.`);
      return saved;
    }
    // ----------------------------------------------------------------- locks
    /**
     * Take the run's lock and keep it until #letGo. With `waitMs`, waits that long for
     * another page to let go; without it, gives up at once if the lock is taken.
     * Resolves with whether we got it.
     */
    #hold(id, { waitMs } = {}) {
      if (this.held.has(id)) return Promise.resolve(true);
      return new Promise((resolve) => {
        let options = { ifAvailable: true };
        if (waitMs !== void 0) {
          const giveUp = new AbortController();
          setTimeout(() => giveUp.abort(), waitMs);
          options = { signal: giveUp.signal };
        }
        this.locks.request(lockName(id), options, (lock) => {
          if (!lock) {
            resolve(false);
            return void 0;
          }
          return new Promise((release) => {
            this.held.set(id, release);
            resolve(true);
          });
        }).catch(() => resolve(false));
      });
    }
    #letGo(id) {
      this.held.get(id)?.();
      this.held.delete(id);
    }
    /**
     * Run `work` after every earlier call made for this run has finished. The page's
     * calls arrive in order, but each one waits on IndexedDB, so without this two calls
     * made back to back could be stored in either order, and a recording's parts must
     * be numbered in the order they were added.
     */
    #inOrder(id, work) {
      const previous = this.chains.get(id) ?? Promise.resolve();
      const result = previous.then(work);
      const settled = result.then(
        () => void 0,
        () => void 0
      );
      this.chains.set(id, settled);
      settled.then(() => {
        if (this.chains.get(id) === settled) this.chains.delete(id);
      });
      return result;
    }
    /** A run this page holds that can still take events. */
    async #openRun(id) {
      const run = await this.#heldRun(id);
      if (run.finalize_queued) {
        throw new PigError("finished", `Run ${id} has been finalized, so it can't take more events.`);
      }
      run.media ??= {};
      return run;
    }
    /** The JSON an event is stored as, after checking it's one the server will take. */
    #eventJson(run, data, stamp) {
      const json = JSON.stringify({ data: { ...this.#checkedData(data), _client: stamp } });
      const size = byteLength(json);
      const limit = run.settings.max_event_size_bytes;
      if (limit && size > limit) {
        throw new PigError("too-big", `This event is ${size} bytes, and this task allows ${limit}.`);
      }
      return json;
    }
    #checkedData(data) {
      if (!isPlainObject(data)) {
        throw new PigError("bad-event", 'An event has to be a plain object, like { type: "trial", rt: 843 }.');
      }
      if (Object.hasOwn(data, "_client")) {
        throw new PigError("bad-event", "_client is filled in by the client. Use another name for your field.");
      }
      return data;
    }
    /** Check a media item can still take parts. */
    #openMedia(run, eventId) {
      const item = run.media[eventId];
      if (item === void 0) throw new PigError("not-found", `Run ${run.id} has no media item ${eventId}.`);
      if (item.finish_queued) {
        throw new PigError("finished", `Media item ${eventId} has been finished, so it can't take more parts.`);
      }
    }
    async #heldRun(id) {
      if (!this.held.has(id)) {
        throw new PigError("not-held", `Run ${id} isn't open on this page. Use resume() to pick it up.`);
      }
      const run = await this.store.run(id);
      if (run === void 0) throw new PigError("not-found", `There's no run ${id} on this device.`);
      return run;
    }
    /** Say the page holding these runs is still here, so they don't count as abandoned. */
    async #heartbeat() {
      for (const id of this.held.keys()) {
        if (this.orphans.has(id)) continue;
        if (!(await this.store.run(id))?.closed) {
          await this.store.updateRun(id, (r) => {
            r.last_active = Date.now();
          });
        }
      }
    }
    /** A run's record, which the caller knows is there. */
    async #stored(id) {
      const run = await this.store.run(id);
      if (run === void 0) throw new PigError("not-found", `There's no run ${id} on this device.`);
      return run;
    }
    #every(ms, work) {
      const timer = setInterval(() => {
        work().catch((error) => this.log("error", "Background work failed:", error));
      }, ms);
      this.timers.push(timer);
    }
    /** What the page gets to know about a run. */
    summary(run) {
      return {
        id: run.id,
        task: run.task,
        runId: run.server_run_id,
        runNumber: run.run_number,
        state: run.failed ? "failed" : run.closed ? "closed" : run.finalize_queued ? "finalizing" : "open",
        failed: run.failed
      };
    }
  }
  class Sender {
    #resolve = null;
    #idle = false;
    #missed = false;
    idle() {
      return this.#sleep(void 0, true);
    }
    wait(ms) {
      return this.#sleep(ms, false);
    }
    newWork() {
      if (this.#resolve === null) this.#missed = true;
      else if (this.#idle) this.wake();
    }
    wake() {
      const resolve = this.#resolve;
      this.#resolve = null;
      resolve?.();
    }
    #sleep(ms, idle) {
      if (idle && this.#missed) {
        this.#missed = false;
        return Promise.resolve();
      }
      this.#missed = false;
      this.#idle = idle;
      return new Promise((resolve) => {
        const timer = ms === void 0 ? void 0 : setTimeout(() => this.wake(), ms);
        this.#resolve = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
  function firstEvent(clientInfo, stamp, continues) {
    const _client = { ...stamp, ...clientInfo, version: CLIENT_VERSION, event: "run_start" };
    if (continues) _client.continues_run = continues;
    const json = JSON.stringify({ data: { _client } });
    return { kind: "event", event_id: "0", json, bytes: byteLength(json) };
  }
  function takeEventId(run) {
    const eventId = String(run.next_event_id);
    run.next_event_id += 1;
    return eventId;
  }
  function checkParameters(settings, parameters) {
    const missing = settings.parameters.filter((name) => !(name in parameters));
    if (missing.length > 0) {
      throw new PigError(
        "parameters",
        `This task needs ${settings.parameters.join(", ")} to start, and ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. Check the link.`
      );
    }
    for (const name of settings.parameters) {
      const value = parameters[name];
      if (typeof value !== "string" || !SAFE_VALUE.test(value)) {
        throw new PigError(
          "parameters",
          `${name}=${JSON.stringify(value)} isn't allowed. Values may use letters, digits, underscore, and dash (not first), 1 to 64 characters. Check the link.`
        );
      }
    }
  }
  function takeBatch(ops, maxEvents, maxBytes) {
    const batch = [];
    let bytes = 0;
    for (const op of ops) {
      if (op.kind !== "event" || batch.length >= maxEvents) break;
      if (batch.length > 0 && bytes + op.bytes > maxBytes) break;
      batch.push(op);
      bytes += op.bytes;
    }
    return batch;
  }
  function retryWait(failures, { firstRetryMs, maxRetryMs }) {
    const full = Math.min(maxRetryMs, firstRetryMs * 2 ** (failures - 1));
    return full * (0.5 + Math.random() / 2);
  }
  function lockName(id) {
    return `psych-ingestor:run:${id}`;
  }
  function randomId() {
    return crypto.randomUUID();
  }
  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function byteLength(text) {
    return new TextEncoder().encode(text).length;
  }
  const DEFAULT_TIMEOUT_MS = 15e3;
  function makeHttp({
    fetch = globalThis.fetch.bind(globalThis),
    XHR = globalThis.XMLHttpRequest,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    async function request(method, url, body, waitMs = timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), waitMs);
      let response;
      try {
        response = await fetch(url, {
          method,
          headers: typeof body === "string" ? { "Content-Type": "application/json" } : {},
          body,
          signal: controller.signal
        });
      } catch (error) {
        const timedOut = controller.signal.aborted;
        return {
          ok: false,
          retry: true,
          status: 0,
          message: timedOut ? `No answer from ${url} in ${waitMs} ms.` : `Couldn't reach ${url}: ${error.message}`
        };
      } finally {
        clearTimeout(timer);
      }
      return outcome(method, url, response.status, parseJson(await response.text()));
    }
    function upload(url, blob, onProgress) {
      if (XHR === void 0) return request("PUT", url, blob);
      return new Promise((resolve) => {
        const xhr = new XHR();
        let timer;
        const stillGoing = () => {
          clearTimeout(timer);
          timer = setTimeout(() => xhr.abort(), timeoutMs);
        };
        const done = (result) => {
          clearTimeout(timer);
          resolve(result);
        };
        xhr.open("PUT", url);
        xhr.upload.onprogress = (event) => {
          stillGoing();
          onProgress?.(event.loaded);
        };
        xhr.onprogress = stillGoing;
        xhr.onload = () => done(outcome("PUT", url, xhr.status, parseJson(xhr.responseText)));
        xhr.onerror = () => done({ ok: false, retry: true, status: 0, message: `Couldn't reach ${url}.` });
        xhr.onabort = () => done({ ok: false, retry: true, status: 0, message: `${url} stopped answering for ${timeoutMs} ms.` });
        stillGoing();
        xhr.send(blob);
      });
    }
    return {
      /**
       * GET /task/{task}. With `waitMs`, gives up sooner than usual: a participant is
       * waiting on this one, and saved settings will do if the network is slow.
       */
      taskSettings(server, task, waitMs) {
        return request("GET", `${base(server)}/task/${encodeURIComponent(task)}`, void 0, waitMs);
      },
      /** POST /task/{task}/run. `waitMs` as for taskSettings. */
      startRun(server, task, parameters, waitMs) {
        return request(
          "POST",
          `${base(server)}/task/${encodeURIComponent(task)}/run`,
          JSON.stringify(parameters),
          waitMs
        );
      },
      /**
       * POST /task/{task}/run/{run_id}, with a body already turned into JSON.
       * The body is built from the exact strings stored in the queue, so a retry sends
       * the same bytes as the first try did.
       */
      sendEvents(server, task, runId, jsonBody) {
        return request("POST", runUrl(server, task, runId), jsonBody);
      },
      /** POST /task/{task}/run/{run_id}/media, with the body already turned into JSON. */
      startMedia(server, task, runId, jsonBody) {
        return request("POST", `${runUrl(server, task, runId)}/media`, jsonBody);
      },
      /** PUT /task/{task}/run/{run_id}/media/{media_id}/{part} */
      sendPart(server, task, runId, mediaId, part, blob, onProgress) {
        return upload(`${runUrl(server, task, runId)}/media/${mediaId}/${part}`, blob, onProgress);
      },
      /** POST /task/{task}/run/{run_id}/media/{media_id}/finish */
      finishMedia(server, task, runId, mediaId, parts) {
        return request("POST", `${runUrl(server, task, runId)}/media/${mediaId}/finish`, JSON.stringify({ parts }));
      },
      /** POST /task/{task}/run/{run_id}/finalize */
      finalize(server, task, runId) {
        return request("POST", `${runUrl(server, task, runId)}/finalize`);
      }
    };
  }
  function base(server) {
    return server.replace(/\/+$/, "");
  }
  function runUrl(server, task, runId) {
    return `${base(server)}/task/${encodeURIComponent(task)}/run/${encodeURIComponent(runId)}`;
  }
  function outcome(method, url, status, body) {
    if (status >= 200 && status < 300) return { ok: true, status, body };
    const firstError = Object.values(body?.errors ?? {})[0];
    const message = body?.message ?? firstError?.message ?? `${method} ${url} answered ${status}.`;
    if (status >= 500 || status === 408 || status === 429) {
      return { ok: false, retry: true, status, body, message };
    }
    return { ok: false, retry: false, status, body, message };
  }
  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return void 0;
    }
  }
  const DATABASE = "psych-ingestor";
  const VERSION = 1;
  class Store {
    db;
    constructor(db) {
      this.db = db;
    }
    /** Open the database, creating it the first time. */
    static async open(factory = globalThis.indexedDB) {
      const request = factory.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("settings", { keyPath: ["server", "task"] });
        db.createObjectStore("runs", { keyPath: "id" });
        const ops = db.createObjectStore("ops", { keyPath: "seq", autoIncrement: true });
        ops.createIndex("by_run", ["run", "seq"]);
        db.createObjectStore("failed", { keyPath: "seq" });
      };
      return new Store(await settle(request));
    }
    close() {
      this.db.close();
    }
    // ---------------------------------------------------------------- settings
    async settings(server, task) {
      const record = await this.#get("settings", [server, task]);
      return record?.settings;
    }
    async saveSettings(server, task, settings) {
      await this.#put("settings", { server, task, settings, saved_at: Date.now() });
    }
    // -------------------------------------------------------------------- runs
    run(id) {
      return this.#get("runs", id);
    }
    allRuns() {
      return this.#transaction(
        ["runs"],
        "readonly",
        (t) => settle(t.objectStore("runs").getAll())
      );
    }
    saveRun(run) {
      return this.#put("runs", run);
    }
    /**
     * Change a run record in place. `change` gets the current record and returns nothing;
     * the read and the write happen in one transaction, so two changes can't interleave.
     * Resolves with the changed record, or undefined if there's none.
     */
    updateRun(id, change) {
      return this.#transaction(["runs"], "readwrite", async (t) => {
        const runs = t.objectStore("runs");
        const run = await settle(runs.get(id));
        if (run === void 0) return void 0;
        change(run);
        runs.put(run);
        return run;
      });
    }
    /**
     * Remove a run and everything still queued for it. Failed ops are kept: they're
     * only ever removed by `discardFailed()`.
     */
    deleteRun(id) {
      return this.#transaction(["runs", "ops"], "readwrite", async (t) => {
        t.objectStore("runs").delete(id);
        const keys = await settle(
          t.objectStore("ops").index("by_run").getAllKeys(runRange(id))
        );
        for (const key of keys) t.objectStore("ops").delete(key);
      });
    }
    // --------------------------------------------------------------------- ops
    /**
     * Queue ops for a run. `build` gets the run's record and returns the ops to store,
     * and may change the record while it does: take the next event ID, or note a media
     * item's next part number. The changed record and the ops are written in one
     * transaction, so a number is never handed out twice, and never handed out for
     * something that wasn't stored.
     *
     * Resolves with the stored ops, each with its `seq`.
     */
    queue(runId, build) {
      return this.#transaction(["runs", "ops"], "readwrite", async (t) => {
        const runs = t.objectStore("runs");
        const run = await settle(runs.get(runId));
        if (run === void 0) throw new Error(`There's no run ${runId} on this device.`);
        run.media ??= {};
        const built = build(run);
        run.last_active = Date.now();
        runs.put(run);
        const stored = [];
        for (const newOp of built) {
          const op = { ...newOp, run: runId };
          const seq = await settle(t.objectStore("ops").add(op));
          stored.push({ ...op, seq });
        }
        return stored;
      });
    }
    /** A run's ops in the order they were queued. */
    ops(runId, limit) {
      return this.#transaction(
        ["ops"],
        "readonly",
        (t) => settle(t.objectStore("ops").index("by_run").getAll(runRange(runId), limit))
      );
    }
    /** Every op for every run. */
    allOps() {
      return this.#transaction(
        ["ops"],
        "readonly",
        (t) => settle(t.objectStore("ops").getAll())
      );
    }
    /** Delete ops by `seq`, in one transaction. */
    deleteOps(seqs) {
      return this.#transaction(["ops"], "readwrite", async (t) => {
        for (const seq of seqs) t.objectStore("ops").delete(seq);
      });
    }
    /**
     * Move ops the server refused for good out of the queue and into `failed`, with the
     * server's reason. They stay there until someone calls `discardFailed()`.
     */
    failOps(failures) {
      return this.#transaction(["ops", "failed"], "readwrite", async (t) => {
        const ops = t.objectStore("ops");
        for (const { seq, reason } of failures) {
          const op = await settle(ops.get(seq));
          if (op === void 0) continue;
          ops.delete(seq);
          t.objectStore("failed").put({ ...op, reason, failed_at: Date.now() });
        }
      });
    }
    /** Every op the server refused for good. */
    allFailed() {
      return this.#transaction(
        ["failed"],
        "readonly",
        (t) => settle(t.objectStore("failed").getAll())
      );
    }
    /** Throw away every failed op. The only way anything in `failed` goes away. */
    discardFailed() {
      return this.#transaction(["failed"], "readwrite", async (t) => {
        t.objectStore("failed").clear();
      });
    }
    /**
     * Put ops in front of everything else queued for a run. Used when a run's server run
     * has expired: the new server run has to be started before anything else is sent.
     * IndexedDB keys only ever grow, so "in front" means re-adding everything after them.
     */
    prepend(runId, newOps) {
      return this.#transaction(["ops"], "readwrite", async (t) => {
        const store = t.objectStore("ops");
        const existing = await settle(store.index("by_run").getAll(runRange(runId)));
        for (const op of existing) store.delete(op.seq);
        for (const op of [...newOps, ...existing]) {
          const copy = { ...op, run: runId };
          delete copy.seq;
          await settle(store.add(copy));
        }
      });
    }
    // ------------------------------------------------------------------ helpers
    #get(storeName, key) {
      return this.#transaction(
        [storeName],
        "readonly",
        (t) => settle(t.objectStore(storeName).get(key))
      );
    }
    #put(storeName, value) {
      return this.#transaction([storeName], "readwrite", async (t) => {
        t.objectStore(storeName).put(value);
      });
    }
    /**
     * Run `work` in a transaction, and resolve with what it returned once the transaction
     * has committed. Resolving only after commit is what makes "it's in the queue" true:
     * a write isn't durable until then.
     *
     * `work` may await requests made on this transaction, but nothing else. Waiting on
     * anything outside IndexedDB lets the transaction commit early.
     */
    #transaction(storeNames, mode, work) {
      return new Promise((resolve, reject) => {
        const t = this.db.transaction(storeNames, mode, { durability: "strict" });
        let result;
        let failure;
        t.oncomplete = () => failure ? reject(failure) : resolve(result);
        t.onabort = () => reject(failure ?? t.error ?? new Error("Transaction aborted."));
        t.onerror = () => {
        };
        work(t).then(
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            try {
              t.abort();
            } catch {
            }
          }
        );
      });
    }
  }
  function runRange(runId) {
    return IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]);
  }
  function settle(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const METHODS = /* @__PURE__ */ new Set(["start", "resume", "add", "startMedia", "addMedia", "finishMedia", "finalize", "sent", "pending", "discardFailed", "nudge"]);
  let core;
  let ready;
  self.addEventListener("message", async ({ data: { call, method, args } }) => {
    try {
      if (method === "init") {
        ready ??= setUp(args[0] ?? {});
        await ready;
        return send({ reply: call, value: null });
      }
      await ready;
      if (!core || !METHODS.has(method)) throw new Error(`Unknown method ${method}.`);
      const value = await core[method](...args);
      send({ reply: call, value });
    } catch (error) {
      const { code, message } = error;
      send({ reply: call, error: { code: code ?? "internal", message: String(message ?? error) } });
    }
  });
  self.addEventListener("online", () => core?.nudge());
  async function setUp(options) {
    const store = await Store.open();
    core = new Core({
      store,
      http: makeHttp({ timeoutMs: options.timeoutMs }),
      locks: navigator.locks ?? everyoneGetsTheLock,
      notify: (notice) => send({ notify: notice }),
      log: (level, ...parts) => send({ log: { level, text: parts.map(describe).join(" ") } }),
      options: options.timing
    });
    core.begin().catch((error) => send({ log: { level: "error", text: `Sweep failed: ${describe(error)}` } }));
  }
  const everyoneGetsTheLock = {
    request: async (name, _options, callback) => callback({ name, mode: "exclusive" })
  };
  function send(message) {
    self.postMessage(message);
  }
  function describe(part) {
    if (part instanceof Error) return part.stack ?? part.message;
    return typeof part === "string" ? part : JSON.stringify(part);
  }
})();
//# sourceMappingURL=pig-worker.js.map
