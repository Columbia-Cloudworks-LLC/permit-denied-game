import '../site/page.css';
import './style.css';
import { initPrivacy } from '../privacy/privacy';
import { hydrateSiteChrome } from '../site/chrome';
import {
  listBuildingPackages,
  newFromTemplate,
  nextDraftId,
  openBuildingPackage,
  packageDump,
  parseDraftPackage,
  type DraftFile,
  type DraftPackage,
  type TemplateKind,
} from './package';
import { bootIsolatePreview, type IsolatePreview, type PreviewView } from './preview';

initPrivacy(true);
hydrateSiteChrome('designer');

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const openSelect = element<HTMLSelectElement>('open-package');
const templateSelect = element<HTMLSelectElement>('new-template');
const tabs = element('file-tabs');
const editor = element<HTMLTextAreaElement>('file-editor');
const errors = element('parse-errors');
const status = element('preview-status');
const viewSelect = element<HTMLSelectElement>('preview-view');
const packages = listBuildingPackages();
let draft: DraftPackage = newFromTemplate('porch-house', nextDraftId('porch-house'));
let active = 0;
let preview: IsolatePreview | undefined;
let debounce = 0;

function currentFile(): DraftFile {
  return draft.files[active] ?? draft.files[0]!;
}

function fillOpenList(): void {
  openSelect.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Open existing package…';
  openSelect.append(blank);
  for (const item of packages) {
    const option = document.createElement('option');
    option.value = item.buildingPath;
    option.textContent = `${item.id} · ${item.label}`;
    openSelect.append(option);
  }
}

function renderTabs(): void {
  tabs.replaceChildren();
  draft.files.forEach((file, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = file.name;
    button.setAttribute('aria-selected', index === active ? 'true' : 'false');
    if (index === active) button.classList.add('primary');
    button.onclick = () => {
      currentFile().text = editor.value;
      active = index;
      editor.value = currentFile().text;
      renderTabs();
    };
    tabs.append(button);
  });
}

function setDraft(next: DraftPackage, fileIndex = 0): void {
  draft = next;
  active = Math.min(fileIndex, next.files.length - 1);
  editor.value = currentFile().text;
  renderTabs();
  scheduleParse();
}

function showError(message: string): void {
  errors.textContent = message;
  errors.hidden = false;
  status.textContent = 'Parser rejected this draft.';
}

function showOk(label: string): void {
  errors.textContent = '';
  errors.hidden = true;
  status.textContent = label;
}

async function applyParse(): Promise<void> {
  currentFile().text = editor.value;
  const result = parseDraftPackage(draft);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  showOk(`${result.definition.id} · ${result.definition.label} · ${result.definition.w}×${result.definition.d}×${result.definition.floors}`);
  try {
    preview ??= await bootIsolatePreview(element('preview-host'));
    preview.show(result.definition, viewSelect.value as PreviewView);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function scheduleParse(): void {
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => { void applyParse(); }, 280);
}

element<HTMLButtonElement>('new-package').onclick = () => {
  const kind = templateSelect.value as TemplateKind;
  setDraft(newFromTemplate(kind, nextDraftId(kind)));
  openSelect.value = '';
};

openSelect.onchange = () => {
  if (!openSelect.value) return;
  setDraft(openBuildingPackage(openSelect.value));
};

viewSelect.onchange = () => { void applyParse(); };
editor.oninput = () => scheduleParse();

element<HTMLButtonElement>('download-files').onclick = () => {
  currentFile().text = editor.value;
  for (const file of draft.files) {
    const blob = new Blob([file.text], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(link.href);
  }
};

element<HTMLButtonElement>('copy-package').onclick = async () => {
  currentFile().text = editor.value;
  try {
    await navigator.clipboard.writeText(packageDump(draft));
    element('copy-package').textContent = 'Copied';
  } catch {
    element('copy-package').textContent = 'Copy failed';
  }
};

fillOpenList();
setDraft(draft);
window.addEventListener('resize', () => preview?.resize());
