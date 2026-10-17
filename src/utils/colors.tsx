// Colors are defined in src/styles/colors.css. Code that needs one uses it as
// var(--name), so they're only defined there.

// The color `fraction` of the way from `from` to `to`, both CSS colors.
export function mixColors(from: string, to: string, fraction: number): string {
    return `color-mix(in srgb, ${from}, ${to} ${fraction * 100}%)`;
}
