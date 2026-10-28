// Contrato entre main e renderer. Tudo que cruza o IPC é JSON destes tipos.

/** Texto traduzível: chave do dicionário (src/shared/locales) e parâmetros. */
export interface Msg { key: string; params?: Record<string, unknown> }
/** Dado (nome de pasta, de imagem) fica string; frase do app é Msg. */
export type Text = string | Msg;

export type CategoryId = 'packages' | 'docker' | 'node' | 'xcode' | 'browsers' | 'backups' | 'appcaches' | 'trash';

export type CommandKey =
  | 'pnpm-prune' | 'npm-clean' | 'yarn-clean' | 'bun-clean' | 'pip-purge' | 'brew-cleanup'
  | 'docker-builder-prune' | 'docker-rm-container' | 'docker-rm-image' | 'docker-volume-rm'
  | 'simctl-delete-unavailable' | 'empty-trash'
  | 'uv-prune' | 'go-clean-modcache' | 'go-clean-cache' | 'pod-cache-clean' | 'dart-pub-cache-clean'
  | 'cargo-clean' | 'git-worktree-remove' | 'avd-delete' | 'sdk-uninstall' | 'docker-reclaim' | 'uv-prune-force' | 'tm-delete-snapshot';

/** null = protegido: aparece, mas não pode ser limpo. */
export type Action = { kind: 'trash'; path: string } | { kind: 'cmd'; key: CommandKey; arg?: string } | null;

export interface Item {
  id: string;
  /** nome de pasta/imagem (string) ou nome fixo do app (Msg) */
  name: Text;
  detail?: Text;
  /** bytes ocupados */
  size: number;
  /** bytes que a limpeza devolve; null = a ferramenta só sabe depois */
  freeable: number | null;
  /** entra no total seguro e vem marcado */
  safe: boolean;
  /** motivo de atenção ou proteção */
  note?: Msg;
  lastUsed?: number;
  /** pasta real, para "Mostrar no Finder" e para medir antes/depois */
  path?: string;
  /** exige confirmação individual e não vai para a Lixeira (volume Docker, esvaziar Lixeira) */
  individual?: boolean;
  /** Ação da categoria (ex.: devolver espaço do Docker Desktop): não entra na lista nem nas contagens. */
  tool?: boolean;
  /** pasta do root (criada com sudo): a limpeza pede a senha do macOS para devolvê-la ao usuário */
  admin?: boolean;
  /** em uso agora (projeto ativo, app ou Xcode aberto…): limpável só por escolha explícita, nunca vem marcado */
  inUse?: boolean;
  /** partes que o comando oficial remove juntas (só exibição) */
  parts?: { name: string; size: number }[];
  /** comando oficial, para mostrar na confirmação */
  command?: Text;
  /** arquivo do Explorar como foi listado: só sai se ainda tiver este tamanho e data (S14) */
  seen?: { bytes: number; mtime: number };
  action: Action;
}

export type CategoryStatus = 'ok' | 'unavailable' | 'needs-access' | 'error';

/** Nome e descrição vêm do dicionário pelo id (cat.<id>.name, cat.<id>.blurb). */
export interface Category {
  id: CategoryId;
  status: CategoryStatus;
  message?: Msg;
  notice?: Msg;
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
  sizeCache: Record<string, { key: string; size: number; at?: number }>;
}

export interface Disk { name: string; total: number; free: number }

/** Espaço livre num momento, para o gráfico do histórico. */
export interface Sample { at: number; free: number; total: number }

export interface Scan { at: number; ms: number; categories: Category[] }

/** category guarda o id; versões antigas guardavam o nome em português. */
export interface IgnoredItem { ref: string; name: string; category: string }

export type LocalePref = 'system' | 'pt-BR' | 'en' | 'es';

export type Theme = 'system' | 'light' | 'dark';

export interface Prefs {
  simulate: boolean;
  staleDays: 30 | 60 | 90;
  theme: Theme;
  scanOnLaunch: boolean;
  ignored: IgnoredItem[];
  locale: LocalePref;
  /** Já viu as boas-vindas. */
  onboarded: boolean;
  /** Ícone na barra de menus; fechar a janela mantém o app rodando. */
  showInMenuBar: boolean;
  openAtLogin: boolean;
  /** Avisar quando o livre cair abaixo desta porcentagem (0 = desligado). */
  lowDiskAlert: 0 | 10 | 15 | 20;
}

