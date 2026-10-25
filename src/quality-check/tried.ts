// The settings tried on this device, kept in the browser so that a tester who
// comes back can see what they've already done. It's only a convenience: pig
// has the real record, and if storage is blocked the page works without it.

const KEY = "teddy-quality-check-tried";

export interface Tried {
    mimeType: string;
    formatLabel: string;
    bitrate: number;
    sizeLabel: string;
    up: number;
    down: number;
}

export function sameSettings(a: Pick<Tried, "mimeType" | "bitrate" | "sizeLabel">, b: Pick<Tried, "mimeType" | "bitrate" | "sizeLabel">): boolean {
    return a.mimeType == b.mimeType && a.bitrate == b.bitrate && a.sizeLabel == b.sizeLabel;
}

export function loadTried(): Tried[] {
    try {
        const tried = JSON.parse(localStorage.getItem(KEY) ?? "[]");
        return Array.isArray(tried) ? tried : [];
    } catch {
        return [];
    }
}

function save(tried: Tried[]): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(tried));
    } catch {
        // Not remembered this time.
    }
}

// Adds `settings` to the list, or moves them to the end if they're there
// already, and returns the new list.
export function rememberTried(settings: Omit<Tried, "up" | "down">): Tried[] {
    const tried = loadTried();
    const index = tried.findIndex(t => sameSettings(t, settings));
    const entry = index < 0 ? {...settings, up: 0, down: 0} : tried.splice(index, 1)[0];
    tried.push(entry);
    save(tried);
    return tried;
}

// Counts a rating for the settings most recently tried, and returns the new list.
export function rememberRating(rating: "up" | "down"): Tried[] {
    const tried = loadTried();
    const last = tried[tried.length - 1];
    if (last) {
        last[rating] += 1;
        save(tried);
    }
    return tried;
}

export function forgetTried(): Tried[] {
    save([]);
    return [];
}

const TESTER_KEY = "teddy-quality-check-tester";

export function loadTester(): string {
    try {
        return localStorage.getItem(TESTER_KEY) ?? "";
    } catch {
        return "";
    }
}

export function saveTester(tester: string): void {
    try {
        localStorage.setItem(TESTER_KEY, tester);
    } catch {
        // Not remembered this time.
    }
}
