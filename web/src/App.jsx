import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowUp, BookOpen, BracketsCurly, CaretDown, CaretRight, Check, CheckCircle,
  ClockCounterClockwise, Code, Cpu, CurrencyDollar, Database, File, FolderOpen,
  GitBranch, HardDrives, House, Lightning, ListChecks, MagnifyingGlass,
  Plug, Plus, Robot, SidebarSimple, Pulse, Sparkle, SpinnerGap, SquaresFour,
  TrendUp, UserCircle, Warning, Wrench, X,
} from "@phosphor-icons/react";

const nav = [
  ["Home", House], ["Workspaces", FolderOpen], ["Sessions", ClockCounterClockwise],
  ["Models", Cpu], ["Engines", Wrench], ["Agents", Robot], ["Skills", Sparkle],
  ["Plugins", Plug], ["Guides", BookOpen], ["Trace", Pulse], ["Usage", BracketsCurly],
];

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span>S</span></div>;
}

function AppIcon({ Icon }) {
  return <Icon size={19} weight="duotone" />;
}

export function App() {
  const [activeNav, setActiveNav] = useState("Home");
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [sessionTitle, setSessionTitle] = useState("New session");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [openModelGroups, setOpenModelGroups] = useState(() => new Set(["auto"]));
  const [model, setModel] = useState({ id: "auto", label: "Auto routing", lane: "cloud", provider: "auto" });
  const [modelOptions, setModelOptions] = useState([{ id: "auto", label: "Auto routing", lane: "cloud", provider: "auto" }]);
  const [steps, setSteps] = useState([]);
  const [job, setJob] = useState(null);
  const [workspace, setWorkspace] = useState("");
  const feedRef = useRef(null);

  useEffect(() => {
    fetch("/switchbay-api/health").then((r) => setConnected(r.ok)).catch(() => setConnected(false));
    const urlWorkspace = new URLSearchParams(window.location.search).get("workspace");
    const workspacePromise = urlWorkspace
      ? Promise.resolve(urlWorkspace)
      : fetch("/switchbay-api/v1/workspaces")
          .then((r) => r.ok ? r.json() : Promise.reject())
          .then((data) => {
            if (data.current && !data.current.includes("/.switchbay/")) return data.current;
            return data.workspaces?.find(w => w.isGit)?.absPath || data.workspaces?.[0]?.absPath || data.current || "";
          });
    workspacePromise
      .then((cwd) => {
        setWorkspace(cwd);
        return fetch(`/switchbay-api/v1/models?workspace=${encodeURIComponent(cwd)}`);
      })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        const options = [{ id: "auto", label: "Auto routing", lane: "cloud", provider: "auto" }, ...(data.cloud || []), ...(data.local || [])];
        setModelOptions(options);
        const pinned = data.selected?.cloud;
        if (pinned) {
          const selected = options.find((option) => option.id === pinned.id && (!pinned.provider || option.provider === pinned.provider)) || options[0];
          setModel(selected);
          setOpenModelGroups(new Set(["auto", selected.provider]));
        }
      }).catch(() => {});
  }, []);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  }, [messages, running]);

  const send = async () => {
    const body = input.trim();
    if (!body || running) return;
    setInput("");
    if (!messages.length) setSessionTitle(body.length > 58 ? `${body.slice(0, 58)}…` : body);
    setMessages((items) => [...items, { id: Date.now(), role: "user", body }]);
    setRunning(true);
    setRailOpen(true);
    setSteps([
      { label: "Route the request", state: "active", detail: model.id === "auto" ? "Automatic routing" : model.label },
    ]);
    setJob({ startedAt: Date.now(), tools: [], files: [], context: [], route: null, error: null });

    // This first workspace slice stays safe by using the live service when it is
    // open locally without auth, and falls back to an honest preview response.
    try {
      const response = await fetch("/switchbay-api/v1/turn/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: body, workspace, clientId: "switchbay-web", sessionId: sessionId || undefined, newSession: !sessionId }),
      });
      if (!response.ok) throw new Error("Service requires local authorization");
      if (!response.body) throw new Error("Streaming is unavailable");
      const replyId = Date.now() + 1;
      let received = "";
      let buffer = "";
      setMessages((items) => [...items, { id: replyId, role: "assistant", model: model.label, body: "", meta: "now" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const event = frame.match(/^event:\s*(.+)$/m)?.[1];
          const raw = frame.match(/^data:\s*(.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (event === "token" && typeof data.token === "string") {
            received += data.token;
            setMessages((items) => items.map((item) => item.id === replyId ? { ...item, body: received } : item));
          } else if (event === "step" && typeof data.step === "string") {
            setSteps((items) => [...items.map((item) => ({ ...item, state: "done" })), { label: data.step, state: "active", detail: "In progress" }]);
          } else if (event === "done") {
            if (!received) {
              const answer = data.content ?? data.output ?? data.text ?? data.message ?? "The turn completed without a text response.";
              received = String(answer);
              setMessages((items) => items.map((item) => item.id === replyId ? { ...item, body: received } : item));
            }
            if (data.sessionId) setSessionId(data.sessionId);
            setJob((current) => ({ ...current, tools: data.toolExecutions || [], files: [...new Set((data.toolExecutions || []).map((tool) => tool.changedFile).filter(Boolean))], context: data.contextReceipt || [], route: data.route || { provider: data.lane }, workspace: data.workspace, pendingApproval: data.pendingApproval || null, finishedAt: Date.now() }));
          } else if (event === "error") {
            throw new Error(data.message || "The turn failed");
          }
        }
        if (done) break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The turn failed";
      setMessages((items) => [...items, {
        id: Date.now() + 1, role: "assistant", model: "Switchbay",
        body: `**Turn failed:** ${message}`, meta: "now",
      }]);
      setJob((current) => ({ ...current, error: message, finishedAt: Date.now() }));
    } finally {
      setRunning(false);
      setSteps((items) => items.map((step) => ({ ...step, state: "done", detail: "Complete" })));
    }
  };

  const activityLabel = useMemo(() => running ? "Working through the task" : "Ready for the next job", [running]);
  const startNewSession = () => {
    setMessages([]);
    setSessionId(null);
    setSessionTitle("New session");
    setSteps([]);
    setInput("");
    setRunning(false);
    setJob(null);
    setRailOpen(false);
    setActiveNav("Home");
  };
  const groupedModelOptions = useMemo(() => {
    const labels = { auto: "Routing", openai: "OpenAI", anthropic: "Anthropic", google: "Google", ollama: "Local · Ollama", "ollama-cloud": "Ollama Cloud", openrouter: "OpenRouter", huggingface: "Hugging Face", "apple-fm": "Apple Intelligence" };
    const order = ["auto", "openai", "anthropic", "google", "ollama", "ollama-cloud", "openrouter", "huggingface", "apple-fm"];
    const grouped = new Map();
    for (const option of modelOptions) {
      const key = option.id === "auto" ? "auto" : option.provider;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(option);
    }
    return [...grouped.entries()].sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b))).map(([key, options]) => ({ key, label: labels[key] || key, options }));
  }, [modelOptions]);
  const chooseModel = async (option) => {
    setModelOpen(false);
    const previous = model;
    setModel(option);
    setOpenModelGroups((current) => new Set([...current, option.id === "auto" ? "auto" : option.provider]));
    try {
      const response = await fetch("/switchbay-api/v1/models/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: option.id, lane: option.lane, provider: option.provider }) });
      if (!response.ok) throw new Error("Model selection failed");
    } catch { setModel(previous); }
  };
  const toggleModelGroup = (key) => setOpenModelGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <BrandMark />
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(([label, Icon]) => (
            <button key={label} className={activeNav === label ? "nav-item active" : "nav-item"} onClick={() => { setActiveNav(label); setMobileNav(false); }} title={label}>
              <AppIcon Icon={Icon} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="service-state"><i className={connected ? "online" : "preview"} /><span>{connected ? "Local service online" : "Workspace preview"}</span></div>
          <div className="profile-label"><UserCircle size={25} weight="fill" /><span>Cass</span></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><SidebarSimple size={22} /></button>
          <div className="workspace-title">
            <div className="title-line"><span className="status-dot" />Switchbay</div>
            <div className="workspace-meta"><GitBranch size={13} /> main <span>•</span> {workspace || "…"}</div>
          </div>
          <div className="top-actions">
            <button className="new-chat-button" onClick={startNewSession}><Plus size={16} weight="bold" /> New chat</button>
            {activeNav === "Home" && <button className="icon-button" onClick={() => setRailOpen((v) => !v)} aria-label="Toggle details"><SquaresFour size={20} /></button>}
          </div>
        </header>

        {activeNav === "Home" ? <section className={`deck ${railOpen ? "with-rail" : ""}`}>
          <div className="conversation-column">
            <div className="conversation-head">
              <div><p className="eyebrow">{sessionId ? "Active session" : messages.length ? "Workspace session" : "Ready"}</p><h1>{sessionTitle}</h1></div>
              <div className="model-control">
                <button onClick={() => setModelOpen((v) => !v)}><span className="model-glyph"><Sparkle size={14} weight="fill" /></span><span>{model.label}</span><em>{model.id === "auto" ? "Auto" : model.provider}</em><CaretDown size={13} /></button>
                {modelOpen && <div className="model-menu">
                  {groupedModelOptions.map((group) => { const expanded = openModelGroups.has(group.key); return <section className={`model-group ${expanded ? "expanded" : "collapsed"}`} key={group.key}><button className="model-group-toggle" onClick={() => toggleModelGroup(group.key)} aria-expanded={expanded}><span>{expanded ? <CaretDown size={11} /> : <CaretRight size={11} />}{group.label}</span><em>{group.options.length}</em></button>{expanded && <div className="model-group-options">{group.options.map((option) => <button key={`${option.lane}-${option.provider}-${option.id}`} onClick={() => chooseModel(option)}><span><strong>{option.label}</strong><small>{option.id === "auto" ? "Trusted lane routing" : option.lane === "local" ? "Runs on this machine" : `${option.provider} · ${option.lane}`}</small></span>{option.id === model.id && option.provider === model.provider && <Check size={15} />}</button>)}</div>}</section>; })}
                </div>}
              </div>
            </div>

            <div className="feed" ref={feedRef}>
              <div className="date-rule"><span>Today · {new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span></div>
              {!messages.length && <div className="new-session-state"><span><Sparkle size={22} weight="duotone" /></span><h2>Start something new</h2><p>Ask a model, describe a job, or choose a specialist from the workspace.</p><div><button onClick={() => setInput("Inspect this workspace and give me a concise status.")}>Workspace status</button><button onClick={() => setInput("Help me plan the next implementation milestone.")}>Plan a milestone</button></div></div>}
              {messages.map((message) => <Message key={message.id} message={message} />)}
              {steps.length > 0 && <WorkSequence steps={steps} running={running} />}
              {running && <div className="thinking-row"><SpinnerGap className="spin" size={17} /><span>{activityLabel}</span><i /><i /><i /></div>}
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask a model or describe the next job…" rows={2} />
                <div className="composer-actions">
                  <div>
                    <span className="lane-label"><Lightning size={16} weight="fill" />{model.id === "auto" ? "Auto routing" : `${model.provider} pinned`}</span>
                  </div>
                  <button className="send-button" onClick={send} disabled={!input.trim() || running}>{running ? <SpinnerGap className="spin" size={18} /> : <ArrowUp size={18} weight="bold" />}<span>{running ? "Working" : "Run"}</span></button>
                </div>
              </div>
              <p className="composer-hint">Enter to run · Shift + Enter for a new line</p>
            </div>
          </div>

          {railOpen && <DetailsRail steps={steps} job={job} running={running} connected={connected} onClose={() => setRailOpen(false)} />}
        </section> : <CatalogPage page={activeNav} connected={connected} workspace={workspace} />}
      </main>
    </div>
  );
}

const pageMeta = {
  Workspaces: ["Workspace map", "Move between the projects Switchbay is allowed to enter."],
  Sessions: ["Session history", "Resume durable conversations without losing their workspace boundary."],
  Models: ["Model registry", "See trusted auto candidates, local models, and explicit selections."],
  Engines: ["Engine bay", "Inspect executable tool families and their approval posture."],
  Agents: ["Agent directory", "Specialist operating modes available to models in this workspace."],
  Skills: ["Skill toolbox", "Reusable working methods discovered from built-in, synced, and workspace sources."],
  Plugins: ["Plugin registry", "Installed capability bundles and the assets each contributes."],
  Guides: ["Quick guides", "Operating rules and quick starts models can discover before acting."],
  Trace: ["Flight recorder", "Inspect what the latest turn knew, touched, called, and returned."],
  Usage: ["Usage & spend", "Estimated tokens, model spend, tool calls, and activity over time."],
};

function CatalogPage({ page, connected, workspace }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const endpoint = page.toLowerCase();

  const load = async () => {
    setLoading(true); setError("");
    try {
      const url = page === "Sessions"
        ? `/switchbay-api/v1/sessions?workspace=${encodeURIComponent(workspace)}`
        : `/switchbay-api/v1/${endpoint}${page === "Trace" ? "/record" : ""}?workspace=${encodeURIComponent(workspace)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${page} returned ${response.status}`);
      setData(await response.json());
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { setQuery(""); load(); }, [page]);
  const [title, description] = pageMeta[page] || [page, "Switchbay workspace data."];

  return <section className="catalog-page">
    <div className="catalog-header">
      <div><p className="eyebrow">{connected ? "Live workspace" : "Service unavailable"}</p><h1>{title}</h1><p>{description}</p></div>
      <div className="catalog-actions">
        {!(["Trace", "Usage"].includes(page)) && <label className="catalog-search"><MagnifyingGlass size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${page.toLowerCase()}…`} /></label>}
        {page === "Skills" && <button className="import-resource-button" onClick={() => setBridgeOpen(true)}><ArrowUp size={15} weight="bold" />Import</button>}
        {(["Agents", "Skills", "Plugins", "Guides"].includes(page)) && <button className="create-resource-button" onClick={() => setBuilderOpen(true)}><Plus size={15} weight="bold" />Create</button>}
        <button className="refresh-button" onClick={load} disabled={loading}><Pulse className={loading ? "spin" : ""} size={17} />Refresh</button>
      </div>
    </div>
    <div className="catalog-body">
      {loading ? <LoadingState label={`Loading ${page.toLowerCase()}`} /> : error ? <ErrorState message={error} onRetry={load} /> : <PageContent page={page} data={data} query={query} />}
    </div>
    {builderOpen && <ResourceBuilder initialKind={page.slice(0, -1).toLowerCase()} workspace={workspace} onClose={() => setBuilderOpen(false)} onCreated={() => { setBuilderOpen(false); load(); }} />}
    {bridgeOpen && <SkillBridge workspace={workspace} onClose={() => setBridgeOpen(false)} onImported={() => { setBridgeOpen(false); load(); }} />}
  </section>;
}

function SkillBridge({ workspace, onClose, onImported }) {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("imported-skill.md");
  const [provider, setProvider] = useState("auto");
  const [mode, setMode] = useState("preserve");
  const [preview, setPreview] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const readFile = async (event) => { const file = event.target.files?.[0]; if (!file) return; setFilename(file.name); setContent(await file.text()); setPreview(null); setError(""); };
  const request = async (action) => {
    setWorking(true); setError("");
    try {
      const response = await fetch(`/switchbay-api/v1/skills/bridge/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace, content, filename, provider, mode, name: preview?.name, description: preview?.description }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `${action} failed with ${response.status}`);
      if (action === "preview") setPreview(payload.skill); else onImported(payload.skill);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); }
  };
  return <div className="builder-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="resource-builder skill-bridge" role="dialog" aria-modal="true" aria-labelledby="skill-bridge-title">
      <header><div><p className="eyebrow">Skill bridge</p><h2 id="skill-bridge-title">Import a model skill</h2><p>Bring GPT, Claude, Gemini, or generic Markdown skills into Switchbay without losing the original.</p></div><button className="icon-button" onClick={onClose} aria-label="Close skill importer"><X size={18} /></button></header>
      <div className="bridge-layout">
        <div className="bridge-source">
          <div className="bridge-controls"><label><span>Source format</span><select value={provider} onChange={(event) => { setProvider(event.target.value); setPreview(null); }}><option value="auto">Auto detect</option><option value="openai">GPT / OpenAI</option><option value="claude">Claude</option><option value="gemini">Gemini</option><option value="generic">Generic Markdown</option></select></label><label><span>Import mode</span><select value={mode} onChange={(event) => { setMode(event.target.value); setPreview(null); }}><option value="preserve">Use as-is</option><option value="convert">Convert to Switchbay</option></select></label></div>
          <label className="file-drop"><input type="file" accept=".md,text/markdown,text/plain" onChange={readFile} /><ArrowUp size={20} /><strong>Choose a Markdown skill</strong><span>SKILL.md, CLAUDE.md, GEMINI.md, or any Markdown file</span></label>
          <label><span>Skill source</span><textarea value={content} onChange={(event) => { setContent(event.target.value); setPreview(null); }} rows={15} placeholder="Paste the complete skill Markdown here…" /></label>
          {error && <div className="builder-error"><Warning size={16} /><span>{error}</span></div>}
          <button className="secondary-button bridge-preview-button" disabled={working || !content.trim()} onClick={() => request("preview")}>{working ? <SpinnerGap className="spin" size={15} /> : <Code size={15} />}Preview import</button>
        </div>
        <div className="bridge-preview">
          {!preview ? <div className="bridge-empty"><Sparkle size={23} weight="duotone" /><strong>Preview before importing</strong><span>Switchbay will detect metadata, show the final destination, and never overwrite an existing skill.</span></div> : <><div className="builder-section-title"><span className="resource-icon"><Sparkle size={18} weight="duotone" /></span><div><h3>{preview.name}</h3><p>{preview.provider} · {preview.mode === "convert" ? "Converted" : "Original body preserved"}</p></div></div><label><span>Name</span><input value={preview.name} onChange={(event) => { const name = event.target.value; const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0,64) || "imported-skill"; setPreview((value) => ({ ...value, name, destination: value.destination.replace(/[^/]+\.skill\.md$/, `${slug}.skill.md`) })); }} /></label><label><span>Description</span><input value={preview.description} onChange={(event) => setPreview((value) => ({ ...value, description: event.target.value }))} /></label><div className="destination-preview"><span>Will save to</span><code>{preview.destination}</code><small>Existing files are never overwritten.</small></div><div className="bridge-code"><pre>{preview.content}</pre></div><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={working} onClick={() => request("import")}>{working ? <SpinnerGap className="spin" size={16} /> : <ArrowUp size={16} weight="bold" />}Import skill</button></footer></>}
        </div>
      </div>
    </section>
  </div>;
}

