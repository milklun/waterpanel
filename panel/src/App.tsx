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
  repo: string;   // "owner/repo"
  path: string;   // "configs/xxx.json"
  branch?: string; // default "main"
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
  if (!s) return true; // 允许空
  try { new URL(s); return true; } catch { return false; }
}

function nowStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}\n${txt}`);
  }
  return res.json();
}

async function ghGetJsonFile(token: string, repo: string, path: string, branch = "main") {
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const data = await ghRequest(token, url);
  const content = b64decodeUtf8((data.content || "").replace(/\n/g, ""));
  return { json: JSON.parse(content), sha: data.sha as string };
}

async function ghPutJsonFile(token: string, repo: string, path: string, branch: string, message: string, jsonObj: any, sha?: string) {
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
  // 你的仓库
  const REPO = "milklun/waterpanel";
  const APPS_PATH = "apps/apps.json";
  const BRANCH = "main";

  const [token, setToken] = useState(() => localStorage.getItem("gh_token") || "");
  const [apps, setApps] = useState<AppItem[]>([]);
  const [appsSha, setAppsSha] = useState<string>("");

  const [selected, setSelected] = useState<number>(-1);

  const [config, setConfig] = useState<Config | null>(null);
  const [configSha, setConfigSha] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  // 新增软件弹窗状态
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState("qq.json"); // 自定义名字：configs/xxx.json

  useEffect(() => {
    localStorage.setItem("gh_token", token);
  }, [token]);

  const selectedApp = useMemo(() => {
    if (selected < 0 || selected >= apps.length) return null;
    return apps[selected];
  }, [apps, selected]);

  const configJsonPreview = useMemo(() => config ? JSON.stringify(config, null, 2) : "", [config]);

  function toastOk(s: string) { setMsg(s); setErr(""); }
  function toastErr(s: string) { setErr(s); setMsg(""); }

  async function loadApps() {
    if (!token) { toastErr("请先填 GitHub Token（Fine-grained PAT）"); return; }
    setLoading(true);
    setMsg(""); setErr("");
    try {
      const { json, sha } = await ghGetJsonFile(token, REPO, APPS_PATH, BRANCH);
      const arr = Array.isArray(json) ? json : [];
      setApps(arr);
      setAppsSha(sha);
      setSelected(arr.length ? 0 : -1);
      toastOk(`✅ 已加载 apps 列表（${arr.length} 个）`);
    } catch (e: any) {
      toastErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveApps(nextApps: AppItem[]) {
    if (!token) { toastErr("请先填 GitHub Token"); return; }
    setLoading(true);
    setMsg(""); setErr("");
    try {
      const { sha } = await ghPutJsonFile(
        token,
        REPO,
        APPS_PATH,
        BRANCH,
        `Update apps list via panel (${nowStamp()})`,
        nextApps,
        appsSha
      );
      setApps(nextApps);
      setAppsSha(sha);
      toastOk("✅ apps/apps.json 已保存到 main");
    } catch (e: any) {
      toastErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadConfigFor(app: AppItem) {
    if (!token) { toastErr("请先填 GitHub Token"); return; }
    setLoading(true);
    setMsg(""); setErr("");
    setConfig(null);
    setConfigSha("");
    try {
      const branch = app.branch || BRANCH;
      const { json, sha } = await ghGetJsonFile(token, app.repo, app.path, branch);
      setConfig(normalizeConfig(json));
      setConfigSha(sha);
      toastOk(`✅ 已加载：${app.path}`);
    } catch (e: any) {
      // 文件不存在时给引导
      toastErr(
        (e?.message || String(e)) +
        `\n\n如果这是新软件配置：点击右侧“创建配置文件”。`
      );
    } finally {
      setLoading(false);
    }
  }

  async function createConfigFile(app: AppItem) {
    if (!token) { toastErr("请先填 GitHub Token"); return; }
    setLoading(true);
    setMsg(""); setErr("");
    try {
      const branch = app.branch || BRANCH;
      // 新建时不传 sha
      const { sha } = await ghPutJsonFile(
        token,
        app.repo,
        app.path,
        branch,
        `Create ${app.path} via panel (${nowStamp()})`,
        DEFAULT_CONFIG
      );
      setConfig({ ...DEFAULT_CONFIG });
      setConfigSha(sha);
      toastOk(`✅ 已创建：${app.path}`);
    } catch (e: any) {
      toastErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveConfigFile(app: AppItem) {
    if (!token) { toastErr("请先填 GitHub Token"); return; }
    if (!config) { toastErr("当前没有可保存的配置"); return; }

    // 校验
    if (!config.title.trim()) { toastErr("title 不能为空"); return; }
    if (!isUrl(config.leftUrl)) { toastErr("leftUrl 不是合法 URL"); return; }
    if (!isUrl(config.rightUrl)) { toastErr("rightUrl 不是合法 URL"); return; }
    for (const lic of config.licenses) {
      if (!lic.ID.trim()) { toastErr("licenses: ID 不能为空"); return; }
      if (!isYYYYMMDD(lic.expire)) { toastErr("licenses: expire 必须是 YYYYMMDD"); return; }
    }

    setLoading(true);
    setMsg(""); setErr("");
    try {
      const branch = app.branch || BRANCH;
      const { sha } = await ghPutJsonFile(
        token,
        app.repo,
        app.path,
        branch,
        `Update ${app.path} via panel (${nowStamp()})`,
        config,
        configSha || undefined
      );
      setConfigSha(sha);
      toastOk(`✅ 已保存到 main：${app.path}`);
    } catch (e: any) {
      toastErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  function ui() {
    const card: React.CSSProperties = {
      border: "1px solid #ddd",
      borderRadius: 14,
      padding: 12,
      background: "#fff"
    };

    const btn: React.CSSProperties = {
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid #ddd",
      cursor: "pointer",
      background: "#fafafa"
    };

    const btnPrimary: React.CSSProperties = {
      ...btn,
      border: "1px solid #222",
      background: "#111",
      color: "#fff"
    };

    const input: React.CSSProperties = {
      padding: 10,
      borderRadius: 12,
      border: "1px solid #ddd",
      width: "100%"
    };

    return (
      <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16, maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>WaterPanel 可视化配置面板</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>仓库：{REPO} · 分支：{BRANCH}</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={btn} onClick={loadApps} disabled={loading}>{loading ? "加载中..." : "加载 apps 列表"}</button>
          </div>
        </div>

        <div style={{ ...card, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 160px", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>GitHub Token</div>
            <input
              style={input}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Fine-grained PAT（只授予 milklun/waterpanel 的 Contents 读写）"
            />
            <button style={btn} onClick={() => { localStorage.removeItem("gh_token"); setToken(""); }}>清除</button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            Token 仅保存在你浏览器 localStorage，用于调用 GitHub API 写回 main。
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 14 }}>
          {/* 左侧：软件列表 */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>软件列表（apps/apps.json）</div>
              <button style={btn} onClick={() => { setShowAdd(true); setNewName(""); setNewFile("new.json"); }} disabled={loading}>
                + 新增
              </button>
            </div>

            {apps.length === 0 ? (
              <div style={{ opacity: 0.75 }}>还没有软件。点“新增”创建。</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {apps.map((a, idx) => (
                  <div
                    key={idx}
                    onClick={() => { setSelected(idx); loadConfigFor(a); }}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 10,
                      cursor: "pointer",
                      background: idx === selected ? "#f3f3f3" : "#fff"
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{a.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{a.path}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{a.repo} @ {a.branch || BRANCH}</div>

                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        style={btn}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = apps.filter((_, i) => i !== idx);
                          saveApps(next);
                          if (selected === idx) setSelected(next.length ? 0 : -1);
                        }}
                        disabled={loading}
                      >
                        删除
                      </button>
                      <button
                        style={btn}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rename = prompt("新的 name：", a.name);
                          if (!rename) return;
                          const next = [...apps];
                          next[idx] = { ...next[idx], name: rename };
                          saveApps(next);
                        }}
                        disabled={loading}
                      >
                        重命名
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showAdd && (
              <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>新增软件</div>
                <div style={{ display: "grid", gap: 8 }}>
                  <input style={input} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="显示名，比如：QQ 配置" />
                  <input style={input} value={newFile} onChange={(e) => setNewFile(e.target.value)} placeholder="文件名，比如：qq.json" />
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    将写入：configs/{newFile}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      style={btnPrimary}
                      onClick={() => {
                        const name = newName.trim();
                        const file = newFile.trim();
                        if (!name) return toastErr("name 不能为空");
                        if (!file || !file.endsWith(".json")) return toastErr("文件名必须以 .json 结尾");
                        const next: AppItem[] = [
                          ...apps,
                          { name, repo: REPO, path: `configs/${file}`, branch: BRANCH }
                        ];
                        saveApps(next);
                        setShowAdd(false);
                      }}
                      disabled={loading}
                    >
                      保存到 apps.json
                    </button>
                    <button style={btn} onClick={() => setShowAdd(false)} disabled={loading}>取消</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：配置编辑 */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>
                配置编辑
                {selectedApp ? <span style={{ fontWeight: 500, opacity: 0.7 }}> · {selectedApp.name}（{selectedApp.path}）</span> : null}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={btn}
                  onClick={() => selectedApp && loadConfigFor(selectedApp)}
                  disabled={loading || !selectedApp}
                >
                  重新加载
                </button>
                <button
                  style={btn}
                  onClick={() => selectedApp && createConfigFile(selectedApp)}
                  disabled={loading || !selectedApp}
                >
                  创建配置文件
                </button>
                <button
                  style={btnPrimary}
                  onClick={() => selectedApp && saveConfigFile(selectedApp)}
                  disabled={loading || !selectedApp}
                >
                  保存到 main
                </button>
              </div>
            </div>

            {!selectedApp ? (
              <div style={{ opacity: 0.75 }}>左侧先选择一个软件。</div>
            ) : !config ? (
              <div style={{ opacity: 0.75 }}>
                还没加载到配置。可以点“重新加载”，若文件不存在点“创建配置文件”。
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>VIP</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={config.VIP === "开"}
                      onChange={(e) => setConfig({ ...config, VIP: e.target.checked ? "开" : "关" })}
                    />
                    <span>{config.VIP}</span>
                  </div>

                  <div style={{ fontWeight: 700 }}>title</div>
                  <input style={input} value={config.title} onChange={(e) => setConfig({ ...config, title: e.target.value })} />

                  <div style={{ fontWeight: 700 }}>body</div>
                  <textarea
                    style={{ ...input, minHeight: 80 }}
                    value={config.body}
                    onChange={(e) => setConfig({ ...config, body: e.target.value })}
                  />

                  <div style={{ fontWeight: 700 }}>enterPackage</div>
                  <input style={input} value={config.enterPackage} onChange={(e) => setConfig({ ...config, enterPackage: e.target.value })} />

                  <div style={{ fontWeight: 700 }}>leftUrl</div>
                  <input style={input} value={config.leftUrl} onChange={(e) => setConfig({ ...config, leftUrl: e.target.value })} />

                  <div style={{ fontWeight: 700 }}>rightUrl</div>
                  <input style={input} value={config.rightUrl} onChange={(e) => setConfig({ ...config, rightUrl: e.target.value })} />
                </div>

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>licenses</div>
                    <button
                      style={btn}
                      onClick={() => setConfig({ ...config, licenses: [...config.licenses, { ID: "", expire: "20261201" }] })}
                    >
                      + 添加
                    </button>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {config.licenses.map((lic, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 160px 90px", gap: 8 }}>
                        <input
                          style={input}
                          value={lic.ID}
                          placeholder="ID"
                          onChange={(e) => {
                            const next = [...config.licenses];
                            next[idx] = { ...next[idx], ID: e.target.value };
                            setConfig({ ...config, licenses: next });
                          }}
                        />
                        <input
                          style={input}
                          value={lic.expire}
                          placeholder="YYYYMMDD"
                          onChange={(e) => {
                            const next = [...config.licenses];
                            next[idx] = { ...next[idx], expire: e.target.value };
                            setConfig({ ...config, licenses: next });
                          }}
                        />
                        <button
                          style={btn}
                          onClick={() => setConfig({ ...config, licenses: config.licenses.filter((_, i) => i !== idx) })}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    {config.licenses.length === 0 && (
                      <div style={{ opacity: 0.7 }}>暂无 license，点“添加”新增。</div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 800 }}>JSON 预览</div>
                    <button style={btn} onClick={() => navigator.clipboard.writeText(configJsonPreview)}>复制</button>
                  </div>
                  <pre style={{ marginTop: 8, background: "#fafafa", border: "1px solid #eee", padding: 12, borderRadius: 12, overflow: "auto" }}>
                    {configJsonPreview}
                  </pre>
                </div>
              </>
            )}

            {msg && <div style={{ marginTop: 12, color: "green", whiteSpace: "pre-wrap" }}>{msg}</div>}
            {err && <pre style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>{err}</pre>}
          </div>
        </div>
      </div>
    );
  }

  return ui();
}
