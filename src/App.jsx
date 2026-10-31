import EditorPage from "./pages/editorPage";
import Home from "./pages/Home";

function App() {
  const match = window.location.pathname.match(/^\/room\/([^/]+)\/?$/);

  if (match) {
    return <EditorPage roomId={decodeURIComponent(match[1])} />;
  }

  return <Home />;
}

export default App;
