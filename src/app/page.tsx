"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

// Small stroke icons matching the rest of the app (Settings, sidebar, etc.)
// instead of emoji — keeps the landing page in the same visual language as
// the product itself rather than looking like generic template art.
const ICONS = {
  folder: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  ),
  terminal: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  database: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  ),
  globe: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </svg>
  ),
  eye: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  plug: (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
};

const CAPABILITIES = [
  {
    icon: ICONS.folder,
    title: "Codebase Search & Edit",
    desc: "Lists directories, greps your project, then reads, writes, or edits files directly — every change pauses for your approval first.",
  },
  {
    icon: ICONS.terminal,
    title: "Safe Terminal Execution",
    desc: "Runs builds, lints, and fixes errors from the chat. Every command needs your approval before it executes.",
  },
  {
    icon: ICONS.database,
    title: "Database Introspection",
    desc: "Connects to local SQLite or Postgres, reads your schema, and writes queries against it.",
  },
  {
    icon: ICONS.globe,
    title: "Web Scraper (Markdown)",
    desc: "Fetches docs and pages from the web as clean Markdown, straight into the conversation.",
  },
  {
    icon: ICONS.eye,
    title: "Vision Analyzer",
    desc: "Upload a mockup or an error screenshot — a local vision sub-agent describes it in text the main model can use.",
  },
  {
    icon: ICONS.plug,
    title: "MCP Server Support",
    desc: "Connect any MCP server from Settings — its tools show up immediately, still gated behind approval.",
  },
];

// Real numbers pulled from the codebase itself, not rounded up for effect —
// 19 registered tools in tools/registry.ts, 38 passing vitest cases across
// approvals/security/executor/chatStore, and the 4 states the run-status
// badge in Studio actually cycles through.
const STATS = [
  { value: "19", label: "Built-in Tools", detail: "Files, terminal, database, web, vision, MCP" },
  { value: "38", label: "Automated Tests", detail: "Vitest — approvals, security, executor" },
  { value: "4", label: "Live Agent States", detail: "Idle, thinking, waiting, executing" },
  { value: "Any", label: "Ollama Model", detail: "Bring your own — qwen, llama, deepseek…" },
];

const STACK = [
  { name: "Next.js", desc: "App router, server routes, and the streaming chat UI." },
  { name: "Ollama", desc: "Runs the model on your own hardware — pick anything you've pulled." },
  { name: "SQLite", desc: "Chat history persisted to disk, migrated automatically on first run." },
  { name: "MCP", desc: "Model Context Protocol — drop in third-party tool servers from Settings." },
  { name: "TypeScript", desc: "Strict mode across the agent loop, the tool executor, and the UI." },
];

