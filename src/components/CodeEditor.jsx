
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";

export default function CodeEditor({
  value,
  onChange,
  height,
}) {
  return (
    <div className="code-editor">
      <CodeMirror
        value={value}
        height={height}
        theme="dark"
        extensions={[javascript()]}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          highlightActiveLine: true,
        }}
      />
    </div>
  );
}
