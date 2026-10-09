/** An error from the client. `code` says which kind; `message` is for people. */
export declare class PigError extends Error {
    code: string;
    constructor(code: string, message: string);
}
/** The local time with its UTC offset, like 2026-10-02T14:03:11.482-05:00. */
export declare function wallTime(date?: Date): string;
