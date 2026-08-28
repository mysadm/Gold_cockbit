// Type-only stand-in for the 'ai-settings-ui' package, wired in via the
// tsconfig "paths" override below. The real package ships its declarations
// as raw .tsx source (package.json "types": "./src/index.ts"), which drags
// its React-authored JSX through this project's Preact jsxImportSource
// during type-checking and fails to resolve "preact/jsx-runtime" for a
// package that was never written against it. Vite/Rollup still resolve the
// real runtime code from node_modules at build time — only `tsc` is
// redirected here. Keep this in sync with the library's actual exports
// (node_modules/ai-settings-ui/src/{adapter,AIModelSettingsCard,
// AIModelSettingsManager}.tsx) if its public API changes.

export interface ProviderFieldDefinition {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  options?: string[];
}

export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  kind: 'cloud' | 'local';
  extraFields?: ProviderFieldDefinition[];
}

export interface ProviderConnection {
  id: string;
  providerId: string;
  label: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  language?: string;
  extra?: Record<string, unknown>;
  apiKeyRef: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface ConnectionDraft {
  id?: string;
  providerId: string;
  label: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  language?: string;
  extra?: Record<string, unknown>;
  apiKey?: string;
}

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface AIProviderAdapter {
  listCatalog(): Promise<ProviderCatalogEntry[]>;
  addCustomProvider(def: { displayName: string; models?: string[] }): Promise<ProviderCatalogEntry>;
  listConnections(): Promise<ProviderConnection[]>;
  saveConnection(draft: ConnectionDraft): Promise<ProviderConnection>;
  deleteConnection(id: string): Promise<void>;
  setActiveConnection(id: string): Promise<void>;
  testConnection(target: { id: string } | { draft: ConnectionDraft }): Promise<TestResult>;
  listModels(providerId: string, context?: { connectionId?: string; apiKey?: string }): Promise<string[]>;
}

export const DEFAULT_CATALOG: ProviderCatalogEntry[];
export function createEmptyDraft(providerId: string): ConnectionDraft;
export function createInMemoryAdapter(): AIProviderAdapter;

export interface AIModelSettingsCardProps {
  draft: ConnectionDraft;
  catalog: ProviderCatalogEntry[];
  models: string[];
  modelsLoading?: boolean;
  hasStoredKey: boolean;
  saveState: 'idle' | 'saving' | 'success' | 'error';
  testState: 'idle' | 'testing' | 'success' | 'error';
  message: string;
  disabled?: boolean;
  className?: string;
  theme?: Record<string, string>;
  onDraftChange: (next: ConnectionDraft) => void;
  onProviderChange: (providerId: string) => void;
  onSave: () => void;
  onTest: () => void;
  onCancel: () => void;
  onAddCustomProvider?: (def: { displayName: string; models?: string[] }) => void | Promise<void>;
}

export function AIModelSettingsCard(props: AIModelSettingsCardProps): any;

export interface AIModelSettingsManagerProps {
  adapter: AIProviderAdapter;
  className?: string;
  theme?: Record<string, string>;
}

export function AIModelSettingsManager(props: AIModelSettingsManagerProps): any;
