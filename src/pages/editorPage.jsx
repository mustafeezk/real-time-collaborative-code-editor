
import { useState } from "react";
import CodeEditor from "../components/CodeEditor";
import "../css/EditorPage.css";

export default function EditorPage() {
  const [code, setCode] = useState(
    'console.log("Hello, world!");'
  );

  return (
    <main className="editor-page">
      <h2>JavaScript Playground</h2>

      <CodeEditor
        value={code}
        onChange={setCode}
        height="400px"
      />

      <div className="editor-actions">
        <button type="button" onClick={() => {}}>
          ▶ Run
        </button>
      </div>

      <section className="output-panel">
        <h3>Output</h3>
        <div className="output-content"></div>
      </section>
    </main>
  );
}
