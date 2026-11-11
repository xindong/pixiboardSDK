import {
  ArrowUpRight,
  Camera,
  ChevronDown,
  Download,
  ExternalLink,
  FilePlus,
  FileText,
  Frame,
  GripHorizontal,
  Copy,
  LayoutGrid,
  LoaderCircle,
  Pause,
  Play,
  Pencil,
  Plus,
  RefreshCw,
  Maximize,
  Save,
  Trash2,
  Upload,
  X,
  createElement as createLucideElement,
  type IconNode,
} from "lucide";

const ICONS = {
  camera: Camera,
  chevronDown: ChevronDown,
  copy: Copy,
  delete: Trash2,
  download: Download,
  externalLink: ExternalLink,
  filePlus: FilePlus,
  fileText: FileText,
  fit: Maximize,
  frame: Frame,
  grid: LayoutGrid,
  loading: LoaderCircle,
  open: ArrowUpRight,
  pencil: Pencil,
  play: Play,
  pause: Pause,
  plus: Plus,
  refresh: RefreshCw,
  rename: Pencil,
  save: Save,
  upload: Upload,
  x: X,
  drag: GripHorizontal,
} satisfies Record<string, IconNode>;

export type SiteIconName = keyof typeof ICONS | "agent";

export function createIcon(
  name: SiteIconName,
  { className, size = 16, strokeWidth = 2 }: { className?: string; size?: number; strokeWidth?: number } = {},
): SVGElement {
  if (name === "agent") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const attributes = {
      "aria-hidden": "true",
      class: className ? `ui-icon ${className}` : "ui-icon",
      focusable: "false",
      viewBox: "0 0 24 24",
      height: String(size),
      width: String(size),
      fill: "none",
      stroke: "currentColor",
      "stroke-width": String(strokeWidth),
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    };
    for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z");
    svg.append(path);
    return svg;
  }
  return createLucideElement(ICONS[name], {
    "aria-hidden": "true",
    class: className ? `ui-icon ${className}` : "ui-icon",
    focusable: "false",
    height: size,
    width: size,
    "stroke-width": strokeWidth,
  });
}