const builderKinds = [
  ["agent", "Agent", Robot, "A specialist role models can activate for focused work."],
  ["skill", "Skill", Sparkle, "A reusable method stored in the synced toolbox repository."],
  ["guide", "Guide", BookOpen, "A quick start or operating rule discovered from the workspace."],
  ["plugin", "Plugin", Plug, "A tracked capability bundle ready to receive assets."],
];

function ResourceBuilder({ initialKind, workspace, onClose, onCreated }) {
  const [kind, setKind] = useState(initialKind);
  const [form, setForm] = useState({ name: "", description: "", triggers: "", instructions: "", guardrails: "", guideKind: "quickstart", version: "0.1.0" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const selected = builderKinds.find(([id]) => id === kind) || builderKinds[0];
  const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "new-resource";
  const destination = kind === "skill" ? `Engine Toolboxes/skills/${slug}.skill.md` : kind === "plugin" ? `Switchbay/plugins/${slug}/plugin.json` : kind === "agent" ? `.switchbay/agents/${slug}.md` : `.switchbay/${form.guideKind === "rule" ? "rules" : "quickstarts"}/${slug}.${form.guideKind}.md`;
  const save = async (event) => {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/switchbay-api/v1/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace, kind, ...form }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `Create failed with ${response.status}`);
      onCreated(payload.resource);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="builder-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="resource-builder" role="dialog" aria-modal="true" aria-labelledby="builder-title">
      <header><div><p className="eyebrow">Workspace authoring</p><h2 id="builder-title">Create a Switchbay resource</h2><p>Build it once, save it to its source repository, and let every model discover it.</p></div><button className="icon-button" onClick={onClose} aria-label="Close builder"><X size={18} /></button></header>
      <div className="builder-layout">
        <aside className="builder-kind-list">{builderKinds.map(([id, label, Icon, description]) => <button key={id} type="button" className={kind === id ? "active" : ""} onClick={() => { setKind(id); setError(""); }}><span><Icon size={18} weight="duotone" /></span><div><strong>{label}</strong><small>{description}</small></div>{kind === id && <Check size={15} />}</button>)}</aside>
        <form onSubmit={save} className="builder-form">
          <div className="builder-section-title"><span className="resource-icon">{selected && (() => { const Icon = selected[2]; return <Icon size={18} weight="duotone" />; })()}</span><div><h3>{selected[1]} details</h3><p>{selected[3]}</p></div></div>
          <div className="form-grid"><label><span>Name</span><input autoFocus value={form.name} onChange={update("name")} placeholder={`e.g. ${kind === "agent" ? "Document Verifier" : kind === "skill" ? "Release Readiness" : kind === "plugin" ? "Repository Ops" : "Model Tools Quick Start"}`} required /></label>{kind === "plugin" && <label><span>Version</span><input value={form.version} onChange={update("version")} required /></label>}{kind === "guide" && <label><span>Guide type</span><select value={form.guideKind} onChange={update("guideKind")}><option value="quickstart">Quick start</option><option value="rule">Operating rule</option></select></label>}</div>
          <label><span>Description</span><input value={form.description} onChange={update("description")} placeholder="What this resource helps models accomplish" required /></label>
          {kind !== "plugin" && <label><span>Triggers</span><input value={form.triggers} onChange={update("triggers")} placeholder="Comma-separated signals that should surface it" /></label>}
          {kind !== "plugin" && <label><span>{kind === "agent" ? "Working approach" : kind === "skill" ? "Method" : "Instructions"}</span><textarea value={form.instructions} onChange={update("instructions")} rows={6} placeholder="One step or instruction per line" /></label>}
          {kind !== "plugin" && <label><span>Guardrails</span><textarea value={form.guardrails} onChange={update("guardrails")} rows={3} placeholder="Boundaries, safety rules, or quality checks" /></label>}
          <div className="destination-preview"><span>Will save to</span><code>{destination}</code><small>Existing files are never overwritten.</small></div>
          {error && <div className="builder-error"><Warning size={16} /><span>{error}</span></div>}
          <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || !form.name.trim() || !form.description.trim()}>{saving ? <SpinnerGap className="spin" size={16} /> : <Plus size={16} weight="bold" />}{saving ? "Creating" : `Create ${selected[1]}`}</button></footer>
        </form>
      </div>
    </section>
  </div>;
}

