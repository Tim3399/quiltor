export declare function readPolicy(): {
  directives: Record<string, string[]>;
  webllmHosts: string[];
  testHooksOrigin: string;
  designScriptSrcExtra: string[];
};
export declare function buildPolicy(options?: {
  design?: boolean;
  policy?: ReturnType<typeof readPolicy>;
}): string;
