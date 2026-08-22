export const uid = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;
