import { DiffEditor } from "@monaco-editor/react";

export default function DiffViewer({ before, after, path, dark }: { before: string; after: string; path: string; dark: boolean }) {
  const language = path.endsWith(".py") ? "python" : "typescript";
  return (
    <DiffEditor
      height="420px"
      language={language}
      original={before}
      modified={after}
      theme={dark ? "vs-dark" : "light"}
      options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }}
    />
  );
}
