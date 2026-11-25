// node --test extensions/orca-liveness/index.test.mjs
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import orcaLiveness from "./index.ts";

const REGISTRY = Symbol.for("@agegr/pi-web/session-liveness/v1");
const MANAGER = Symbol.for("pi-subagents:manager");
const globals = globalThis;

afterEach(() => {
	delete globals[REGISTRY];
	delete globals[MANAGER];
});

// Un pi de mentira que guarda lo que la extensión registra.
function loadExtension() {
	const handlers = new Map();
	orcaLiveness({ on: (name, handler) => handlers.set(name, handler) });
	const startSession = (sessionId) => handlers.get("session_start")({}, { sessionManager: { getSessionId: () => sessionId } });
	return { startSession, shutdown: () => handlers.get("session_shutdown")({}) };
}

// Un registro de Orca de mentira que apunta los proveedores activos.
function installRegistry() {
	const providers = [];
	globals[REGISTRY] = {
		register(provider) {
			providers.push(provider);
			return () => providers.splice(providers.indexOf(provider), 1);
		},
	};
	return providers;
}

test("registra la sesión y la da por activa mientras un subagente corre", () => {
	const providers = installRegistry();
	loadExtension().startSession("sesion-1");
	assert.equal(providers.length, 1);
	assert.equal(providers[0].name, "pi-subagents");
	assert.equal(providers[0].sessionId, "sesion-1");
	assert.equal(providers[0].isActive(), false);
	globals[MANAGER] = { hasRunning: () => true };
	assert.equal(providers[0].isActive(), true);
	globals[MANAGER] = { hasRunning: () => false };
	assert.equal(providers[0].isActive(), false);
});

test("al abrir otra sesión libera el proveedor anterior", () => {
	const providers = installRegistry();
	const extension = loadExtension();
	extension.startSession("sesion-1");
	extension.startSession("sesion-2");
	assert.deepEqual(providers.map((provider) => provider.sessionId), ["sesion-2"]);
});

test("al cerrar la sesión libera el proveedor", () => {
	const providers = installRegistry();
	const extension = loadExtension();
	extension.startSession("sesion-1");
	extension.shutdown();
	assert.equal(providers.length, 0);
});

test("fuera de Orca no hace nada ni falla", () => {
	const extension = loadExtension();
	assert.doesNotThrow(() => {
		extension.startSession("sesion-1");
		extension.shutdown();
	});
});
