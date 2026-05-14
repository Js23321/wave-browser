import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

/* ── Admin / Maintenance ─────────────────────────────── */
const ADMIN_PASSWORD    = "Rjs06-02!";
const ADMIN_SECRET_PATH = "/wv-9x2k";
const MAINTENANCE_FILE  = resolve("./maintenance.json");

function _defaultState() {
	return {
		site:  { enabled: false, redirect: "https://google.com" },
		proxy: { enabled: false, message: "" },
		ai:    { enabled: false, message: "" },
		sr:    { enabled: false, message: "" },
	};
}

function loadState() {
	try {
		if (existsSync(MAINTENANCE_FILE)) {
			const raw = JSON.parse(readFileSync(MAINTENANCE_FILE, "utf8"));
			const def = _defaultState();
			return {
				site:  { ...def.site,  ...(raw.site  || {}) },
				proxy: { ...def.proxy, ...(raw.proxy || {}) },
				ai:    { ...def.ai,    ...(raw.ai    || {}) },
				sr:    { ...def.sr,    ...(raw.sr    || {}) },
			};
		}
	} catch {}
	return _defaultState();
}

function saveState(state) {
	try {
		writeFileSync(MAINTENANCE_FILE, JSON.stringify(state, null, 2), "utf8");
	} catch (e) {
		console.error("Failed to save maintenance state:", e);
	}
}

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["8.8.8.8", "8.8.4.4"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

/* ── Maintenance redirect hook ───────────────────────── */
fastify.addHook("onRequest", async (request, reply) => {
	const path = request.url.split("?")[0];
	const exempt =
		path === ADMIN_SECRET_PATH ||
		path.startsWith("/api/admin") ||
		path.startsWith("/scram/") ||
		path.startsWith("/libcurl/") ||
		path.startsWith("/baremux/");
	if (exempt) return;
	const state = loadState();
	if (state.site.enabled) {
		const val  = (state.site.redirect || "").trim();
		const dest = /^https?:\/\//i.test(val)
			? val
			: "https://www.google.com/search?q=" + encodeURIComponent(val || "");
		return reply.redirect(dest, 302);
	}
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

const WAVE_AI_SYSTEM_PROMPT = `You are Wave AI, a smart assistant built into the Wave browser. Be helpful, concise, and direct.

You excel at three areas:

1. CODING — HTML, CSS, JavaScript, Python, and more. Write clean, working code. Always use fenced code blocks with the language specified (e.g. \`\`\`js). Briefly explain what the code does.

2. GAMES — Deep knowledge of Roblox games (Blox Fruits, King Legacy, Sail Piece, etc.), Undertale / Deltarune / Undertale Yellow, Brawl Stars, and HTML5 games. Help with stats, guides, items, bosses, mechanics, tier lists, and strategies.

3. HOMEWORK — Math, science, history, English, and other school subjects. Give clear step-by-step explanations and show your work. Don't just give the answer.

Formatting rules:
- Use **bold** for key terms and important info.
- Use bullet points or numbered lists for steps and multiple items.
- Use code blocks for ALL code snippets, commands, and file paths.
- Keep responses focused and avoid filler phrases.
- If you don't know something, say so honestly.`;

fastify.post("/api/chat", async (request, reply) => {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) return reply.code(500).send({ error: "GROQ_API_KEY not set on server." });

	const { messages } = request.body;
	if (!Array.isArray(messages)) return reply.code(400).send({ error: "messages must be an array." });

	const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "llama-3.3-70b-versatile",
			messages: [
				{ role: "system", content: WAVE_AI_SYSTEM_PROMPT },
				...messages,
			],
			max_tokens: 2048,
			temperature: 0.7,
		}),
	});

	const data = await groqRes.json();
	if (!groqRes.ok) return reply.code(groqRes.status).send(data);
	return reply.send(data);
});

fastify.post("/api/chat-gemini", async (request, reply) => {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return reply.code(500).send({ error: "GEMINI_API_KEY not set on server." });

	const { messages } = request.body;
	if (!Array.isArray(messages)) return reply.code(400).send({ error: "messages must be an array." });

	const contents = messages
		.filter(m => m.role === "user" || m.role === "assistant")
		.map(m => ({
			role: m.role === "assistant" ? "model" : "user",
			parts: [{ text: m.content }],
		}));

	const geminiRes = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				system_instruction: {
					parts: [{ text: WAVE_AI_SYSTEM_PROMPT }],
				},
				contents,
				generationConfig: {
					maxOutputTokens: 2048,
					temperature: 0.7,
				},
			}),
		}
	);

	const data = await geminiRes.json();
	if (!geminiRes.ok) return reply.code(geminiRes.status).send(data);

	const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "(no response)";
	return reply.send({
		choices: [{ message: { role: "assistant", content: text } }],
	});
});

/* ── Admin API ───────────────────────────────────────── */
fastify.get("/api/admin/state", async (request, reply) => {
	return reply.send(loadState());
});

fastify.post("/api/admin/toggle", async (request, reply) => {
	const { password, service, enabled, message, redirect } = request.body || {};
	if (password !== ADMIN_PASSWORD) return reply.code(401).send({ error: "Invalid password." });
	const allowed = ["site", "proxy", "ai", "sr"];
	if (!allowed.includes(service)) return reply.code(400).send({ error: "Invalid service." });

	const state = loadState();
	state[service].enabled = !!enabled;
	if (service !== "site" && typeof message === "string") state[service].message = message;
	if (service === "site" && typeof redirect === "string" && redirect) state[service].redirect = redirect;
	saveState(state);
	return reply.send({ ok: true, state });
});

fastify.get(ADMIN_SECRET_PATH, (request, reply) => {
	return reply.sendFile("admin.html");
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