/** Andamento da limpeza, do main para a tela. 'disk' é o ganho do espaço livre medido até agora. */
export type CleanEvent =
  | { kind: 'password' }
  | { kind: 'start'; ref: string }
  | { kind: 'output'; ref: string; line: string }
  | { kind: 'done'; ref: string; freed: number | null; trashed: number }
  | { kind: 'failed'; ref: string; message: Msg }
  | { kind: 'skipped'; ref: string; message: Msg; retry: boolean }
  | { kind: 'disk'; gain: number; free: number };

export interface CleanResult {
  simulated: boolean;
  freed: number;
  trashed: number;
  /** itens limpos cujo ganho a ferramenta não informa */
  unknown: number;
  done: string[];
  failed: { ref: string; name: Text; message: Msg }[];
  /** em uso agora: ficaram para depois; `retry` = passa sozinho (o Respiro tenta de novo, ou limpa forçado com aceite) */
  skipped: { ref: string; name: Text; message: Msg; retry: boolean }[];
  docker: boolean;
  /** quanto o espaço livre do disco mudou (statfs antes/depois); 0 na simulação */
  disk: number;
  /** espaço livre depois da limpeza */
  free: number;
}

export interface HistoryEntry { at: number; freed: number; trashed: number; count: number; disk?: number }

export interface State { disk: Disk; scan: Scan | null; history: HistoryEntry[]; samples: Sample[]; prefs: Prefs; scanning: boolean; fullDiskAccess: boolean;
  /** idioma resolvido pelo main */
  locale: 'pt-BR' | 'en' | 'es';
  /** categorias que a análise procura, na ordem fixa (para o estado de carregamento) */
  catalog: { id: CategoryId }[] }

export type Progress = { done: number; total: number; category?: Category; absent?: CategoryId; finished?: Scan };

/** Pasta ou arquivo do mapa. `id` vira o ref "explore/<id>"; `path` é só para mostrar ("~/…"); `trashable` = a regra S14 deixa ir para a Lixeira. */
export interface ExploreNode {
  id: string; path: string; name: string; size: number; dir: boolean; mtime?: number; trashable?: boolean;
  children?: ExploreNode[];
  /** só na raiz do mapa: quando o du leu (a leitura fica guardada por 6 h) */
  at?: number;
  /** só no main, antes do índice */
  seen?: { bytes: number; mtime: number };
}

export interface ExploreFile { id: string; path: string; name: string; size: number; mtime: number; trashable: boolean }

/** Cópias com o mesmo conteúdo; `keep` marca a que fica (a mais antiga fora de Downloads e da Mesa). */
export interface DuplicateGroup { size: number; copies: (ExploreFile & { keep: boolean })[] }

export type ExploreProgress = { kind: 'count'; n: number } | { kind: 'read'; read: number; total: number };

export interface RespiroApi {
  state(): Promise<State>;
  scan(): Promise<Scan>;
  clean(refs: string[], opts?: { force?: string[] }): Promise<CleanResult>;
  setPrefs(prefs: Partial<Prefs>): Promise<Prefs>;
  reveal(ref: string): Promise<void>;
  open(target: 'full-disk-access' | 'docker'): Promise<void>;
  onProgress(cb: (p: Progress) => void): void;
  onCommand(cb: (command: 'rescan' | 'preferences' | 'history' | 'show-cleaning' | 'explore') => void): void;
  cleaningBackground(on: boolean): Promise<void>;
  onCleanProgress(cb: (e: CleanEvent) => void): void;
  explore(kind: 'home' | 'apps' | 'disk', fresh?: 'fresh'): Promise<ExploreNode | null>;
  explore(kind: 'dir', id: string): Promise<ExploreNode | null>;
  explore(kind: 'large'): Promise<ExploreFile[]>;
  explore(kind: 'duplicates'): Promise<DuplicateGroup[]>;
  onExploreProgress(cb: (p: ExploreProgress) => void): void;
}

declare global {
  interface Window { respiro: RespiroApi }
}
