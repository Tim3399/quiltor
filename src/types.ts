export type Workspace = 'text' | 'figures';
export type SavePhase = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface Chapter {
  id: string;
  title: string;
  body: string;
  note: string;
  [key: string]: unknown;
}

export interface Manuscript {
  chapters: Chapter[];
  words?: Array<string | { w: string; d?: string }>;
  zeichenAktiv?: string[];
  [key: string]: unknown;
}

export interface ProfileExtra { k: string; v: string }
export interface Profile {
  alter?: string;
  rolle?: string;
  aussehen?: string;
  herkunft?: string;
  stimme?: string;
  notizen?: string;
  extra?: ProfileExtra[];
  [key: string]: unknown;
}

export type FigureKind = 'person' | 'ort' | 'konzept';
export interface FigureNode {
  id: string;
  x: number;
  y: number;
  type?: FigureKind;
  label?: string;
  name: string;
  sub?: string;
  accent?: 'ink' | 'gold' | 'rose' | 'moss';
  dash?: boolean;
  pinned?: boolean;
  profile?: Profile;
  [key: string]: unknown;
}

export interface FigureEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'blood' | 'gold';
  gerichtet?: boolean;
  [key: string]: unknown;
}

export interface FigureState {
  nodes: FigureNode[];
  edges: FigureEdge[];
  canvasSize?: { w: number; h: number };
  [key: string]: unknown;
}

export interface GitStatus {
  ok: boolean;
  grund?: string;
  branch?: string;
  upstream?: string;
  remote?: string;
  identitaet?: boolean;
  aenderungen?: string[];
  anzahl?: number;
  unveroeffentlicht?: number;
  vorschlag?: string;
}

export interface CommitInfo { hash: string; kurz: string; datum: string; betreff: string }
export interface WorldInfo { id: string; title: string; githubUrl: string; updated: string }

export const PROFILE_FIELDS: Array<[keyof Profile, string, 'short' | 'long']> = [
  ['alter', 'Alter', 'short'],
  ['rolle', 'Rolle in der Geschichte', 'long'],
  ['aussehen', 'Aussehen', 'long'],
  ['herkunft', 'Herkunft & Vorgeschichte', 'long'],
  ['stimme', 'Stimme & Sprechweise', 'long'],
  ['notizen', 'Notizen', 'long'],
];

export const uid = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;
export const wordCount = (value = '') => value.trim() ? value.trim().split(/\s+/).length : 0;
