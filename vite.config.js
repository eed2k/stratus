"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
const plugin_react_1 = __importDefault(require("@vitejs/plugin-react"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const tailwindcss_1 = __importDefault(require("tailwindcss"));
const autoprefixer_1 = __importDefault(require("autoprefixer"));
const __filename = (0, url_1.fileURLToPath)(import.meta.url);
const __dirname = path_1.default.dirname(__filename);
exports.default = (0, vite_1.defineConfig)({
    root: 'client',
    plugins: [(0, plugin_react_1.default)()],
    server: {
        host: '0.0.0.0',
        allowedHosts: true,
        hmr: false,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
    },
    css: {
        postcss: {
            plugins: [
                (0, tailwindcss_1.default)(path_1.default.resolve(__dirname, 'tailwind.config.js')),
                (0, autoprefixer_1.default)(),
            ],
        },
    },
    resolve: {
        alias: {
            '@': path_1.default.resolve(__dirname, './client/src'),
            '@shared': path_1.default.resolve(__dirname, './shared'),
            '@assets': path_1.default.resolve(__dirname, './attached_assets'),
        },
    },
});
