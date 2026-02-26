export type LensTitleInput = {
  status: string;
  createdAt: string;
};

export function lineContainsConcreteSelectorText(text: string): boolean {
  const hasStringLiteral = /(?:`[^`]*`|'[^']*'|"[^"]*")/.test(text);
  if (hasStringLiteral) {
    return true;
  }

  const hasSelectorMemberReference =
    /\b[a-zA-Z_$][\w$]*(?:\??\.[a-zA-Z_$][\w$]*|\[\s*(?:'[^']+'|"[^"]+"|`[^`]+`)\s*\])/.test(text);
  if (hasSelectorMemberReference) {
    return true;
  }

  const hasSelectorVariableArgument =
    /\b(?:locator|frameLocator|getBy(?:AltText|Label|Placeholder|Role|TestId|Text|Title))\s*\(\s*[a-zA-Z_$][\w$]*\s*(?:\)|,)/.test(
      text
    );
  return hasSelectorVariableArgument;
}

export function codeLensTitleForItem(item: LensTitleInput): string {
  const when = formatCaptureTime(item.createdAt);
  if (item.status === "failed") {
    return `Failed selector screenshot capture (${when})`;
  }
  return `Open selector screenshot (${when})`;
}

export function formatCaptureTime(createdAt: string): string {
  if (!createdAt) {
    return "unknown time";
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
