import React, { useEffect, useMemo, useState } from "react";

type License = { ID: string; expire: string };

type Config = {
  VIP: "开" | "关";
  title: string;
  body: string;
  enterPackage: string;
  leftUrl: string;
  rightUrl: string;
  licenses: License[];
};

type AppItem = {
  name: string;
  repo: string;   // owner/repo
  path: string;   // configs/xxx.json
  branch?: string;
};

const DEFAULT_CONFIG: Config = {
  VIP: "开",
  title: "",
  body: "",
  enterPackage: "",
  leftUrl: "",
  rightUrl: "",
  licenses: []
};

function b64encodeUtf8(str: string) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeUtf8(b64: string) {
  return decodeURIComponent(escape(atob(b64)));
}

function isYYYYMMDD(s: string) {
  return /^\d{8}$/.test(s);
}
function isUrl(s: string) {
  if (!s) return true;
  try { new URL(s); return true; } catch { return false; }
}

function buildRawGithubUrl(repo: string, branch: string, path: string) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
}

async function ghRequest(token: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {})
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${res.statusText}\n${t}`);
  }
  return res.json();
}

async function ghGetJson(token: string, repo: string, path: string, branch = "main") {
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
  const data = await ghRequest(token, url);
  const content = b64decodeUtf8((data.content || "").replace(/\n/g, ""));
  return { json: JSON.parse(content), sha: data.sha as string };
}

async function ghPutJson(
  token: string,
  repo: string,
  path: string,
  branch: string,
  message: string,
  jsonObj: any,
  sha?: string
) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const body: any = {
    message,
    content: b64encodeUtf8(JSON.stringify(jsonObj, null, 2)),
    branch
  };
  if (sha) body.sha = sha;
  const data = await ghRequest(token, url, { method: "PUT", body: JSON.stringify(body) });
  return { sha: data.content?.sha as string };
}

function normalizeConfig(raw: any): Config {
  return {
    VIP: raw?.VIP === "关" ? "关" : "开",
    title: raw?.title ?? "",
    body: raw?.body ?? "",
    enterPackage: raw?.enterPackage ?? "",
    leftUrl: raw?.leftUrl ?? "",
    rightUrl: raw?.rightUrl ?? "",
    licenses: Array.isArray(raw?.licenses) ? raw.licenses : []
  };
}

export default function App() {
  const REPO = "milklun/waterpanel";
  const APPS_PATH = "apps/apps.json";
  const BRANCH = "main";

  const [token, setToken] = useState(() => localStorage.getItem("gh_token") || "");
  const [apps, setApps] = useState<AppItem[]>([]);
  const [appsSha, setAppsSha] = useState("");

  const [selected, setSelected] = useState<number>(-1);
  const selectedApp = apps[selected];

  const [config, setConfig] = useState<Config | null>(null);
  const [configSha, setConfigSha] = useState("");

  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem("gh_token", token);
  }, [token]);

  const preview = useMemo(() => config ? JSON.stringify(config, null, 2) : "", [config]);

  function ok(s: string) { setMsg(s); setErr(""); }
  function bad(s: string) { setErr(s); setMsg(""); }

  async function loadApps() {
    setLoading(true);
    try {
      const { json, sha } = await ghGetJson(token, REPO, APPS_PATH, BRANCH);
      setApps(json || []);
      setAppsSha(sha);
      setSelected(json.length ? 0 : -1);
      ok("已加载 apps 列表");
    } catch (e: any) {
      bad(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadConfig(app: AppItem) {
    setLoading(true);
    try {
      const { json, sha } = await ghGetJson(token, app.repo, app.path, app.branch || BRANCH);
      setConfig(normalizeConfig(json));
      setConfigSha(sha);
      ok("配置已加载");
    } catch (e: any) {
      bad("配置不存在，可点击“创建配置文件”");
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig() {
    if (!selectedApp || !config) return;

    if (!config.title.trim()) return bad("title 不能为空");
    if (!isUrl(config.leftUrl) || !isUrl(config.rightUrl)) return bad("URL 非法");

    for (const l of config.licenses) {
      if (!l.ID.trim()) return bad("license ID 不能为空");
      if (!isYYYYMMDD(l.expire)) return bad("expire 必须是 YYYYMMDD");
    }

    setLoading(true);
    try {
      const { sha } = await ghPutJson(
        token,
        selectedApp.repo,
        selectedApp.path,
        selectedApp.branch || BRANCH,
        "Update config via panel",
        config,
        configSha
      );
      setConfigSha(sha);
      ok("已保存到 main");
    } catch (e: any) {
      bad(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", maxWidth: 1200, margin: "0 auto" }}>
      <h2>WaterPanel 配置面板</h2>

      <input
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
        placeholder="GitHub Token"
        value={token}
        onChange={e => setToken(e.target.value)}
      />

      <button onClick={loadApps}>加载 apps</button>

      <hr />

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ width: 260 }}>
          {apps.map((a, i) => (
            <div key={i} onClick={() => { setSelected(i); loadConfig(a); }}
              style={{ padding: 8, border: "1px solid #ccc", marginBottom: 6, cursor: "pointer" }}>
              {a.name}
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }}>
          {config && selectedApp && (
            <>
              <button onClick={saveConfig}>保存到 main</button>
              <button
                onClick={() => {
                  const url = buildRawGithubUrl(
                    selectedApp.repo,
                    selectedApp.branch || BRANCH,
                    selectedApp.path
                  );
                  navigator.clipboard.writeText(url);
                  ok("已复制 JSON 链接");
                }}
                style={{ marginLeft: 8 }}
              >
                复制 JSON 链接
              </button>

              <pre style={{ marginTop: 12, background: "#f6f6f6", padding: 12 }}>
                {preview}
              </pre>
            </>
          )}
        </div>
      </div>

      {msg && <div style={{ color: "green" }}>{msg}</div>}
      {err && <div style={{ color: "red" }}>{err}</div>}
    </div>
  );
}
