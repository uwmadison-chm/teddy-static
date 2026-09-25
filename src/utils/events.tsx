// App-wide event bus. Maps each event name to the type of its payload.
type AppEvents = {
    speechbubblestatus: boolean;
    speechbubbleblockerclicked: void;
    recordingnotificationstatus: boolean;
};

type EventName = keyof AppEvents;

const target = new EventTarget();

export function emit<K extends EventName>(name: K, ...[detail]: AppEvents[K] extends void ? [] : [AppEvents[K]]): void {
    target.dispatchEvent(new CustomEvent(name, {detail}));
}

// Returns a function that removes the listener.
export function on<K extends EventName>(name: K, handler: (detail: AppEvents[K]) => void): () => void {
    const listener = (e: Event) => handler((e as CustomEvent<AppEvents[K]>).detail);
    target.addEventListener(name, listener);
    return () => target.removeEventListener(name, listener);
}