function PageContent({ page, data, query }) {
  const matches = (value) => !query.trim() || JSON.stringify(value).toLowerCase().includes(query.trim().toLowerCase());
  if (page === "Workspaces") {
    const rows = (data?.workspaces || []).filter(matches);
    return <><SummaryStrip items={[["Known", rows.length], ["Git repositories", rows.filter(item => item.isGit).length], ["Current", data?.current?.split("/").pop() || "—"]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.absPath} icon={FolderOpen} title={item.label} badge={item.absPath === data.current ? "Active" : item.source} meta={item.isGit ? "Git repository" : "Directory"} description={item.absPath} />)}</ResourceGrid>{!rows.length && <EmptyState label="No workspaces matched." />}</>;
  }
  if (page === "Sessions") {
    const rows = (data?.sessions || []).filter(matches);
    return <><SummaryStrip items={[["Saved sessions", rows.length], ["Latest", rows[0] ? relativeTime(rows[0].updatedAt) : "—"], ["Workspace scoped", rows.filter(item => item.workspace).length]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={ClockCounterClockwise} title={item.title} badge={relativeTime(item.updatedAt)} meta={item.clientId || "Switchbay"} description={item.workspace || "No workspace recorded"} />)}</ResourceGrid>{!rows.length && <EmptyState label="No saved sessions matched." />}</>;
  }
  if (page === "Models") {
    const rows = [...(data?.cloud || []).map(item => ({...item, group:"Trusted cloud"})), ...(data?.local || []).map(item => ({...item, group:"Local"}))].filter(matches);
    return <><SummaryStrip items={[["Trusted cloud", data?.cloud?.length || 0], ["Local", data?.local?.length || 0], ["Routing", "Auto ready"]]} />{data?.notice && <Notice text={data.notice} />}<ResourceGrid>{rows.map(item => <ResourceCard key={`${item.lane}-${item.provider}-${item.id}`} icon={Cpu} title={item.label} badge={item.group} meta={`${item.provider} · ${item.source}`} description={item.id} />)}</ResourceGrid></>;
  }
  if (page === "Engines") {
    const rows = (data?.engines || []).filter(matches);
    const tools = rows.reduce((sum, item) => sum + item.tools.length, 0);
    return <><SummaryStrip items={[["Engines", rows.length], ["Tools", tools], ["Warnings", data?.warnings?.length || 0]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={Wrench} title={item.name} badge={`${item.tools.length} tools`} meta={item.id} description={item.description} tags={item.tools.slice(0,4).map(tool => tool.name)} />)}</ResourceGrid></>;
  }
  if (page === "Agents") {
    const rows = (data?.agents || []).filter(matches);
    return <><SummaryStrip items={[["Available", rows.length], ["Workspace", rows.filter(item => item.source === "workspace").length], ["Built in", rows.filter(item => item.source === "builtin").length]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={Robot} title={item.name} badge={item.source} meta={item.id} description={item.description} />)}</ResourceGrid></>;
  }
  if (page === "Skills") {
    const rows = (data?.skills || []).filter(matches);
    return <><SummaryStrip items={[["Skills", rows.length], ["Status", data?.status || "—"], ["Revision", data?.head?.slice(0,7) || "local"]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={Sparkle} title={item.name} badge={item.source} meta={item.languages?.join(" · ") || "Any language"} description={item.description} tags={(item.tags?.length ? item.tags : item.triggers)?.slice(0,4)} />)}</ResourceGrid></>;
  }
  if (page === "Plugins") {
    const rows = (data?.plugins || []).filter(matches);
    return <><SummaryStrip items={[["Installed", rows.length], ["Enabled", rows.filter(item => item.enabled).length], ["Warnings", data?.warnings?.length || 0]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={Plug} title={item.name} badge={item.enabled ? "Enabled" : "Disabled"} meta={`v${item.version} · ${item.id}`} description={item.description} tags={[`${item.agents.length} agents`, `${item.skills.length} skills`, `${item.engines.length} engines`, `${item.mcp.length} MCP`]} />)}</ResourceGrid>{!rows.length && <EmptyState label="No plugins are installed in this workspace yet." />}</>;
  }
  if (page === "Guides") {
    const rows = (data?.guides || []).filter(matches);
    return <><SummaryStrip items={[["Guides", rows.length], ["Quick starts", rows.filter(item => item.kind === "quickstart").length], ["Rules", rows.filter(item => item.kind === "rule").length]]} /><ResourceGrid>{rows.map(item => <ResourceCard key={item.id} icon={BookOpen} title={item.title} badge={item.kind} meta={item.source} description={item.description} tags={item.triggers?.slice(0,4)} />)}</ResourceGrid></>;
  }
  if (page === "Trace") return <TraceView trace={data?.trace} />;
  if (page === "Usage") return <UsageView data={data} />;
  return <EmptyState label="Nothing to show yet." />;
}

