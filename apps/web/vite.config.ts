import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {randomUUID} from "node:crypto";

export default defineConfig(() => {
    const buildVersion = process.env.APP_BUILD_VERSION?.trim() || randomUUID();
    return {
        define: {__APP_BUILD_VERSION__: JSON.stringify(buildVersion)},
        plugins: [react(), {
            name: "matrix-build-version",
            generateBundle() {
                this.emitFile({
                    type: "asset",
                    fileName: "version.json",
                    source: JSON.stringify({version: buildVersion})
                })
            }
        }],
        server: {proxy: {"/api": "http://localhost:3000"}},
        preview: {proxy: {"/api": "http://api:3000"}}
    }
});
