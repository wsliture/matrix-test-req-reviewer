import React from "react";
import ReactDOM from "react-dom/client";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {BrowserRouter} from "react-router-dom";
import "antd/dist/reset.css";
import "./style.css";
import {App} from "./ui";

declare const __APP_BUILD_VERSION__: string;

function monitorDeploymentVersion() {
    let reloading = false;
    const check = async () => {
        if (reloading) return;
        try {
            const response = await fetch(`/version.json?t=${Date.now()}`, {cache: "no-store"});
            if (!response.ok) return;
            const deployed = await response.json() as {version?: string};
            if (deployed.version && deployed.version !== __APP_BUILD_VERSION__) {
                reloading = true;
                window.location.reload()
            }
        } catch {
            // 升级期间Web容器可能短暂不可用；下次轮询或页面重新可见时继续检查。
        }
    };
    void check();
    window.setInterval(() => void check(), 60_000);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void check()
    });
    window.addEventListener("focus", () => void check())
}

monitorDeploymentVersion();

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider
    client={new QueryClient()}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></React.StrictMode>);
