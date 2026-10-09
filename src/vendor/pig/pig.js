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
const LOG_LINES = 500;
const LOADED_FROM = typeof document !== "undefined" && document.currentScript?.src || import.meta.url;
const events = new EventTarget();
let connection;
function connect(options = {}) {
  connection ??= new Connection(options);
}
async function supported() {
  const missing = [];
  if (typeof indexedDB === "undefined") missing.push("IndexedDB");
  if (typeof Worker === "undefined") missing.push("web workers");
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    missing.push("crypto.randomUUID (the page has to be served over https)");
  }
  if (!missing.includes("IndexedDB") && !await canOpenIndexedDB()) {
    missing.push("IndexedDB storage (blocked, or a private window in an older browser)");
  }
  for (const what of missing) console.warn(`[psych-ingestor] This browser can't run the client: no ${what}.`);
  return missing.length === 0;
}
async function start(server, task, parameters, options = {}) {
  const stamp = timeStamp();
  if (typeof server !== "string" || !server || typeof task !== "string" || !task) {
    throw new PigError("bad-call", `start() needs Pig's address and a task code, like start("https://pig.yourlab.edu", "stroop", parameters).`);
  }
  checkParameterTypes(parameters);
  const c = connected();
  const summary = await c.call("start", {
    server,
    task,
    parameters: { ...parameters },
    finalizeWhenAbandoned: options.finalizeWhenAbandoned ?? false,
    clientInfo: clientInfo(),
    stamp
  });
  return c.runFor(summary);
}
function startForURL(server, task, url, options = {}) {
  let search;
  try {
    search = typeof url === "string" ? new URL(url, globalThis.location?.href).search : url.search;
  } catch {
    return Promise.reject(new PigError("bad-call", `startForURL() couldn't read ${JSON.stringify(url)} as a URL.`));
  }
  return start(server, task, Object.fromEntries(new URLSearchParams(search)), options);
}
async function resume(id) {
  const c = connected();
  return c.runFor(await c.call("resume", id));
}
function pending(which = {}) {
  return connected().call("pending", which);
}
async function discardFailed() {
  await connected().call("discardFailed");
}
function debugLog() {
  return [...connection?.logLines ?? []];
}
class Run extends EventTarget {
  #connection;
  /** Recordings record() started that aren't finished yet. */
  #recordings = /* @__PURE__ */ new Set();
  /** This run's ID on this device. Keep it to resume() the run on another page. */
  id;
  task;
  /** The server's run ID, or null until the server run has started. */
  runId = null;
  /** Which time this is for this participant, or null until the server run has started. */
  runNumber = null;
  state = "open";
  constructor(connection2, summary) {
    super();
    this.#connection = connection2;
    this.id = summary.id;
    this.task = summary.task;
    this.update(summary);
  }
  /** @internal */
  update(summary) {
    this.runId = summary.runId;
    this.runNumber = summary.runNumber;
    this.state = summary.state;
  }
  /**
   * Queue an event. Returns at once; the promise resolves with the event's ID once it's
   * safely stored on this device, and rejects if it couldn't be. Await it if you want to
   * know; don't if you'd rather not wait. A failure is also reported as an `error`
   * event on the run either way.
   *
   * `data` is anything that can be turned into JSON, except a field called _client.
   */
  add(data) {
    const stamp = timeStamp();
    if (data !== null && typeof data === "object" && Object.hasOwn(data, "_client")) {
      throw new PigError("bad-event", "_client is filled in by the client. Use another name for your field.");
    }
    const queued = this.#connection.call("add", this.id, data, stamp);
    queued.catch((error) => this.#connection.report(errorNotice(this.id, error)));
    return queued;
  }
  /**
   * Start a media item: a recording, an image, or any other file. It's an event like
   * any other, with `data` stored the same way, and bytes attached with the item's
   * add(). Record the content type in `data`; nothing else knows how to play it.
   * Resolves once the event is stored on this device. Refused if the task isn't set
   * up to take media.
   */
  async startMedia(data) {
    const stamp = timeStamp();
    const eventId = await this.#connection.call("startMedia", this.id, data, stamp);
    return new Media(this.#connection, this.id, eventId);
  }
  /**
   * Record from a MediaRecorder into a new media item. Starts the recorder itself, with
   * `timeslice` (milliseconds between blobs), and stamps the item with the moment the
   * recorder says it started, on the same clock as every event's `_client`. Sends each
   * blob as it comes, and finishes the item when the recorder stops. Stop it with the
   * item's stop(), or the recorder's own. `data` is stored as the item's event, with
   * `content_type` filled in from the recorder unless you give one. Resolves once the
   * item's event is stored.
   */
  async record(recorder, data = {}, { timeslice = 5e3 } = {}) {
    if (recorder.state !== "inactive") {
      throw new PigError("bad-call", "record() starts the recorder itself, so give it one that isn't recording yet.");
    }
    let settle;
    const recording = { recorder, finished: new Promise((resolve) => settle = resolve) };
    this.#recordings.add(recording);
    const done = () => {
      this.#recordings.delete(recording);
      settle();
    };
    const finish = (item2) => item2.finish().catch((error) => this.#connection.report(errorNotice(this.id, error))).finally(done);
    const waiting = [];
    let item;
    let stopped = false;
    const onData = (event) => {
      if (item) item.add(event.data);
      else waiting.push(event.data);
    };
    const onStop = () => {
      recorder.removeEventListener("dataavailable", onData);
      stopped = true;
      if (item) finish(item);
    };
    recorder.addEventListener("dataavailable", onData);
    recorder.addEventListener("stop", onStop, { once: true });
    let started;
    try {
      started = await new Promise((resolve, reject) => {
        recorder.addEventListener("start", resolve, { once: true });
        recorder.addEventListener("error", (event) => reject(event.error ?? event), { once: true });
        recorder.start(timeslice);
      });
    } catch (error) {
      recorder.removeEventListener("dataavailable", onData);
      recorder.removeEventListener("stop", onStop);
      done();
      throw new PigError("recorder", `The recorder didn't start: ${error?.message ?? "no details"}`);
    }
    const stamp = { wall_time: wallTime(), performance_now: started.timeStamp };
    let eventId;
    try {
      eventId = await this.#connection.call(
        "startMedia",
        this.id,
        { content_type: recorder.mimeType, ...data },
        stamp
      );
    } catch (error) {
      recorder.removeEventListener("dataavailable", onData);
      recorder.removeEventListener("stop", onStop);
      if (recorder.state !== "inactive") recorder.stop();
      done();
      throw error;
    }
    item = new Media(this.#connection, this.id, eventId, recording);
    for (const blob of waiting.splice(0)) item.add(blob);
    if (stopped) finish(item);
    return item;
  }
  /**
   * Finalize the run, after everything already added. Resolves once that's queued. Stops
   * any recording record() started and waits for its last blob, which a finalize queued
   * first would refuse.
   */
  async finalize() {
    await Promise.all([...this.#recordings].map(stopRecording));
    await this.#connection.call("finalize", this.id);
  }
  /**
   * Resolves once everything queued for this run has reached the server. Waits as long
   * as that takes, including while offline.
   */
  async sent() {
    await this.#connection.call("sent", this.id);
  }
  /** How much of this run is still waiting to be sent. */
  pending() {
    return this.#connection.call("pending", { run: this.id });
  }
}
class Media {
  #connection;
  #run;
  /** The item's event ID, the one its start was stored under. */
  eventId;
  #recording;
  /** @internal */
  constructor(connection2, run, eventId, recording) {
    this.#connection = connection2;
    this.#run = run;
    this.eventId = eventId;
    this.#recording = recording;
  }
  /**
   * Queue some of the item's bytes. Returns at once, like run.add(); the promise
   * resolves once they're stored on this device, with the part numbers they were
   * given. Parts are numbered in the order you call this, so the stored parts join
   * back together in that order. A blob too big for one part becomes several.
   */
  add(blob) {
    const queued = this.#connection.call("addMedia", this.#run, this.eventId, blob);
    queued.catch((error) => this.#connection.report(errorNotice(this.#run, error)));
    return queued;
  }
  /** Say the item is complete. Resolves once that's queued, after everything added. */
  async finish() {
    await this.#connection.call("finishMedia", this.#run, this.eventId);
  }
  /**
   * For an item from run.record(): stop the recorder. Resolves once its last blob and
   * the item's finish are queued.
   */
  async stop() {
    if (!this.#recording) {
      throw new PigError("bad-call", "stop() is for items from run.record(). Use finish() for this one.");
    }
    await stopRecording(this.#recording);
  }
}
async function stopRecording({ recorder, finished }) {
  if (recorder.state !== "inactive") recorder.stop();
  await finished;
}
class Connection {
  logLines = [];
  calls = /* @__PURE__ */ new Map();
  nextCall = 1;
  /** Runs this page has a Run object for: id → Run */
  runs = /* @__PURE__ */ new Map();
  worker;
  ready;
  constructor({ workerUrl, timing }) {
    const url = workerUrl ?? new URL("./pig-worker.js", LOADED_FROM);
    this.worker = new Worker(url);
    this.worker.addEventListener("message", ({ data }) => this.#receive(data));
    this.worker.addEventListener("error", (event) => {
      this.#log("error", `The client's worker failed to load or crashed: ${event.message ?? "no details"} (${url})`);
      for (const { reject } of this.calls.values()) {
        reject(new PigError("worker", `The client's worker isn't running. Is pig-worker.js at ${url}?`));
      }
      this.calls.clear();
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.call("nudge"));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") this.call("nudge");
      });
    }
    const setup = { timing };
    this.ready = this.call("init", setup);
    this.#log("info", `Psych Ingestor client ${CLIENT_VERSION}, worker at ${url}.`);
  }
  call(method, ...args) {
    const call = this.nextCall++;
    const done = new Promise((resolve, reject) => this.calls.set(call, { resolve, reject }));
    this.worker.postMessage({ call, method, args });
    return done;
  }
  runFor(summary) {
    let run = this.runs.get(summary.id);
    if (run) run.update(summary);
    else {
      run = new Run(this, summary);
      this.runs.set(summary.id, run);
    }
    return run;
  }
  /** Tell the task about something, on the run it's about and on `events`. */
  report(notice) {
    const target = this.runs.get(notice.type === "run" ? notice.run.id : notice.run);
    const { type, ...detail } = notice;
    target?.dispatchEvent(new CustomEvent(type, { detail }));
    events.dispatchEvent(new CustomEvent(type, { detail }));
    if (notice.type === "error") this.#log("error", `Run ${notice.run}: ${notice.message}`);
  }
  #receive(data) {
    if ("reply" in data) {
      const pending2 = this.calls.get(data.reply);
      if (!pending2) return;
      this.calls.delete(data.reply);
      if ("error" in data) pending2.reject(new PigError(data.error.code, data.error.message));
      else pending2.resolve(data.value);
    } else if ("notify" in data) {
      if (data.notify.type === "run") this.runs.get(data.notify.run.id)?.update(data.notify.run);
      this.report(data.notify);
    } else {
      this.#log(data.log.level, data.log.text);
    }
  }
  /** Everything goes to the console, and to debugLog() for later. */
  #log(level, text) {
    this.logLines.push(`${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${text}`);
    if (this.logLines.length > LOG_LINES) this.logLines.shift();
    const write = level === "error" ? console.error : level === "warn" ? console.warn : console.debug;
    write(`[psych-ingestor] ${text}`);
  }
}
function connected() {
  connection ??= new Connection({});
  return connection;
}
function errorNotice(run, error) {
  return { type: "error", run, code: error.code, message: error.message };
}
function timeStamp() {
  return { wall_time: wallTime(), performance_now: performance.now() };
}
function checkParameterTypes(parameters) {
  if (parameters === null || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new PigError(
      "bad-call",
      `start() needs the run's parameters as an object, like { participant_id: "10351" }. To take them from the page's address, use startForURL().`
    );
  }
  for (const [name, value] of Object.entries(parameters)) {
    if (typeof value !== "string") {
      throw new PigError("bad-call", `Parameter values have to be strings, and ${name} is ${JSON.stringify(value)}.`);
    }
  }
}
function canOpenIndexedDB() {
  const name = "psych-ingestor:probe";
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(name);
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase(name);
        resolve(true);
      };
      request.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
function clientInfo() {
  const info = {};
  if (typeof navigator !== "undefined") {
    info.user_agent = navigator.userAgent;
    info.languages = [...navigator.languages ?? []];
  }
  try {
    info.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
  }
  if (typeof screen !== "undefined") {
    info.screen = { width: screen.width, height: screen.height, pixel_ratio: globalThis.devicePixelRatio ?? 1 };
  }
  if (typeof window !== "undefined") {
    info.window = { width: window.innerWidth, height: window.innerHeight };
  }
  return info;
}
export {
  Media,
  PigError,
  Run,
  connect,
  debugLog,
  discardFailed,
  events,
  pending,
  resume,
  start,
  startForURL,
  supported,
  CLIENT_VERSION as version
};
//# sourceMappingURL=pig.js.map
