import { render } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { I18nProvider } from "../../i18n";
import { quiltorClient } from "../../platform";
import { TextWorkspace } from "./TextWorkspace";

export const historyApi = quiltorClient.application.history;
export const writingAssistanceApi = quiltorClient.application.writingAssistance;

export const manuscript = {
  chapters: [{ id: "c1", title: "Prolog", body: "Hallo Welt", note: "" }],
};
export const figures = {
  nodes: [{ id: "n1", x: 0, y: 0, name: "Testfigur" }],
  edges: [],
};

export function TestProviders({ children }: PropsWithChildren) {
  return <I18nProvider>{children}</I18nProvider>;
}

export function requireValue<T>(value: T | null | undefined, message = "Expected value"):
  T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

export function renderWorkspace(props: React.ComponentProps<typeof TextWorkspace>) {
  return render(
    <TestProviders>
      <TextWorkspace {...props} />
    </TestProviders>,
  );
}
