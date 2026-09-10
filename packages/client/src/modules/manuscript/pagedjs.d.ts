declare module "pagedjs" {
  export class Previewer {
    preview(
      content: string,
      stylesheets: Array<Record<string, string>>,
      renderTo: HTMLElement,
    ): Promise<unknown>;
    chunker: { destroy(): void; stop(): void };
    polisher: { destroy(): void };
  }
}
