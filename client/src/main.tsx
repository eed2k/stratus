// Stratus Weather Server
// Created by Lukas Esterhuizen

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installChunkReloadHandlers } from "./lib/chunkReload";

// Recover automatically when a lazy chunk fails to load after a deploy.
installChunkReloadHandlers();

createRoot(document.getElementById("root")!).render(<App />);
