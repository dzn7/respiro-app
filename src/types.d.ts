// Contrato entre main e renderer. Tudo que cruza o IPC é JSON destes tipos.

export type CategoryId = 'packages' | 'docker' | 'node' | 'xcode' | 'browsers' | 'homebrew' | 'appcaches' | 'trash';

export type CommandKey =
  | 'pnpm-prune' | 'npm-clean' | 'yarn-clean' | 'bun-clean' | 'pip-purge' | 'brew-cleanup'
  | 'docker-builder-prune' | 'docker-rm-container' | 'docker-rm-image' | 'docker-volume-rm'
  | 'simctl-delete-unavailable' | 'empty-trash';

/** null = protegido: aparece, mas não pode ser limpo. */
export type Action = { kind: 'trash'; path: string } | { kind: 'cmd'; key: CommandKey; arg?: string } | null;

export interface Item {
  id: string;
  name: string;
  detail?: string;
  /** bytes ocupados */
  size: number;
  /** bytes que a limpeza devolve; null = a ferramenta só sabe depois */
  freeable: number | null;
  /** entra no total seguro e vem marcado */
  safe: boolean;
  /** motivo de atenção ou proteção */
  note?: string;
  lastUsed?: number;
  /** pasta real, para "Mostrar no Finder" e para medir antes/depois */
  path?: string;
  /** exige confirmação individual e não vai para a Lixeira (volume Docker, esvaziar Lixeira) */
  individual?: boolean;
  /** pasta do root (criada com sudo): a limpeza pede a senha do macOS para devolvê-la ao usuário */
  admin?: boolean;
  /** em uso agora (projeto ativo, app ou Xcode aberto…): limpável só por escolha explícita, nunca vem marcado */
  inUse?: boolean;
  /** partes que o comando oficial remove juntas (só exibição) */
  parts?: { name: string; size: number }[];
  /** comando oficial, para mostrar na confirmação */
  command?: string;
  action: Action;
}

export type CategoryStatus = 'ok' | 'unavailable' | 'needs-access' | 'error';

export interface Category {
  id: CategoryId;
  name: string;
  blurb: string;
  status: CategoryStatus;
  message?: string;
  notice?: string;
  size: number;
  items: Item[];
}

/** O que cada arquivo de categoria devolve; scan.js completa o resto. */
export type CategoryScan = Partial<Pick<Category, 'status' | 'message' | 'notice' | 'size'>> & { items: Item[] };

export interface ScanContext {
  home: string;
  staleDays: number;
  /** refs "categoria/item" que a pessoa mandou ignorar */
  ignored: Set<string>;
  sizeCache: Record<string, { key: string; size: number }>;
}

export interface Disk { name: string; total: number; free: number }

export interface Scan { at: number; ms: number; categories: Category[] }

export interface IgnoredItem { ref: string; name: string; category: string }

export type Theme = 'system' | 'light' | 'dark';

export interface Prefs {
  simulate: boolean;
  staleDays: 30 | 60 | 90;
  theme: Theme;
  scanOnLaunch: boolean;
  ignored: IgnoredItem[];
}

export interface CleanResult {
  simulated: boolean;
  freed: number;
  trashed: number;
  /** itens limpos cujo ganho a ferramenta não informa */
  unknown: number;
  done: string[];
  failed: { ref: string; name: string; message: string }[];
  docker: boolean;
  /** quanto o espaço livre do disco mudou (statfs antes/depois); 0 na simulação */
  disk: number;
}

export interface HistoryEntry { at: number; freed: number; trashed: number; count: number; disk?: number }

export interface State { disk: Disk; scan: Scan | null; history: HistoryEntry[]; prefs: Prefs; scanning: boolean; fullDiskAccess: boolean;
  /** categorias que a análise procura, na ordem fixa (para o estado de carregamento) */
  catalog: { id: CategoryId; name: string }[] }

export type Progress = { done: number; total: number; category?: Category; absent?: CategoryId; finished?: Scan };

export interface RespiroApi {
  state(): Promise<State>;
  scan(): Promise<Scan>;
  clean(refs: string[]): Promise<CleanResult>;
  setPrefs(prefs: Partial<Prefs>): Promise<Prefs>;
  reveal(ref: string): Promise<void>;
  open(target: 'full-disk-access' | 'docker'): Promise<void>;
  onProgress(cb: (p: Progress) => void): void;
  onCommand(cb: (command: 'rescan' | 'preferences' | 'history') => void): void;
}

declare global {
  interface Window { respiro: RespiroApi }
}
