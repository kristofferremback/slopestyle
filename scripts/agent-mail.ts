#!/usr/bin/env bun
import { AgentMailProxy, serveProxy } from "./lib/agent-mail.ts";

const args = process.argv.slice(2);
if (args[0] === "mcp") args.shift();
const upstreamIndex = args.indexOf("--upstream");
const upstream = upstreamIndex >= 0 ? args[upstreamIndex + 1] : process.env.AGENT_MAIL_UPSTREAM;
if (!upstream) throw new Error("--upstream /path/dist/cli.js is required");

const proxy = new AgentMailProxy({ upstream, cwd: process.cwd() });
await serveProxy(proxy, process.env.CLAUDE_CODE_SESSION_ID);