function SummaryStrip({ items }) { return <div className="summary-strip">{items.map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>; }
function ResourceGrid({ children }) { return <div className="resource-grid">{children}</div>; }
function ResourceCard({ icon: Icon, title, badge, meta, description, tags=[] }) { return <article className="resource-card"><div className="resource-card-head"><span className="resource-icon"><Icon size={18} weight="duotone" /></span><span className="resource-badge">{badge}</span></div><h2>{title}</h2><p className="resource-meta">{meta}</p><p className="resource-description">{description || "No description provided."}</p>{tags.length > 0 && <div className="tag-row">{tags.map(tag => <span key={tag}>{tag}</span>)}</div>}</article>; }
function LoadingState({ label }) { return <div className="page-state"><SpinnerGap className="spin" size={22} /><strong>{label}</strong><span>Reading the local Switchbay service…</span></div>; }
function ErrorState({ message, onRetry }) { return <div className="page-state error"><Warning size={23} /><strong>Couldn’t load this page</strong><span>{message}</span><button onClick={onRetry}>Try again</button></div>; }
function EmptyState({ label }) { return <div className="page-state"><Database size={22} /><strong>{label}</strong><span>This view reflects the current local workspace.</span></div>; }
function Notice({ text }) { return <div className="notice"><Warning size={16} /><span>{text}</span></div>; }

function TraceView({ trace }) {
  if (!trace) return <EmptyState label="No completed trace exists yet." />;
  return <div className="trace-layout"><div className="trace-overview"><p className="eyebrow">Latest turn</p><h2>{trace.objective || "Model turn"}</h2><p>{trace.userPrompt}</p><div className="trace-route"><Cpu size={17} /><strong>{trace.runtime.provider || trace.runtime.lane}</strong><span>{trace.runtime.model || "Unknown model"}</span></div></div><div className="trace-flow"><TraceNode icon={Lightning} title="Prompt & context" detail={`${trace.context.estimatedPromptTokens.toLocaleString()} estimated tokens · ${trace.context.knowledgeSources.length} knowledge sources`} /><TraceNode icon={Cpu} title="Model route" detail={`${trace.runtime.lane} · ${trace.runtime.model || "unknown"}`} />{trace.actions.tools.map((tool,index) => <TraceNode key={`${tool.tool}-${index}`} icon={Wrench} title={tool.tool} detail={tool.summary} tone={tool.ok ? "ok" : "error"} />)}<TraceNode icon={CheckCircle} title="Answer" detail={`${trace.result.estimatedAnswerTokens.toLocaleString()} estimated tokens · ${trace.result.finishReason || "complete"}`} tone="ok" /></div></div>;
}
function TraceNode({ icon:Icon, title, detail, tone="" }) { return <div className={`trace-node ${tone}`}><span><Icon size={17} /></span><div><strong>{title}</strong><p>{detail}</p></div></div>; }

function UsageView({ data }) {
  const totals = data?.totals || {}; const costs = data?.costs || {}; const days = data?.days || []; const maxTurns = Math.max(...days.map(day => day.turns),1);
  const lifetime = costs.lifetime || {};
  return <div className="usage-layout"><div className="metric-grid"><Metric icon={Pulse} label="Lifetime turns" value={(totals.turns || 0).toLocaleString()} /><Metric icon={BracketsCurly} label="Estimated tokens" value={((totals.promptTokens || 0)+(totals.answerTokens || 0)).toLocaleString()} detail="Trace-derived" /><Metric icon={Wrench} label="Tool calls" value={(totals.toolCalls || 0).toLocaleString()} /><Metric icon={CurrencyDollar} label="Lifetime spend" value={costDisplay(lifetime)} detail={costCoverage(lifetime)} tone={lifetime.unpricedTurns ? "warning" : ""} /></div><section className="usage-panel"><div className="panel-title"><div><p className="eyebrow">Last seven days</p><h2>Turn activity</h2></div><TrendUp size={21} /></div><div className="bar-chart">{days.map(day => <div key={day.date}><span style={{height:`${Math.max(4,(day.turns/maxTurns)*100)}%`}} /><strong>{day.turns}</strong><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined,{weekday:"short"})}</small></div>)}</div></section><section className="usage-panel spend-panel"><div className="panel-title"><div><p className="eyebrow">Estimated API spend</p><h2>Cost windows</h2></div></div>{[["Current session",costs.session],["Today",costs.today],["Seven days",costs.week],["Lifetime",costs.lifetime]].map(([label,cost]) => <div className={`spend-row ${cost?.unpricedTurns ? "unpriced" : ""}`} key={label}><span>{label}<small>{costCoverage(cost)}</small></span><strong>{costDisplay(cost)}</strong></div>)}</section><section className="usage-panel provider-panel"><div className="panel-title"><div><p className="eyebrow">Routes</p><h2>Spend by provider</h2></div></div>{(data?.providers || []).map(provider => <div className={`provider-row ${provider.unpricedTurns ? "unpriced" : ""}`} key={provider.provider}><span>{provider.provider}<small>{costCoverage(provider)}</small></span><div><i style={{width:`${Math.max(5,(provider.turns/Math.max(totals.turns || 1,1))*100)}%`}} /></div><strong>{costDisplay(provider)}</strong></div>)}</section><p className="usage-note">Spend is estimated from traced text and standard API rates. Unpriced turns are excluded—not counted as free.</p></div>;
}
function Metric({icon:Icon,label,value,detail,tone=""}) { return <div className={`metric ${tone}`}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</div></div>; }
function formatMoney(value) { return value === 0 ? "$0.00" : value < .01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`; }
function costDisplay(cost={}) { const total = cost.totalTurns ?? cost.turns ?? 0; if (total > 0 && !cost.pricedTurns) return "Unavailable"; if (cost.unpricedTurns) return "Partial"; return formatMoney(cost.usd || 0); }
function costCoverage(cost={}) { const total = cost.totalTurns ?? cost.turns ?? 0; if (!total) return "No traced turns"; if (!cost.pricedTurns) return `0 of ${total} turns priced`; if (cost.unpricedTurns) return `${cost.pricedTurns} of ${total} priced · ${formatMoney(cost.usd || 0)} known`; return `${total} of ${total} turns priced`; }
function relativeTime(value) { const delta = Date.now() - Number(value); if (delta < 60_000) return "Just now"; if (delta < 3_600_000) return `${Math.floor(delta/60_000)}m ago`; if (delta < 86_400_000) return `${Math.floor(delta/3_600_000)}h ago`; return `${Math.floor(delta/86_400_000)}d ago`; }

function Message({ message }) {
  if (message.role === "progress") return <div className="progress-message"><span className="progress-orbit"><Sparkle size={13} weight="fill" /></span><div><p>{message.body}</p><span>{message.meta}</span></div></div>;
  const assistant = message.role === "assistant";
  return <article className={`message ${assistant ? "assistant" : "user"}`}>
    <div className="message-avatar">{assistant ? <Sparkle size={16} weight="fill" /> : "C"}</div>
    <div className="message-content">
      <div className="message-label"><strong>{assistant ? message.model : "You"}</strong>{message.meta && <span>{message.meta}</span>}</div>
      <ReactMarkdown>{message.body}</ReactMarkdown>
    </div>
  </article>;
}

function WorkSequence({ steps, running }) {
  return <section className="work-sequence">
    <div className="sequence-head"><div><ListChecks size={18} /><strong>Work sequence</strong></div><span>{running ? "In progress" : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`}</span></div>
    {steps.map((step, index) => <div className={`sequence-row ${step.state}`} key={`${step.label}-${index}`}>
      <div className="step-marker">{step.state === "done" ? <Check size={13} weight="bold" /> : step.state === "active" ? <span /> : index + 1}</div>
      <div><strong>{step.label}</strong><span>{step.detail}</span></div>
      {step.state === "active" && <em>Active</em>}
    </div>)}
  </section>;
}