export default function Hub() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridRevealed, setGridRevealed] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setGridRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={styles.container}>
      <nav className={`${styles.navbar} ${scrolled ? styles.navbarScrolled : ""}`}>
        <div className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true" />
          Agentic Studio
        </div>
        <Link href="/studio" className={styles.navCta}>
          Launch Studio
        </Link>
      </nav>

      <main className={styles.main}>
        <header className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden="true" />

          <h1 className={styles.title}>
            Local AI, wired <br /> into your codebase.
          </h1>
          <p className={styles.subtitle}>
            Ornith runs on your own Ollama models and can read files, run terminal commands,
            query your database, and edit code — every action needs your approval first.
          </p>
          <div className={styles.ctaWrapper}>
            <Link href="/studio" className={styles.primaryCta}>
              Enter Studio <span className={styles.ctaArrow}>→</span>
            </Link>
            <a
              href="#getting-started"
              className={styles.secondaryCta}
              onClick={(e) => {
                e.preventDefault();
                const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                document.getElementById("getting-started")?.scrollIntoView({
                  behavior: reduceMotion ? "auto" : "smooth",
                  block: "start",
                });
              }}
            >
              Get Started
            </a>
          </div>

          <div className={styles.statsRow}>
            {STATS.map((stat) => (
              <div key={stat.label} className={styles.statCard}>
                <div className={styles.statValue}>{stat.value}</div>
                <div className={styles.statLabel}>{stat.label}</div>
                <div className={styles.statDetail}>{stat.detail}</div>
              </div>
            ))}
          </div>

          <div className={styles.demoWrapper}>
            <div className={styles.demoCard} aria-hidden="true">
              <div className={styles.demoChrome}>
                <span className={styles.demoDot} data-c="red" />
                <span className={styles.demoDot} data-c="yellow" />
                <span className={styles.demoDot} data-c="green" />
                <span className={styles.demoChromeTitle}>Studio</span>
                <span className={styles.demoStatus}>
                  <span className={styles.demoStatusDot} />
                  Waiting for approval
                </span>
              </div>
              <div className={styles.demoBody}>
                <div className={styles.demoUserBubble}>
                  Update the copyright year across the app
                </div>
                <p className={styles.demoAgentLine}>
                  Found the old year in 3 files. Editing each one now.
                </p>
                <div className={styles.demoApproval}>
                  <div className={styles.demoApprovalHead}>edit_local_file</div>
                  <code className={styles.demoApprovalCode}>
                    src/app/page.tsx · footer.tsx · layout.tsx — © 2025 → © 2026
                  </code>
                  <div className={styles.demoApprovalActions}>
                    <span className={styles.demoApproveBtn}>Approve</span>
                    <span className={styles.demoDenyBtn}>Deny</span>
                  </div>
                </div>
              </div>
            </div>
            <p className={styles.demoCaption}>
              Every write, edit, or terminal command pauses here — nothing runs until you click.
            </p>
          </div>
        </header>

        <section className={styles.toolsSection} id="capabilities">
          <h2 className={styles.sectionTitle}>What it can do</h2>
          <div
            ref={gridRef}
            className={`${styles.bentoGrid} ${gridRevealed ? styles.bentoGridRevealed : ""}`}
          >
            {CAPABILITIES.map((cap, i) => (
              <div
                key={cap.title}
                className={styles.bentoCard}
                style={{ transitionDelay: gridRevealed ? `${i * 60}ms` : "0ms" }}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.icon}>{cap.icon}</div>
                  <h3>{cap.title}</h3>
                </div>
                <p>{cap.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.stackSection}>
          <h2 className={styles.sectionTitle}>What it&apos;s built with</h2>
          <div className={styles.stackGrid}>
            {STACK.map((item) => (
              <div key={item.name} className={styles.stackCard}>
                <h3>{item.name}</h3>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.stepsSection} id="getting-started">
          <h2 className={styles.sectionTitle}>Getting started</h2>
          <div className={styles.stepsGrid}>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>1</div>
              <h3>Install Ollama</h3>
              <p>Ollama runs the models locally. Grab it and make sure it&apos;s running.</p>
              <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className={styles.stepLink}>
                ollama.com →
              </a>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>2</div>
              <h3>Pull a model</h3>
              <p>Pull a chat-capable model, then point it at Settings → Chat Model.</p>
              <code className={styles.stepCode}>ollama pull qwen</code>
            </div>
            <div className={styles.stepCard}>
              <div className={styles.stepNumber}>3</div>
              <h3>Run it</h3>
              <p>Install dependencies and start the dev server.</p>
              <code className={styles.stepCode}>npm install && npm run dev</code>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <div className={styles.footerLogo}>
              <span className={styles.logoMark} aria-hidden="true" />
              Agentic Studio
            </div>
            <p className={styles.footerDesc}>
              A local-first AI agent that reads, edits, and runs commands in your codebase —
              every action needs your approval.
            </p>
          </div>

          <div className={styles.footerCol}>
            <h4>Product</h4>
            <ul>
              <li><Link href="/studio">Launch Studio</Link></li>
              <li><a href="#capabilities">What it can do</a></li>
              <li><a href="#getting-started">Getting started</a></li>
            </ul>
          </div>

          <div className={styles.footerCol}>
            <h4>Resources</h4>
            <ul>
              <li><a href="https://ollama.com" target="_blank" rel="noopener noreferrer">Ollama</a></li>
              <li><a href="https://ollama.com/library" target="_blank" rel="noopener noreferrer">Model library</a></li>
              <li><a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a></li>
            </ul>
          </div>
        </div>

        <div className={styles.footerBottom}>
          <div className={styles.footerBottomLeft}>
            <span className={styles.footerDot} aria-hidden="true" />
            <p>Runs entirely on localhost.</p>
          </div>
          <p>MIT Licensed.</p>
        </div>
      </footer>
    </div>
  );
}
