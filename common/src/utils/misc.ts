export function deepCopyJson<T>(o: T): T {
    return JSON.parse(JSON.stringify(o));
} 