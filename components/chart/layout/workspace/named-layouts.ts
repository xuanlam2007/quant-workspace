export interface WorkspaceSnapshot {
  version: 1;
  values: Record<string, string>;
}

export interface NamedLayout {
  id: string;
  name: string;
  symbol: string;
  resolution: string;
  modified: number;
  favorite: boolean;
  workspace: WorkspaceSnapshot;
}

export interface LayoutLibrary {
  version: 1;
  activeId: string | null;
  layouts: NamedLayout[];
}

export const LAYOUT_LIBRARY_KEY = "chart.namedLayouts.v1";
export const LAYOUT_LIBRARY_CHANGED = "chart:named-layouts-changed";
export const WORKSPACE_CHANGED = "chart:workspace-changed";
export const LAYOUT_SORT_KEY = "loadChartDialog.viewState";

const workspaceKeys = new Set([
  "chart.lastUsedSymbol", "chart.lastUsedTimeBasedResolution", "chart.comparedSymbols",
  "chart.comparisonSettings.v1",
  "chart.axisSettings.v1", "chart.manualAxisRanges.v2", "chart.styles.v1",
  "chart.workspaceLayout.v1", "chart.referenceStudies.v1", "vndirect-chart:indicator-settings",
  "chart.drawingsLocked.v1", "chart.drawingsHidden.v1", "chart.magnetMode.v1",
  "chart.stayInDrawingMode.v1", "chart.mainVisible.v1", "chart.timezone.v1",
  "chart.volumeMaVisible.v1", "chart.volumeHidden.v1", "chart.volumeSmoothingVisible.v1",
  "chart.volumeAppearance.v1", "chart.appearance.v1",
]);

function isWorkspaceKey(key: string) {
  return workspaceKeys.has(key) || key.startsWith("vndirect-chart:drawings:");
}

export function captureWorkspace(): WorkspaceSnapshot {
  const values: Record<string, string> = {};
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key !== null && isWorkspaceKey(key)).sort();
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return { version: 1, values };
}

function validWorkspace(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const workspace = value as WorkspaceSnapshot;
  return workspace.version === 1 && !!workspace.values && typeof workspace.values === "object"
    && !Array.isArray(workspace.values)
    && Object.entries(workspace.values).every(([key, item]) => isWorkspaceKey(key) && typeof item === "string");
}

export function readLayoutLibrary(): LayoutLibrary {
  const raw = localStorage.getItem(LAYOUT_LIBRARY_KEY);
  if (!raw) return { version: 1, activeId: null, layouts: [] };
  const library = JSON.parse(raw) as LayoutLibrary;
  if (library?.version !== 1 || !Array.isArray(library.layouts)
    || library.layouts.some((entry) => !entry || typeof entry.id !== "string"
      || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 64
      || typeof entry.symbol !== "string" || typeof entry.resolution !== "string"
      || !Number.isFinite(entry.modified) || typeof entry.favorite !== "boolean"
      || !validWorkspace(entry.workspace))
    || new Set(library.layouts.map((entry) => entry.id)).size !== library.layouts.length) {
    throw new Error("Dữ liệu bố cục không hợp lệ.");
  }
  return { ...library, activeId: library.layouts.some((entry) => entry.id === library.activeId) ? library.activeId : null };
}

function writeLibrary(library: LayoutLibrary) {
  localStorage.setItem(LAYOUT_LIBRARY_KEY, JSON.stringify(library));
  window.dispatchEvent(new Event(LAYOUT_LIBRARY_CHANGED));
  return library;
}

export function saveNamedLayout(name: string, workspace: WorkspaceSnapshot, symbol: string, resolution: string, id?: string) {
  const title = name.trim();
  if (!title || title.length > 64 || !validWorkspace(workspace)) throw new Error("Tên hoặc dữ liệu bố cục không hợp lệ.");
  const library = readLayoutLibrary();
  const old = library.layouts.find((entry) => entry.id === id);
  const entry: NamedLayout = {
    id: old?.id ?? crypto.randomUUID(), name: title, symbol, resolution,
    modified: Date.now(), favorite: old?.favorite ?? false, workspace,
  };
  return writeLibrary({ version: 1, activeId: entry.id, layouts: [...library.layouts.filter((item) => item.id !== entry.id), entry] });
}

export function toggleLayoutFavorite(id: string) {
  const library = readLayoutLibrary();
  return writeLibrary({ ...library, layouts: library.layouts.map((entry) => entry.id === id ? { ...entry, favorite: !entry.favorite } : entry) });
}

export function deleteNamedLayout(id: string) {
  const library = readLayoutLibrary();
  return writeLibrary({ ...library, activeId: library.activeId === id ? null : library.activeId, layouts: library.layouts.filter((entry) => entry.id !== id) });
}

function replaceWorkspace(snapshot: WorkspaceSnapshot) {
  const current = captureWorkspace();
  for (const key of Object.keys(current.values)) if (!(key in snapshot.values)) localStorage.removeItem(key);
  for (const [key, value] of Object.entries(snapshot.values)) localStorage.setItem(key, value);
}

export function activateNamedLayout(id: string) {
  const library = readLayoutLibrary();
  const entry = library.layouts.find((item) => item.id === id);
  if (!entry) throw new Error("Bố cục này không còn tồn tại.");
  const previous = captureWorkspace();
  try {
    // Khôi phục trọn bộ trước khi tạo lại biểu đồ để các hook đọc cùng một bố cục.
    replaceWorkspace(entry.workspace);
    localStorage.setItem(LAYOUT_LIBRARY_KEY, JSON.stringify({ ...library, activeId: id }));
  } catch (error) {
    replaceWorkspace(previous);
    throw error;
  }
}

function signatureValue(value: unknown, path = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => signatureValue(item, `${path}[]`));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .filter(([key]) => !(path === "layout" && key === "time")
      && !(/^layout\.panes\[\]\.(left|right)$/.test(path) && key === "range"))
    .map(([key, item]) => [key, signatureValue(item, `${path}.${key}`)]));
}

export function workspaceSignature(snapshot: WorkspaceSnapshot) {
  // Vùng nhìn và lịch sử hoàn tác vẫn được lưu nhưng không đánh dấu sửa bố cục.
  return JSON.stringify(Object.entries(snapshot.values)
    .filter(([key]) => !key.endsWith(":history") && key !== "chart.manualAxisRanges.v2")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      try {
        return [key, signatureValue(JSON.parse(value), key === "chart.workspaceLayout.v1" ? "layout" : "")];
      } catch {
        return [key, value];
      }
    }));
}

export function layoutStorageError(error: unknown) {
  if (error instanceof DOMException && ["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"].includes(error.name)) return "Không đủ dung lượng để lưu bố cục. Hãy xóa một bố cục cũ rồi thử lại.";
  if (error instanceof SyntaxError) return "Không thể đọc dữ liệu bố cục đã lưu.";
  if (error instanceof DOMException && error.name === "SecurityError") return "Trình duyệt đang chặn lưu trữ bố cục.";
  return error instanceof Error ? error.message : "Không thể lưu hoặc tải bố cục. Vui lòng thử lại.";
}