function DetailsRail({ steps, job, running, connected, onClose }) {
  const tools = job?.tools || [];
  const files = job?.files || [];
  const context = job?.context || [];
  const checks = tools.filter((tool) => /test|check|verify|build|lint/i.test(`${tool.tool} ${tool.summary}`));
  const route = job?.route;
  return <aside className="details-rail">
    <div className="rail-head"><div><p className="eyebrow">Live execution</p><h2>Job details</h2></div><button onClick={onClose} className="icon-button"><X size={18} /></button></div>
    <RailSection title="Activity" value={steps.length ? `${steps.length} steps` : "Waiting"}>
      {steps.length ? <div className="mini-plan">{steps.map((step, index) => <div key={`${step.label}-${index}`}><span className={step.state}>{step.state === "done" ? <Check size={11} /> : index + 1}</span><p>{step.label}<small>{step.detail}</small></p></div>)}</div> : <RailEmpty label="No active run." />}
    </RailSection>
    <RailSection title="Changed files" value={String(files.length)}>
      {files.map((file) => <div className="file-row" key={file}><File size={15} /><span>{file}</span></div>)}
      {!files.length && <RailEmpty label={running ? "Watching for changes…" : "No files changed."} />}
    </RailSection>
    <RailSection title="Verification" value={checks.length ? (checks.every((tool) => tool.ok) ? "Passed" : "Failed") : "Not run"}>
      {checks.map((tool, index) => <div className="verification" key={`${tool.tool}-${index}`}><CheckCircle size={18} weight="fill" /><div><strong>{tool.tool}</strong><span>{tool.summary}</span></div></div>)}
      {!checks.length && <RailEmpty label="No verification recorded." />}
    </RailSection>
    <RailSection title="Context" value={`${context.length} sources`}>
      {context.map((source, index) => <div className="context-row" key={`${source}-${index}`}><BookOpen size={15} /><span>{source}</span></div>)}
      {!context.length && <RailEmpty label={running ? "Loading context…" : "No context receipt yet."} />}
    </RailSection>
    <div className="rail-footer"><div><span>Service</span><strong className={connected ? "success" : "muted"}>{connected ? "Connected" : "Offline"}</strong></div><div><span>Route</span><strong>{route?.using || route?.model || route?.provider || "—"}</strong></div></div>
  </aside>;
}

function RailEmpty({ label }) { return <p className="rail-empty">{label}</p>; }

function RailSection({ title, value, children }) {
  return <section className="rail-section"><div className="rail-section-title"><h3>{title}</h3><span>{value}</span></div>{children}</section>;
}
